/* @Codex */
import 'server-only';

import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';

/* @Codex */
import {
    auditContextFromSession,
    requestIdFromRequest,
    withAuditContextMetadata,
    writeAuditEvent,
} from '@/lib/security/audit';
/* @Codex */
import {
    PIN_CHANGE_CONFLICT_CODE,
    PIN_CHANGE_INVALID_CURRENT_PIN_CODE,
    PIN_CHANGE_INVALID_NEW_PIN_CODE,
    PIN_CHANGE_REUSE_NOT_ALLOWED_CODE,
    validatePinChangeInput,
} from '@/lib/security/pin-change';
/* @Codex */
import { users } from '@/lib/schema';
/* @Codex */
import type { dbServer as dbServerType } from '@/lib/db-server';
/* @Codex */
import {
    abortNativeLegacyUserRetirement,
    commitNativeLegacyUserRetirement,
    prepareNativeLegacyUserRetirement,
} from '@/lib/security/server-session';
/* @Codex */
import {
    abortUserRetirement,
    commitUserRetirement,
    prepareUserRetirement,
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
};

/* @Codex */
export type PinChangeServiceInput = {
    session: WebSessionProjection;
    request: Request;
    currentPin: string;
    newPin: string;
    encryptedMasterKey: string;
    salt: string;
};

export type PinChangeServiceResult =
    | { kind: 'success' }
    | { kind: 'unauthorized' }
    | { kind: 'failure'; status: 400 | 401 | 409; code: string; message: string };

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
    const nativeRetirement = prepareNativeRetirement(user.id);
    if (!nativeRetirement) {
        return {
            kind: 'failure',
            status: 409,
            code: PIN_CHANGE_AUTHORITY_RETIREMENT_UNCONFIRMED_CODE,
            message: 'La rotazione delle credenziali non può essere confermata. Riprova dopo un nuovo accesso.',
        };
    }
    const webRetirement = prepareWebRetirement(input.session);
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
            .where(and(eq(users.id, user.id), eq(users.passwordHash, user.passwordHash)))
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
        try { abortNativeRetirement(nativeRetirement); } catch { /* fail-closed response below */ }
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
