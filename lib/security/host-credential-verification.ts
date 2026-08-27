/* @Codex */
import 'server-only';

import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';

import type { dbServer as dbServerType } from '@/lib/db-server';
import { users } from '@/lib/schema';
import {
    AUTH_LOCKOUT_MAX_FAILURES,
    createInvalidCredentialsPayload,
    createLockedPayload,
    isLockoutActive,
    recordFailedLogin,
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
type Credential = { username: string; pin: string };
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

/** Rejects descriptor-bearing or non-canonical caller objects before dependencies are read. */
function readCredential(value: unknown): Credential | null {
    if (!value || typeof value !== 'object') return null;
    try {
        if (Object.getPrototypeOf(value) !== Object.prototype) return null;
        const fields = Object.getOwnPropertyDescriptors(value);
        if (Reflect.ownKeys(fields).length !== 2) return null;
        const username = fields.username;
        const pin = fields.pin;
        if (
            !username || !pin || !username.enumerable || !pin.enumerable
            || username.get || username.set || pin.get || pin.set
        ) return null;
        if (typeof username.value !== 'string' || typeof pin.value !== 'string') return null;
        return { username: username.value.trim(), pin: pin.value };
    } catch {
        return null;
    }
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

/** Verifies only host account credentials; it creates no session and accepts no transport credential. */
export async function verifyHostCredentials(
    input: unknown, dependencies: HostCredentialVerifierDependencies = {},
): Promise<HostCredentialVerification> {
    const credential = readCredential(input);
    if (!credential) return invalid();
    try {
        const db = await database(dependencies);
        const username = await usernameFor(db, credential.username);
        if (!username || !credential.pin) return deny(username, dependencies);
        const user = await db.select().from(users).where(eq(users.username, username)).get();
        const now = dependencies.now?.() ?? new Date();
        if (!user || !user.passwordHash) return deny(username, dependencies);
        const activeLockout = isLockoutActive(user, now);
        if (activeLockout) return deny(
            user.username, dependencies, activeLockout,
            Math.max(user.failedLoginAttempts ?? AUTH_LOCKOUT_MAX_FAILURES, AUTH_LOCKOUT_MAX_FAILURES),
        );

        const valid = await (dependencies.compare ?? bcrypt.compare)(credential.pin, user.passwordHash);
        if (!valid) {
            const next = recordFailedLogin(user, now);
            const update = await db.update(users).set({
                failedLoginAttempts: next.failedLoginAttempts,
                firstFailedLoginAt: next.firstFailedLoginAt,
                lockedUntil: next.lockedUntil,
            }).where(and(eq(users.id, user.id), eq(users.passwordHash, user.passwordHash))).run();
            if (update.changes !== 1) return deny(user.username, dependencies);
            return deny(user.username, dependencies, next.isLocked ? next.lockedUntil : null, next.failedLoginAttempts);
        }

        const reset = await db.update(users).set(resetLockoutState())
            .where(and(eq(users.id, user.id), eq(users.passwordHash, user.passwordHash))).run();
        if (reset.changes !== 1) return deny(user.username, dependencies);
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
