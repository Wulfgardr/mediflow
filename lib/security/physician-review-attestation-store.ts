/* @Codex */
import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { dbServer, hasCanonicalPhysicianReviewAttestationSchema, runDbServerImmediateTransaction } from '../db-server';
import { physicianReviewAttestations, users } from '../schema';

const SCHEMA_VERSION = 'mediflow.physician-review-attestation.v1' as const;
const CAPABILITY = 'physician_terminal_review' as const;
const POLICY_VERSION = 'physician_terminal_review.v1' as const;

export type PhysicianReviewAttestationV1 = Readonly<{
    schemaVersion: typeof SCHEMA_VERSION;
    actorRef: string;
    capability: typeof CAPABILITY;
    status: 'inactive' | 'active' | 'revoked';
    attestationVersion: 1;
    policyVersion: typeof POLICY_VERSION;
    revokedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}>;

export type PhysicianReviewAttestationStoreErrorCode =
    | 'actor_invalid'
    | 'actor_missing'
    | 'attestation_conflict'
    | 'attestation_missing'
    | 'attestation_not_inactive'
    | 'schema_incompatible'
    | 'storage_unavailable'
    | 'stored_state_invalid';

export class PhysicianReviewAttestationStoreError extends Error {
    constructor(readonly code: PhysicianReviewAttestationStoreErrorCode) {
        super(`Physician review attestation rejected: ${code}`);
        this.name = 'PhysicianReviewAttestationStoreError';
    }
}

function fail(code: PhysicianReviewAttestationStoreErrorCode): never {
    throw new PhysicianReviewAttestationStoreError(code);
}

function validActorRef(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 256 && value === value.trim();
}

function validDate(value: unknown): value is Date {
    return value instanceof Date && Number.isFinite(value.getTime());
}

function record(row: typeof physicianReviewAttestations.$inferSelect): PhysicianReviewAttestationV1 {
    const status = row.status === 'inactive' || row.status === 'active' || row.status === 'revoked' ? row.status : null;
    const lifecycleValid = ((status === 'inactive' || status === 'active') && row.revokedAt === null)
        || (status === 'revoked' && row.revokedAt instanceof Date);
    const timestampOrderValid = validDate(row.createdAt) && validDate(row.updatedAt)
        && row.updatedAt.getTime() >= row.createdAt.getTime()
        && (row.revokedAt === null || (validDate(row.revokedAt) && row.revokedAt.getTime() >= row.createdAt.getTime()));
    if (row.schemaVersion !== SCHEMA_VERSION || row.capability !== CAPABILITY || !status || !lifecycleValid
        || row.attestationVersion !== 1 || row.policyVersion !== POLICY_VERSION
        || !timestampOrderValid) return fail('stored_state_invalid');
    return Object.freeze({
        schemaVersion: SCHEMA_VERSION, actorRef: row.actorRef, capability: CAPABILITY, status,
        attestationVersion: 1, policyVersion: POLICY_VERSION, revokedAt: row.revokedAt,
        createdAt: row.createdAt, updatedAt: row.updatedAt,
    });
}

function canonicalActor(actorRef: string): void {
    const matches = dbServer.select({ id: users.id }).from(users).where(eq(users.id, actorRef)).limit(2).all();
    if (matches.length === 0) return fail('actor_missing');
    if (matches.length !== 1 || matches[0].id !== actorRef) return fail('stored_state_invalid');
}

function readCurrent(actorRef: string): PhysicianReviewAttestationV1 {
    if (!hasCanonicalPhysicianReviewAttestationSchema()) return fail('schema_incompatible');
    canonicalActor(actorRef);
    const row = dbServer.select().from(physicianReviewAttestations).where(eq(physicianReviewAttestations.actorRef, actorRef)).get();
    if (!row) return fail('attestation_missing');
    return record(row);
}

function storage(error: unknown): never {
    if (error instanceof PhysicianReviewAttestationStoreError) throw error;
    throw new PhysicianReviewAttestationStoreError('storage_unavailable');
}

/** Stores only default-inactive, fixed-capability attestations for canonical local user references. */
export function createPhysicianReviewAttestationStore() {
    const load = (actorRef: unknown): PhysicianReviewAttestationV1 => {
        if (!validActorRef(actorRef)) return fail('actor_invalid');
        try { return runDbServerImmediateTransaction(() => readCurrent(actorRef)); } catch (error) { return storage(error); }
    };

    return Object.freeze({
        createInactive(actorRef: unknown): PhysicianReviewAttestationV1 {
            if (!validActorRef(actorRef)) return fail('actor_invalid');
            try {
                return runDbServerImmediateTransaction(() => {
                    if (!hasCanonicalPhysicianReviewAttestationSchema()) return fail('schema_incompatible');
                    canonicalActor(actorRef);
                    if (dbServer.select({ actorRef: physicianReviewAttestations.actorRef }).from(physicianReviewAttestations).where(eq(physicianReviewAttestations.actorRef, actorRef)).get()) return fail('attestation_conflict');
                    dbServer.insert(physicianReviewAttestations).values({
                        actorRef, schemaVersion: SCHEMA_VERSION, capability: CAPABILITY, status: 'inactive',
                        attestationVersion: 1, policyVersion: POLICY_VERSION, revokedAt: null,
                    }).run();
                    return readCurrent(actorRef);
                });
            } catch (error) { return storage(error); }
        },
        /** Activates exactly one default-inactive attestation under the SQLite writer lock. */
        activate(actorRef: unknown): PhysicianReviewAttestationV1 {
            if (!validActorRef(actorRef)) return fail('actor_invalid');
            try {
                return runDbServerImmediateTransaction(() => {
                    if (!hasCanonicalPhysicianReviewAttestationSchema()) return fail('schema_incompatible');
                    canonicalActor(actorRef);
                    const current = readCurrent(actorRef);
                    if (current.status !== 'inactive') return fail('attestation_not_inactive');
                    const outcome = dbServer.update(physicianReviewAttestations).set({
                        status: 'active',
                        updatedAt: new Date(),
                    }).where(and(
                        eq(physicianReviewAttestations.actorRef, actorRef),
                        eq(physicianReviewAttestations.schemaVersion, SCHEMA_VERSION),
                        eq(physicianReviewAttestations.capability, CAPABILITY),
                        eq(physicianReviewAttestations.status, 'inactive'),
                        eq(physicianReviewAttestations.attestationVersion, 1),
                        eq(physicianReviewAttestations.policyVersion, POLICY_VERSION),
                        isNull(physicianReviewAttestations.revokedAt),
                    )).run();
                    if (outcome.changes !== 1) return fail('attestation_conflict');
                    return readCurrent(actorRef);
                });
            } catch (error) { return storage(error); }
        },
        read: load,
    });
}
