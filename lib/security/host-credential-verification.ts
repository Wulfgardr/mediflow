import 'server-only';

import bcrypt from 'bcryptjs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { types } from 'node:util';
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';

import type { dbServer as dbServerType } from '@/lib/db-server';
import { users } from '@/lib/schema';
import {
    AUTH_LOCKOUT_DURATION_MS,
    AUTH_LOCKOUT_MAX_FAILURES,
    AUTH_LOCKOUT_WINDOW_MS,
    createInvalidCredentialsPayload,
    createLockedPayload,
    isLockoutActive,
    resetLockoutState,
} from '@/lib/security/auth-lockout';
import {
    hashAuditRef,
    withAuditContextMetadata,
    writeAuditEvent,
} from '@/lib/security/audit';

type Database = typeof dbServerType;
type Account = Pick<typeof users.$inferSelect,
    | 'id'
    | 'username'
    | 'displayName'
    | 'ambulatoryName'
    | 'role'
    | 'encryptedMasterKey'
    | 'salt'>;
type SecretKind = 'pin' | 'verifier' | 'recoveryVerifier';
type Credential = { username: string; kind: SecretKind; secret: string };
/* ADR 0143. 'confirmation' checks the PIN of a person who already holds a session. 'unlock' opens
   one: an account with a passphrase is opened only by its access verifier, never by the PIN.
   'recovery' proves possession of the recovery key of such an account, and opens nothing. */
type Purpose = 'confirmation' | 'unlock' | 'recovery';
type StoredCredentials = Pick<typeof users.$inferSelect, 'id' | 'passwordHash' | 'unlockVerifierHash' | 'recoveryVerifierHash'>;
type Denied = {
    kind: 'denied';
    failureClass: 'invalid_credentials' | 'locked';
    status: 401 | 423;
    body: ReturnType<typeof createInvalidCredentialsPayload>;
};

export type HostCredentialVerifierDependencies = {
    db?: Database;
    compare?: (pin: string, passwordHash: string) => Promise<boolean>;
    writeAuditEvent?: typeof writeAuditEvent;
    now?: () => Date;
};
export type HostCredentialVerification = { kind: 'verified'; account: Account } | Denied;

const invalid = (): Denied => ({
    kind: 'denied',
    failureClass: 'invalid_credentials',
    status: 401,
    body: createInvalidCredentialsPayload(),
});
const isProxy = types.isProxy;
const hasOwn = Object.hasOwn;

/** Rejects descriptor-bearing or non-canonical caller objects before dependencies are read. */
function readCredential(value: unknown, accepted: readonly SecretKind[]): Credential | null {
    if (!value || typeof value !== 'object') return null;
    try {
        if (isProxy(value)) return null;
        if (Object.getPrototypeOf(value) !== Object.prototype) return null;
        const fields = Object.getOwnPropertyDescriptors(value);
        if (Reflect.ownKeys(fields).length !== 2) return null;
        const kind = accepted.find((name) => hasOwn(fields, name));
        if (!hasOwn(fields, 'username') || !kind) return null;
        const username = fields.username;
        const secret = fields[kind];
        if (
            !username || !secret || !username.enumerable || !secret.enumerable
            || username.get || username.set || secret.get || secret.set
        ) return null;
        if (typeof username.value !== 'string' || typeof secret.value !== 'string') return null;
        return { username: username.value.trim(), kind, secret: secret.value };
    } catch {
        return null;
    }
}

/** The credentials read at the start: a rotation in between makes every later update miss. */
function sameCredentials(user: StoredCredentials) {
    return and(
        eq(users.id, user.id),
        eq(users.passwordHash, user.passwordHash),
        user.unlockVerifierHash ? eq(users.unlockVerifierHash, user.unlockVerifierHash) : isNull(users.unlockVerifierHash),
        user.recoveryVerifierHash ? eq(users.recoveryVerifierHash, user.recoveryVerifierHash) : isNull(users.recoveryVerifierHash),
    );
}

const ACCESS_VERIFIER = /^[A-Za-z0-9+/]{43}=$/u; // base64 of 32 bytes
const ACCESS_VERIFIER_HASH = /^[0-9a-f]{64}$/u;

/** The server keeps only SHA-256 of the verifier, which is a 256-bit derived value and not a chosen secret. */
function accessVerifierMatches(verifier: string, storedHash: string): boolean {
    if (!ACCESS_VERIFIER.test(verifier) || !ACCESS_VERIFIER_HASH.test(storedHash)) return false;
    const presented = createHash('sha256').update(Buffer.from(verifier, 'base64')).digest();
    return timingSafeEqual(presented, Buffer.from(storedHash, 'hex'));
}

async function database(dependencies: HostCredentialVerifierDependencies): Promise<Database> {
    if (dependencies.db) return dependencies.db;
    const { dbServer } = await import('@/lib/db-server');
    return dbServer;
}

async function usernameFor(
    db: Database,
    requested: string,
): Promise<string> {
    if (requested) return requested;
    const accounts = await db.select({ username: users.username }).from(users).limit(2);
    return accounts.length === 1 ? accounts[0].username : '';
}

async function recordFailedLoginAtomically(
    db: Database,
    user: StoredCredentials,
    now: Date,
) {
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const windowStartSeconds = Math.floor((now.getTime() - AUTH_LOCKOUT_WINDOW_MS) / 1000);
    const lockedUntilSeconds = Math.floor((now.getTime() + AUTH_LOCKOUT_DURATION_MS) / 1000);
    const activeLockout = sql`${users.lockedUntil} is not null and ${users.lockedUntil} > ${nowSeconds}`;
    const withinWindow = sql`${users.firstFailedLoginAt} is not null and ${users.firstFailedLoginAt} >= ${windowStartSeconds}`;
    const currentAttempts = sql<number>`case
        when ${users.failedLoginAttempts} > 0 then ${users.failedLoginAttempts}
        else 0
    end`;
    const nextAttempts = sql<number>`case
        when ${activeLockout} then ${currentAttempts}
        when ${withinWindow} then ${currentAttempts} + 1
        else 1
    end`;

    return db.update(users).set({
        failedLoginAttempts: nextAttempts,
        firstFailedLoginAt: sql`case
            when ${activeLockout} or ${withinWindow} then ${users.firstFailedLoginAt}
            else ${nowSeconds}
        end`,
        lockedUntil: sql`case
            when ${activeLockout} then ${users.lockedUntil}
            when ${nextAttempts} >= ${AUTH_LOCKOUT_MAX_FAILURES} then ${lockedUntilSeconds}
            else null
        end`,
    }).where(sameCredentials(user))
        .returning({
            failedLoginAttempts: users.failedLoginAttempts,
            firstFailedLoginAt: users.firstFailedLoginAt,
            lockedUntil: users.lockedUntil,
        }).get();
}

async function deny(
    username: string, dependencies: HostCredentialVerifierDependencies,
    lockedUntil?: Date | null, failedLoginAttempts?: number,
): Promise<Denied> {
    const locked = lockedUntil instanceof Date;
    try {
        await (dependencies.writeAuditEvent ?? writeAuditEvent)({
            eventType: 'auth.login.failed',
            outcome: 'failure',
            actorType: 'user',
            actorRef: hashAuditRef(username),
            subjectType: 'session',
            sourceSurface: 'web',
            redactedMetadata: withAuditContextMetadata({
                actorType: 'user',
                actorRef: 'anonymous',
                sourceSurface: 'web',
                authContext: 'anonymous',
            }, { reasonCode: locked ? 'locked' : 'invalid_credentials' }),
        });
    } catch {
        // Audit failure cannot make a failed credential valid or continue after return.
    }
    if (locked) return {
        kind: 'denied', failureClass: 'locked', status: 423,
        body: createLockedPayload(lockedUntil, failedLoginAttempts ?? AUTH_LOCKOUT_MAX_FAILURES),
    };
    return {
        kind: 'denied', failureClass: 'invalid_credentials', status: 401,
        body: createInvalidCredentialsPayload(
            typeof failedLoginAttempts === 'number'
                ? {
                    failedLoginAttempts,
                    remainingAttempts: Math.max(AUTH_LOCKOUT_MAX_FAILURES - failedLoginAttempts, 0),
                }
                : undefined,
        ),
    };
}

/**
 * Verifies the PIN of a host account; it creates no session and accepts no transport credential.
 * On an account with a passphrase this is the confirmation PIN: a surface that opens a session
 * calls verifyUnlockCredentials instead.
 */
export async function verifyHostCredentials(
    input: unknown, dependencies: HostCredentialVerifierDependencies = {},
): Promise<HostCredentialVerification> {
    return verify(readCredential(input, ['pin']), 'confirmation', dependencies);
}

/** Reads only account/lockout eligibility; it authenticates no gesture and issues no authority. */
export async function readHostConfirmationEligibility(
    principal: Readonly<{ id: string; username: string; role: string }>,
): Promise<'eligible' | 'denied' | 'locked'> {
    try {
        const db = await database({});
        const account = await db.select({ username: users.username, role: users.role,
            failedLoginAttempts: users.failedLoginAttempts, firstFailedLoginAt: users.firstFailedLoginAt,
            lockedUntil: users.lockedUntil }).from(users).where(eq(users.id, principal.id)).get();
        if (!account || account.username !== principal.username || (account.role ?? 'user') !== principal.role) return 'denied';
        return isLockoutActive(account, new Date()) ? 'locked' : 'eligible';
    } catch { return 'denied'; }
}

/**
 * For the surfaces that open a session. Takes { username, pin } or { username, verifier } and accepts
 * only the kind the account unlocks with; the other kind is denied without being compared or counted.
 */
export async function verifyUnlockCredentials(
    input: unknown, dependencies: HostCredentialVerifierDependencies = {},
): Promise<HostCredentialVerification> {
    return verify(readCredential(input, ['pin', 'verifier']), 'unlock', dependencies);
}

/**
 * For recovery. Takes { username, recoveryVerifier }, the value the browser derives from the recovery
 * key and the salt of the recovery kit. Only an account that unlocks with a passphrase has one.
 * Wrong values are counted and lock the account like wrong credentials; it creates no session.
 */
export async function verifyRecoveryCredentials(
    input: unknown, dependencies: HostCredentialVerifierDependencies = {},
): Promise<HostCredentialVerification> {
    return verify(readCredential(input, ['recoveryVerifier']), 'recovery', dependencies);
}

async function verify(
    credential: Credential | null, purpose: Purpose, dependencies: HostCredentialVerifierDependencies,
): Promise<HostCredentialVerification> {
    if (!credential) return invalid();
    try {
        const db = await database(dependencies);
        const username = await usernameFor(db, credential.username);
        if (!username || !credential.secret) return deny(username, dependencies);
        const user = await db.select().from(users).where(eq(users.username, username)).get();
        const now = dependencies.now?.() ?? new Date();
        if (!(now instanceof Date) || Number.isNaN(now.getTime())) return invalid();
        if (!user || !user.passwordHash) return deny(username, dependencies);
        const activeLockout = isLockoutActive(user, now);
        if (activeLockout) return deny(
            user.username, dependencies, activeLockout,
            Math.max(user.failedLoginAttempts ?? AUTH_LOCKOUT_MAX_FAILURES, AUTH_LOCKOUT_MAX_FAILURES),
        );

        const expected: SecretKind = purpose === 'recovery' ? 'recoveryVerifier'
            : purpose === 'unlock' && user.unlockVerifierHash ? 'verifier' : 'pin';
        if (credential.kind !== expected) return deny(user.username, dependencies);
        // An account still on its PIN has nothing to recover: its PIN is the credential.
        if (purpose === 'recovery' && !(user.unlockVerifierHash && user.recoveryVerifierHash)) return deny(user.username, dependencies);
        const valid = expected === 'pin'
            ? await (dependencies.compare ?? bcrypt.compare)(credential.secret, user.passwordHash)
            : accessVerifierMatches(credential.secret, (expected === 'verifier' ? user.unlockVerifierHash : user.recoveryVerifierHash) ?? '');
        if (!valid) {
            const next = await recordFailedLoginAtomically(db, user, now);
            if (!next) return deny(user.username, dependencies);
            const nextLockout = isLockoutActive(next, now);
            return deny(
                user.username,
                dependencies,
                nextLockout,
                nextLockout
                    ? Math.max(next.failedLoginAttempts, AUTH_LOCKOUT_MAX_FAILURES)
                    : next.failedLoginAttempts,
            );
        }

        const reset = await db.update(users).set(resetLockoutState())
            .where(and(
                sameCredentials(user),
                or(isNull(users.lockedUntil), lte(users.lockedUntil, now)),
            )).returning({ id: users.id }).get();
        if (!reset) {
            const current = await db.select().from(users).where(sameCredentials(user)).get();
            const concurrentLockout = current ? isLockoutActive(current, now) : null;
            if (current && concurrentLockout) return deny(
                current.username,
                dependencies,
                concurrentLockout,
                Math.max(current.failedLoginAttempts, AUTH_LOCKOUT_MAX_FAILURES),
            );
            return deny(user.username, dependencies);
        }
        return {
            kind: 'verified', account: {
                id: user.id, username: user.username, displayName: user.displayName,
                ambulatoryName: user.ambulatoryName, role: user.role,
                encryptedMasterKey: user.encryptedMasterKey, salt: user.salt,
            },
        };
    } catch {
        return invalid();
    }
}
