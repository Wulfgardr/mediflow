/* @Codex */
import 'server-only';

import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { and, eq, isNotNull, isNull, lte, or } from 'drizzle-orm';

/* @Codex */
import {
    auditContextFromSession,
    requestIdFromRequest,
    withAuditContextMetadata,
    writeAuditEvent,
} from '@/lib/security/audit';
/* @Codex */
import {
    PASSPHRASE_ADOPTION_CONFLICT_CODE,
    PASSPHRASE_ADOPTION_INVALID_PIN_CODE,
    PASSPHRASE_ALREADY_ADOPTED_CODE,
    PIN_CHANGE_CONFLICT_CODE,
    PIN_CHANGE_INVALID_CURRENT_PIN_CODE,
    PIN_CHANGE_INVALID_NEW_PIN_CODE,
    PIN_CHANGE_PASSPHRASE_ACCOUNT_CODE,
    PIN_CHANGE_REUSE_NOT_ALLOWED_CODE,
    validatePinChangeInput,
} from '@/lib/security/pin-change';
import type { PassphraseAdoptionPayload, PassphraseChangePayload, PassphraseCredentials, PassphraseRecoveryPayload } from '@/lib/security/passphrase-adoption-validation';
import { verifyHostCredentials, verifyRecoveryCredentials, verifyUnlockCredentials, type HostCredentialVerification } from '@/lib/security/host-credential-verification';
import { retirePinEraResidues, type PinEraResidues } from '@/lib/security/pin-era-residues';
/* @Codex */
import { users } from '@/lib/schema';
/* @Codex */
import type { dbServer as dbServerType } from '@/lib/db-server';
/* @Codex */
import {
    abortNativeLegacyUserRetirement,
    commitNativeLegacyUserRetirement,
    prepareNativeLegacyUserRetirement,
    preparePairedNativePinRetirement,
} from '@/lib/security/server-session';
import { requirePairedNativeSession, type PairedNativeSession } from '@/lib/security/paired-native-session';
/* @Codex */
import {
    abortUserRetirement,
    commitUserRetirement,
    prepareUserRetirement,
    prepareNativeUserRetirement,
    retire,
    type WebSessionProjection,
} from '@/lib/security/web-auth-lifecycle-owner-adapter';

type PinChangeDatabase = typeof dbServerType;

/* @Codex */
export const PIN_CHANGE_AUTHORITY_RETIREMENT_UNCONFIRMED_CODE = 'PIN_CHANGE_AUTHORITY_RETIREMENT_UNCONFIRMED';

/* @Codex */
export type PinChangeServiceDependencies = {
    db?: PinChangeDatabase;
    writeAuditEvent?: typeof writeAuditEvent;
    prepareWebSessionsForUserRetirement?: typeof prepareUserRetirement;
    commitWebSessionsForUserRetirement?: typeof commitUserRetirement;
    abortWebSessionsForUserRetirement?: typeof abortUserRetirement;
    prepareNativeSessionsForUserRetirement?: typeof prepareNativeLegacyUserRetirement;
    commitNativeSessionsForUserRetirement?: typeof commitNativeLegacyUserRetirement;
    abortNativeSessionsForUserRetirement?: typeof abortNativeLegacyUserRetirement;
    readPairedNativeSession?: typeof requirePairedNativeSession;
    verifyPin?: typeof verifyHostCredentials;
    verifyRecovery?: typeof verifyRecoveryCredentials;
    verifyUnlock?: typeof verifyUnlockCredentials;
    /** Closes the one session a recovery opened for itself, when the recovery then changes nothing. */
    retireWebSession?: (session: WebSessionProjection, reason: 'delete') => unknown;
    /** Removes what the product keeps beside the archive that still holds the PIN wrapping. */
    retirePinEraResidues?: (userId: string, db: PinChangeDatabase) => PinEraResidues;
};

/* @Codex */
export type PinChangeServiceInput = {
    session: WebSessionProjection | PairedNativeSession;
    request: Request;
    currentPin: string;
    newPin: string;
    encryptedMasterKey: string;
    salt: string;
};

export type PinChangeServiceResult =
    /** `earlierCopiesCleared` is set by the move to a passphrase only. */
    | { kind: 'success'; earlierCopiesCleared?: boolean }
    | { kind: 'unauthorized' }
    | { kind: 'failure'; status: 400 | 401 | 409 | 423; code: string; message: string };

async function resolveDatabase(dependencies: PinChangeServiceDependencies): Promise<PinChangeDatabase> {
    if (dependencies.db) return dependencies.db;
    const { dbServer } = await import('@/lib/db-server');
    return dbServer;
}

/**
 * Rotates only the PIN-derived wrapping material. The compare-and-swap on the
 * previous password hash prevents a second concurrent rotation from replacing
 * the winning client's encrypted master-key blob.
 */
export async function changePin(
    input: PinChangeServiceInput,
    dependencies: PinChangeServiceDependencies = {},
): Promise<PinChangeServiceResult> {
    if (!input.encryptedMasterKey || !input.salt) {
        return {
            kind: 'failure',
            status: 400,
            code: PIN_CHANGE_INVALID_NEW_PIN_CODE,
            message: 'Payload di rotazione incompleto.',
        };
    }

    const validationError = validatePinChangeInput(input.currentPin, input.newPin);
    if (validationError) {
        return {
            kind: 'failure',
            status: 400,
            code: validationError.includes('diverso')
                ? PIN_CHANGE_REUSE_NOT_ALLOWED_CODE
                : PIN_CHANGE_INVALID_NEW_PIN_CODE,
            message: validationError,
        };
    }

    const db = await resolveDatabase(dependencies);
    const user = await db.select().from(users).where(eq(users.id, input.session.userId)).get();
    if (!user) return { kind: 'unauthorized' };
    // This rotation replaces the wrapping of the master key: the PIN no longer has that authority here.
    if (user.unlockVerifierHash) {
        return {
            kind: 'failure',
            status: 409,
            code: PIN_CHANGE_PASSPHRASE_ACCOUNT_CODE,
            message: 'Questo account si sblocca con una passphrase: il PIN non può sostituire la protezione della chiave.',
        };
    }

    const isCurrentPinValid = await bcrypt.compare(input.currentPin, user.passwordHash);
    if (!isCurrentPinValid) {
        return {
            kind: 'failure',
            status: 401,
            code: PIN_CHANGE_INVALID_CURRENT_PIN_CODE,
            message: 'Il PIN attuale non è corretto.',
        };
    }

    const prepareNativeRetirement = dependencies.prepareNativeSessionsForUserRetirement
        ?? prepareNativeLegacyUserRetirement;
    const commitNativeRetirement = dependencies.commitNativeSessionsForUserRetirement
        ?? commitNativeLegacyUserRetirement;
    const abortNativeRetirement = dependencies.abortNativeSessionsForUserRetirement
        ?? abortNativeLegacyUserRetirement;
    const prepareWebRetirement = dependencies.prepareWebSessionsForUserRetirement
        ?? prepareUserRetirement;
    const commitWebRetirement = dependencies.commitWebSessionsForUserRetirement
        ?? commitUserRetirement;
    const abortWebRetirement = dependencies.abortWebSessionsForUserRetirement
        ?? abortUserRetirement;
    const nativeSession = input.session.authChannel === 'native' ? input.session : null;
    const readNativeSession = dependencies.readPairedNativeSession ?? requirePairedNativeSession;
    if (nativeSession && await readNativeSession(input.request) !== nativeSession) return { kind: 'unauthorized' };
    const nativeRetirement = nativeSession
        ? preparePairedNativePinRetirement(nativeSession)
        : prepareNativeRetirement(user.id);
    if (!nativeRetirement) {
        return {
            kind: 'failure',
            status: 409,
            code: PIN_CHANGE_AUTHORITY_RETIREMENT_UNCONFIRMED_CODE,
            message: 'La rotazione delle credenziali non può essere confermata. Riprova dopo un nuovo accesso.',
        };
    }
    const webRetirement = nativeSession
        ? prepareNativeUserRetirement(nativeRetirement)
        : prepareWebRetirement(input.session);
    if (!webRetirement) {
        try { abortNativeRetirement(nativeRetirement); } catch { /* the credential mutation has not started */ }
        return {
            kind: 'failure',
            status: 409,
            code: PIN_CHANGE_AUTHORITY_RETIREMENT_UNCONFIRMED_CODE,
            message: 'La rotazione delle credenziali non può essere confermata. Riprova dopo un nuovo accesso.',
        };
    }

    const abortPreparedRetirements = (): void => {
        try { abortWebRetirement(webRetirement); } catch { /* the uncommitted capability remains non-authorizing */ }
        try { abortNativeRetirement(nativeRetirement); } catch { /* the uncommitted capability remains non-authorizing */ }
    };

    let nextPasswordHash: string;
    try {
        nextPasswordHash = await bcrypt.hash(input.newPin, 10);
    } catch (error) {
        abortPreparedRetirements();
        throw error;
    }

    let updateResult: { changes: number };
    try {
        if (nativeSession && await readNativeSession(input.request) !== nativeSession) {
            abortPreparedRetirements();
            return { kind: 'unauthorized' };
        }
        updateResult = db.transaction((tx) => tx
            .update(users)
            .set({
                passwordHash: nextPasswordHash,
                encryptedMasterKey: input.encryptedMasterKey,
                salt: input.salt,
                failedLoginAttempts: 0,
                firstFailedLoginAt: null,
                lockedUntil: null,
            })
            .where(and(eq(users.id, user.id), eq(users.passwordHash, user.passwordHash), isNull(users.unlockVerifierHash)))
            .run());
    } catch (error) {
        abortPreparedRetirements();
        throw error;
    }

    if (updateResult.changes !== 1) {
        abortPreparedRetirements();
        return {
            kind: 'failure',
            status: 409,
            code: PIN_CHANGE_CONFLICT_CODE,
            message: 'Il PIN è stato modificato da un’altra sessione. Ricarica e riprova.',
        };
    }

    /* @Codex: after the credential CAS, retire Web and native authority through separate exact owners. */
    let webRetirementOutcome: 'completed' | 'failed' | 'denied' = 'failed';
    try {
        webRetirementOutcome = commitWebRetirement(webRetirement).outcome;
    } catch {
        webRetirementOutcome = 'failed';
    }
    let nativeRetirementOutcome: 'completed' | 'failed' | 'denied' = 'failed';
    try {
        nativeRetirementOutcome = commitNativeRetirement(nativeRetirement).outcome;
    } catch {
        /* The credential CAS has committed: never abort its retirement fence. */
        nativeRetirementOutcome = 'failed';
    }
    if (webRetirementOutcome !== 'completed' || nativeRetirementOutcome !== 'completed') {
        return {
            kind: 'failure',
            status: 409,
            code: PIN_CHANGE_AUTHORITY_RETIREMENT_UNCONFIRMED_CODE,
            message: 'La rotazione delle credenziali non può essere confermata. Accedi di nuovo.',
        };
    }

    try {
        const context = auditContextFromSession(input.session);
        await (dependencies.writeAuditEvent ?? writeAuditEvent)({
            eventType: 'settings.updated',
            outcome: 'success',
            actorType: context.actorType,
            actorRef: context.actorRef,
            subjectType: 'settings',
            subjectRef: 'security.pin',
            sourceSurface: context.sourceSurface,
            requestId: requestIdFromRequest(input.request),
            redactedMetadata: withAuditContextMetadata(context, {
                changedFields: ['passwordHash', 'encryptedMasterKey', 'salt'],
                flags: ['credential-rotation'],
                reasonCode: 'pin_change',
            }),
        });
    } catch (error) {
        console.error('Audit pin change write failed:', error);
    }

    return { kind: 'success' };
}

export type PassphraseAdoptionInput = {
    session: WebSessionProjection;
    request: Request;
    payload: PassphraseAdoptionPayload;
};

/** What the server keeps of a verifier: the browser computes the same value with hashAccessVerifier. */
const verifierHash = (verifier: string) => createHash('sha256').update(Buffer.from(verifier, 'base64')).digest('hex');

/**
 * ADR 0143: moves an account from its PIN to a passphrase, once. One UPDATE writes the passphrase
 * wrapping, its verifier and the recovery wrapping, or nothing: an interruption leaves either the
 * PIN or the passphrase with its recovery kit, never a new secret over an unreadable archive.
 * The PIN authorizes the move and stays as the confirmation PIN; it can never repeat the move,
 * so it cannot replace a passphrase. Every session of the account is retired, as for a PIN change.
 */
export async function adoptPassphrase(
    input: PassphraseAdoptionInput,
    dependencies: PinChangeServiceDependencies = {},
): Promise<PinChangeServiceResult> {
    const { payload } = input;
    const db = await resolveDatabase(dependencies);
    const user = await db.select().from(users).where(eq(users.id, input.session.userId)).get();
    if (!user) return { kind: 'unauthorized' };
    if (user.unlockVerifierHash) {
        return {
            kind: 'failure',
            status: 409,
            code: PASSPHRASE_ALREADY_ADOPTED_CODE,
            message: 'Questo account si sblocca già con una passphrase.',
        };
    }
    // A session alone must not allow guessing the PIN here: the shared verifier counts wrong
    // PINs and honours a lock, exactly as it does at login.
    const verification = await (dependencies.verifyPin ?? verifyHostCredentials)(
        { username: user.username, pin: payload.currentPin },
        { db, ...(dependencies.writeAuditEvent ? { writeAuditEvent: dependencies.writeAuditEvent } : {}) },
    );
    if (verification.kind === 'denied') {
        return verification.status === 423
            ? { kind: 'failure', status: 423, code: verification.body.code, message: verification.body.message }
            : { kind: 'failure', status: 401, code: PASSPHRASE_ADOPTION_INVALID_PIN_CODE, message: verification.body.message };
    }

    const unconfirmed = (message: string): PinChangeServiceResult => ({
        kind: 'failure', status: 409, code: PIN_CHANGE_AUTHORITY_RETIREMENT_UNCONFIRMED_CODE, message,
    });
    const nativeRetirement = (dependencies.prepareNativeSessionsForUserRetirement ?? prepareNativeLegacyUserRetirement)(user.id);
    if (!nativeRetirement) return unconfirmed('Il passaggio alla passphrase non può essere confermato. Riprova dopo un nuovo accesso.');
    const abortNative = (): void => {
        try { (dependencies.abortNativeSessionsForUserRetirement ?? abortNativeLegacyUserRetirement)(nativeRetirement); } catch { /* nothing was written */ }
    };
    const webRetirement = (dependencies.prepareWebSessionsForUserRetirement ?? prepareUserRetirement)(input.session);
    if (!webRetirement) {
        abortNative();
        return unconfirmed('Il passaggio alla passphrase non può essere confermato. Riprova dopo un nuovo accesso.');
    }
    const abortPrepared = (): void => {
        try { (dependencies.abortWebSessionsForUserRetirement ?? abortUserRetirement)(webRetirement); } catch { /* nothing was written */ }
        abortNative();
    };

    let changes: number;
    try {
        changes = db.transaction((tx) => tx
            .update(users)
            .set({
                encryptedMasterKey: payload.encryptedMasterKey,
                salt: payload.salt,
                unlockVerifierHash: verifierHash(payload.verifier),
                recoveryWrappedMasterKey: payload.recovery.wrappedMasterKey,
                recoverySalt: payload.recovery.salt,
                recoveryVerifierHash: verifierHash(payload.recovery.verifier),
                failedLoginAttempts: 0,
                firstFailedLoginAt: null,
                lockedUntil: null,
            })
            .where(and(
                eq(users.id, user.id),
                eq(users.passwordHash, user.passwordHash),
                isNull(users.unlockVerifierHash),
                // A lock established after the PIN was verified stands: this write does not clear it.
                or(isNull(users.lockedUntil), lte(users.lockedUntil, new Date())),
            ))
            .run()).changes;
    } catch (error) {
        abortPrepared();
        throw error;
    }
    if (changes !== 1) {
        abortPrepared();
        return {
            kind: 'failure',
            status: 409,
            code: PASSPHRASE_ADOPTION_CONFLICT_CODE,
            message: 'Le credenziali sono state modificate da un’altra sessione. Accedi di nuovo e riprova.',
        };
    }

    // The passphrase is now the credential: a retirement that fails keeps its fence and is never aborted.
    let webOutcome: 'completed' | 'failed' | 'denied' = 'failed';
    try {
        webOutcome = (dependencies.commitWebSessionsForUserRetirement ?? commitUserRetirement)(webRetirement).outcome;
    } catch {
        webOutcome = 'failed';
    }
    let nativeOutcome: 'completed' | 'failed' | 'denied' = 'failed';
    try {
        nativeOutcome = (dependencies.commitNativeSessionsForUserRetirement ?? commitNativeLegacyUserRetirement)(nativeRetirement).outcome;
    } catch {
        nativeOutcome = 'failed';
    }
    // The copies kept beside the archive and its write-ahead log still hold the PIN wrapping of
    // the same master key: they go now. What this leaves behind, the next passphrase login retries.
    const residues = (dependencies.retirePinEraResidues ?? retirePinEraResidues)(user.id, db);
    if (webOutcome !== 'completed' || nativeOutcome !== 'completed') {
        return unconfirmed('La passphrase è attiva, ma il ritiro delle sessioni non è confermato. Accedi di nuovo con la passphrase.');
    }

    try {
        const context = auditContextFromSession(input.session);
        await (dependencies.writeAuditEvent ?? writeAuditEvent)({
            eventType: 'settings.updated',
            outcome: 'success',
            actorType: context.actorType,
            actorRef: context.actorRef,
            subjectType: 'settings',
            subjectRef: 'security.unlock-credential',
            sourceSurface: context.sourceSurface,
            requestId: requestIdFromRequest(input.request),
            redactedMetadata: withAuditContextMetadata(context, {
                changedFields: ['encryptedMasterKey', 'salt', 'unlockVerifierHash', 'recoveryWrappedMasterKey', 'recoverySalt', 'recoveryVerifierHash'],
                flags: ['credential-rotation'],
                reasonCode: 'passphrase_adopted',
            }),
        });
    } catch (error) {
        console.error('Audit passphrase adoption write failed:', error);
    }

    return { kind: 'success', earlierCopiesCleared: residues.complete };
}

type RecoveredAccount = Extract<HostCredentialVerification, { kind: 'verified' }>['account'];

export type PassphraseRecoveryInput = {
    request: Request;
    payload: PassphraseRecoveryPayload;
    /**
     * Recovery arrives without a session, and the Web session owner retires the sessions of an
     * account only for an authentic session of that account. So, once the recovery key is
     * verified, the route opens one through the Web auth control, exactly as a login would; it is
     * never handed to the browser and is retired with all the others in the same request.
     */
    openSession: (account: RecoveredAccount) => WebSessionProjection | null;
};
export type PassphraseRecoveryResult =
    | { kind: 'success' }
    | { kind: 'denied'; status: 401 | 423; body: Extract<HostCredentialVerification, { kind: 'denied' }>['body'] }
    | { kind: 'failure'; status: 409; code: string; message: string };

/**
 * ADR 0143: whoever holds the recovery key sets a new passphrase. One UPDATE replaces the
 * passphrase wrapping, its verifier and the recovery material, or nothing: the recovery key
 * that was just typed is retired with the passphrase it replaces. Wrong recovery keys are
 * counted and lock the account like wrong credentials. The PIN is left as it is and every
 * session of the account is retired.
 */
export async function recoverPassphrase(
    input: PassphraseRecoveryInput,
    dependencies: PinChangeServiceDependencies = {},
): Promise<PassphraseRecoveryResult> {
    return rotatePassphrase({
        ...input, mode: 'recovery', previousVerifier: input.payload.recoveryVerifier,
    }, dependencies);
}

/** The authenticated account changes its own passphrase; its PIN cannot authorize this. */
export async function changePassphrase(
    input: { session: WebSessionProjection; request: Request; payload: PassphraseChangePayload },
    dependencies: PinChangeServiceDependencies = {},
): Promise<PassphraseRecoveryResult | { kind: 'unauthorized' }> {
    const db = await resolveDatabase(dependencies);
    const user = db.select().from(users).where(eq(users.id, input.session.userId)).get();
    if (!user) return { kind: 'unauthorized' };
    if (!user.unlockVerifierHash) return {
        kind: 'failure', status: 409, code: 'PASSPHRASE_ACCOUNT_REQUIRED',
        message: 'Questo account usa ancora il PIN. Passa prima alla passphrase.',
    };
    return rotatePassphrase({
        mode: 'change', request: input.request,
        payload: { ...input.payload, username: user.username },
        previousVerifier: input.payload.currentVerifier,
        openSession: (account) => account.id === input.session.userId ? input.session : null,
    }, { ...dependencies, db });
}

/** Shared atomic replacement and terminal session retirement for change and recovery. */
async function rotatePassphrase(
    input: {
        mode: 'change' | 'recovery'; request: Request;
        payload: PassphraseCredentials & { username: string }; previousVerifier: string;
        openSession: (account: RecoveredAccount) => WebSessionProjection | null;
    },
    dependencies: PinChangeServiceDependencies,
): Promise<PassphraseRecoveryResult> {
    const { payload } = input;
    const db = await resolveDatabase(dependencies);
    const verify = input.mode === 'recovery'
        ? dependencies.verifyRecovery ?? verifyRecoveryCredentials
        : dependencies.verifyUnlock ?? verifyUnlockCredentials;
    const verification = await verify(
        input.mode === 'recovery'
            ? { username: payload.username, recoveryVerifier: input.previousVerifier }
            : { username: payload.username, verifier: input.previousVerifier },
        { db, ...(dependencies.writeAuditEvent ? { writeAuditEvent: dependencies.writeAuditEvent } : {}) },
    );
    if (verification.kind === 'denied') return { kind: 'denied', status: verification.status, body: verification.body };
    const account = verification.account;

    const unconfirmed = (message: string): PassphraseRecoveryResult => ({
        kind: 'failure', status: 409, code: PIN_CHANGE_AUTHORITY_RETIREMENT_UNCONFIRMED_CODE, message,
    });
    const session = input.openSession(account);
    if (!session) return unconfirmed('Il recupero non può essere confermato. Riprova tra poco.');
    const closeSession = (): void => {
        if (input.mode !== 'recovery') return;
        try { (dependencies.retireWebSession ?? retire)(session, 'delete'); } catch { /* it was never handed out */ }
    };
    const nativeRetirement = (dependencies.prepareNativeSessionsForUserRetirement ?? prepareNativeLegacyUserRetirement)(account.id);
    if (!nativeRetirement) {
        closeSession();
        return unconfirmed('Il recupero non può essere confermato. Riprova tra poco.');
    }
    const abortNative = (): void => {
        try { (dependencies.abortNativeSessionsForUserRetirement ?? abortNativeLegacyUserRetirement)(nativeRetirement); } catch { /* nothing was written */ }
    };
    const webRetirement = (dependencies.prepareWebSessionsForUserRetirement ?? prepareUserRetirement)(session);
    if (!webRetirement) {
        abortNative();
        closeSession();
        return unconfirmed('Il recupero non può essere confermato. Riprova tra poco.');
    }
    const abortPrepared = (): void => {
        try { (dependencies.abortWebSessionsForUserRetirement ?? abortUserRetirement)(webRetirement); } catch { /* nothing was written */ }
        abortNative();
        closeSession();
    };

    let changes: number;
    try {
        changes = db.transaction((tx) => tx
            .update(users)
            .set({
                encryptedMasterKey: payload.encryptedMasterKey,
                salt: payload.salt,
                unlockVerifierHash: verifierHash(payload.verifier),
                recoveryWrappedMasterKey: payload.recovery.wrappedMasterKey,
                recoverySalt: payload.recovery.salt,
                recoveryVerifierHash: verifierHash(payload.recovery.verifier),
                failedLoginAttempts: 0,
                firstFailedLoginAt: null,
                lockedUntil: null,
            })
            .where(and(
                eq(users.id, account.id),
                input.mode === 'recovery'
                    ? eq(users.recoveryVerifierHash, verifierHash(input.previousVerifier))
                    : eq(users.unlockVerifierHash, verifierHash(input.previousVerifier)),
                isNotNull(users.unlockVerifierHash),
                // A lock established after the recovery key was verified stands: this write does not clear it.
                or(isNull(users.lockedUntil), lte(users.lockedUntil, new Date())),
            ))
            .run()).changes;
    } catch (error) {
        abortPrepared();
        throw error;
    }
    if (changes !== 1) {
        abortPrepared();
        return {
            kind: 'failure',
            status: 409,
            code: PASSPHRASE_ADOPTION_CONFLICT_CODE,
            message: 'Le credenziali sono state modificate nel frattempo. Nulla è cambiato con questa richiesta.',
        };
    }

    // The new passphrase is now the credential: a retirement that fails keeps its fence and is never aborted.
    let webOutcome: 'completed' | 'failed' | 'denied' = 'failed';
    try {
        webOutcome = (dependencies.commitWebSessionsForUserRetirement ?? commitUserRetirement)(webRetirement).outcome;
    } catch {
        webOutcome = 'failed';
    }
    let nativeOutcome: 'completed' | 'failed' | 'denied' = 'failed';
    try {
        nativeOutcome = (dependencies.commitNativeSessionsForUserRetirement ?? commitNativeLegacyUserRetirement)(nativeRetirement).outcome;
    } catch {
        nativeOutcome = 'failed';
    }
    if (webOutcome !== 'completed' || nativeOutcome !== 'completed') {
        return unconfirmed('La nuova passphrase è attiva, ma il ritiro delle sessioni non è confermato. Accedi con la nuova passphrase.');
    }

    try {
        const context = input.mode === 'recovery'
            ? { actorType: 'user' as const, actorRef: account.id, sourceSurface: 'web' as const, authContext: 'anonymous' as const }
            : auditContextFromSession(session);
        await (dependencies.writeAuditEvent ?? writeAuditEvent)({
            eventType: 'settings.updated',
            outcome: 'success',
            actorType: 'user',
            actorRef: account.id,
            subjectType: 'settings',
            subjectRef: 'security.unlock-credential',
            sourceSurface: context.sourceSurface,
            requestId: requestIdFromRequest(input.request),
            redactedMetadata: withAuditContextMetadata(context, {
                changedFields: ['encryptedMasterKey', 'salt', 'unlockVerifierHash', 'recoveryWrappedMasterKey', 'recoverySalt', 'recoveryVerifierHash'],
                flags: input.mode === 'recovery' ? ['credential-rotation', 'recovery-key'] : ['credential-rotation'],
                reasonCode: input.mode === 'recovery' ? 'passphrase_recovered' : 'passphrase_changed',
            }),
        });
    } catch (error) {
        console.error('Audit passphrase recovery write failed:', error);
    }

    return { kind: 'success' };
}
