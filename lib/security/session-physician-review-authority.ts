/* @Codex */
import 'server-only';

import crypto from 'crypto';
import { eq } from 'drizzle-orm';

import { dbServer } from '../db-server';
import { users } from '../schema';
import { resolveAuthenticatedReviewPrincipal, type AuthenticatedReviewPrincipalV1 } from './authenticated-review-principal';
import { createPhysicianReviewAttestationStore } from './physician-review-attestation-store';
import { readAuthenticatedWebSession } from './server-auth';
import { peekSession, registerServerSessionResource, type ServerSession } from './server-session';

const SCHEMA_VERSION = 'mediflow.session-physician-review-authority.v1' as const;
const ATTESTATION_SCHEMA_VERSION = 'mediflow.physician-review-attestation.v1' as const;
const CAPABILITY = 'physician_terminal_review' as const;
const POLICY_VERSION = 'physician_terminal_review.v1' as const;

type Awaitable<T> = T | Promise<T>;
type AuthoritySnapshot = Readonly<{
    actorRef: string;
    expiresAt: number;
    revocationGeneration: string;
    sessionGeneration: string;
    sessionId: string;
}>;
type AuthorityRecord = {
    authority: SessionPhysicianReviewAuthorityV1;
    snapshot: AuthoritySnapshot;
    unregister: (() => void) | null;
};

export type SessionPhysicianReviewAuthorityV1 = Readonly<{
    actorRef: string;
    attestationVersion: 1;
    authenticated: true;
    expiresAt: number;
    revocationGeneration: string;
    schemaVersion: typeof SCHEMA_VERSION;
    sessionGeneration: string;
    unlocked: true;
}>;

export type SessionPhysicianReviewAuthorityErrorCode =
    | 'account_locked'
    | 'attestation_inactive'
    | 'attestation_revoked'
    | 'attestation_unavailable'
    | 'attestation_version_drift'
    | 'principal_mismatch'
    | 'projection_stale'
    | 'projection_unavailable'
    | 'session_ineligible'
    | 'session_unavailable'
    | 'storage_unavailable';

export class SessionPhysicianReviewAuthorityError extends Error {
    constructor(readonly code: SessionPhysicianReviewAuthorityErrorCode) {
        super(`Session physician review authority rejected: ${code}`);
        this.name = 'SessionPhysicianReviewAuthorityError';
    }
}

export type SessionPhysicianReviewAuthoritySources = Readonly<{
    resolvePrincipal(): Awaitable<AuthenticatedReviewPrincipalV1>;
    readCurrentSession(): Awaitable<ServerSession | null>;
    readAttestation(actorRef: string): Awaitable<unknown>;
    readAccount(actorRef: string): Awaitable<unknown>;
    registerSessionResource: typeof registerServerSessionResource;
    clock?: () => number;
}>;

function fail(code: SessionPhysicianReviewAuthorityErrorCode): never {
    throw new SessionPhysicianReviewAuthorityError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validDate(value: unknown): value is Date {
    return value instanceof Date && Number.isFinite(value.getTime());
}

function marker(key: Buffer, label: string, value: readonly unknown[]): string {
    return crypto.createHmac('sha256', key)
        .update(label)
        .update('\u0000')
        .update(JSON.stringify(value))
        .digest('base64url');
}

function snapshotEqual(first: AuthoritySnapshot, second: AuthoritySnapshot): boolean {
    return first.actorRef === second.actorRef
        && first.expiresAt === second.expiresAt
        && first.revocationGeneration === second.revocationGeneration
        && first.sessionGeneration === second.sessionGeneration
        && first.sessionId === second.sessionId;
}

function verifyAttestation(value: unknown, actorRef: string) {
    if (!isRecord(value) || value.actorRef !== actorRef) return fail('attestation_unavailable');
    if (value.schemaVersion !== ATTESTATION_SCHEMA_VERSION || value.capability !== CAPABILITY
        || value.policyVersion !== POLICY_VERSION || value.attestationVersion !== 1) {
        return fail('attestation_version_drift');
    }
    if (value.status === 'inactive') return fail('attestation_inactive');
    if (value.status === 'revoked') return fail('attestation_revoked');
    if (value.status !== 'active' || value.revokedAt !== null
        || !validDate(value.createdAt) || !validDate(value.updatedAt)
        || value.updatedAt.getTime() < value.createdAt.getTime()) {
        return fail('attestation_unavailable');
    }
    return { updatedAt: value.updatedAt };
}

function verifyAccount(value: unknown, actorRef: string, now: number) {
    if (!isRecord(value) || value.id !== actorRef) return fail('storage_unavailable');
    if (value.lockedUntil !== null && !validDate(value.lockedUntil)) return fail('storage_unavailable');
    if (value.lockedUntil instanceof Date && value.lockedUntil.getTime() > now) return fail('account_locked');
    return { lockedUntil: value.lockedUntil };
}

function verifySession(
    principal: AuthenticatedReviewPrincipalV1,
    session: ServerSession | null,
    now: number,
): ServerSession {
    if (!session) return fail('session_unavailable');
    if (session.authChannel !== 'web' || session.id === 'local-api') return fail('session_ineligible');
    if (!Number.isFinite(session.createdAt) || !Number.isFinite(session.expiresAt) || session.expiresAt <= now) {
        peekSession(session.id);
        return fail('session_unavailable');
    }
    if (principal.actorRef !== session.userId || principal.sessionRef !== session.id) return fail('principal_mismatch');
    if (peekSession(session.id) !== session) return fail('session_unavailable');
    return session;
}

export function createSessionPhysicianReviewAuthorityService(sources: SessionPhysicianReviewAuthoritySources) {
    const records = new Map<string, AuthorityRecord>();
    const issued = new WeakMap<object, AuthorityRecord>();
    const markerKey = crypto.randomBytes(32);
    const clock = sources.clock ?? Date.now;

    const readSnapshot = async (): Promise<AuthoritySnapshot> => {
        let principal: AuthenticatedReviewPrincipalV1;
        let session: ServerSession | null;
        try {
            [principal, session] = await Promise.all([sources.resolvePrincipal(), sources.readCurrentSession()]);
        } catch {
            return fail('storage_unavailable');
        }
        const current = verifySession(principal, session, clock());

        let attestation: unknown;
        let account: unknown;
        try {
            [attestation, account] = await Promise.all([
                sources.readAttestation(principal.actorRef),
                sources.readAccount(principal.actorRef),
            ]);
        } catch {
            return fail('storage_unavailable');
        }
        const verifiedAttestation = verifyAttestation(attestation, principal.actorRef);
        const verifiedAccount = verifyAccount(account, principal.actorRef, clock());
        return Object.freeze({
            actorRef: principal.actorRef,
            expiresAt: current.expiresAt,
            sessionId: current.id,
            sessionGeneration: marker(markerKey, 'session', [current.id, current.userId, current.createdAt]),
            revocationGeneration: marker(markerKey, 'revocation', [
                principal.actorRef,
                verifiedAttestation.updatedAt.getTime(),
                verifiedAccount.lockedUntil?.getTime() ?? null,
            ]),
        });
    };

    const readStableSnapshot = async (): Promise<AuthoritySnapshot> => {
        const before = await readSnapshot();
        const after = await readSnapshot();
        if (!snapshotEqual(before, after)) return fail('projection_stale');
        return after;
    };

    const discard = (record: AuthorityRecord): void => {
        if (records.get(record.snapshot.sessionId) === record) records.delete(record.snapshot.sessionId);
        issued.delete(record.authority);
        record.unregister?.();
        record.unregister = null;
    };

    return Object.freeze({
        async derive(): Promise<SessionPhysicianReviewAuthorityV1> {
            const snapshot = await readStableSnapshot();
            const existing = records.get(snapshot.sessionId);
            if (existing && snapshotEqual(existing.snapshot, snapshot)) return existing.authority;
            if (existing) discard(existing);

            const authority = Object.freeze({
                schemaVersion: SCHEMA_VERSION,
                actorRef: snapshot.actorRef,
                attestationVersion: 1 as const,
                authenticated: true as const,
                unlocked: true as const,
                expiresAt: snapshot.expiresAt,
                sessionGeneration: snapshot.sessionGeneration,
                revocationGeneration: snapshot.revocationGeneration,
            });
            const record: AuthorityRecord = { authority, snapshot, unregister: null };
            let unregister: (() => void) | null;
            try {
                unregister = sources.registerSessionResource(snapshot.sessionId, () => discard(record));
            } catch {
                return fail('storage_unavailable');
            }
            if (!unregister) return fail('session_unavailable');
            record.unregister = unregister;
            records.set(snapshot.sessionId, record);
            issued.set(authority, record);
            return authority;
        },

        async recheck(candidate: unknown): Promise<SessionPhysicianReviewAuthorityV1> {
            if (!isRecord(candidate)) return fail('projection_unavailable');
            const record = issued.get(candidate);
            if (!record || records.get(record.snapshot.sessionId) !== record) return fail('projection_unavailable');

            let snapshot: AuthoritySnapshot;
            try {
                snapshot = await readStableSnapshot();
            } catch (error) {
                discard(record);
                throw error;
            }
            if (!snapshotEqual(record.snapshot, snapshot)) {
                discard(record);
                return fail('projection_stale');
            }
            return record.authority;
        },
    });
}

const physicianReviewAttestationStore = createPhysicianReviewAttestationStore();

function readCanonicalAccount(actorRef: string): unknown {
    return dbServer
        .select({ id: users.id, lockedUntil: users.lockedUntil })
        .from(users)
        .where(eq(users.id, actorRef))
        .get();
}

export const sessionPhysicianReviewAuthority = createSessionPhysicianReviewAuthorityService({
    resolvePrincipal: resolveAuthenticatedReviewPrincipal,
    readCurrentSession: readAuthenticatedWebSession,
    readAttestation: (actorRef) => physicianReviewAttestationStore.read(actorRef),
    readAccount: readCanonicalAccount,
    registerSessionResource: registerServerSessionResource,
});
