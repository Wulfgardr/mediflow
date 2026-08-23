/* @Codex */
import 'server-only';

import { eq } from 'drizzle-orm';

import { dbServer, runDbServerImmediateTransaction } from '../db-server';
import { physicianReviewAttestations, users } from '../schema';

const SCHEMA_VERSION = 'mediflow.physician-review-attestation.v1' as const;
const CAPABILITY = 'physician_terminal_review' as const;
const POLICY_VERSION = 'physician_terminal_review.v1' as const;

export type PhysicianReviewAttestationV1 = Readonly<{
    schemaVersion: typeof SCHEMA_VERSION;
    actorRef: string;
    capability: typeof CAPABILITY;
    status: 'inactive' | 'revoked';
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

function record(row: typeof physicianReviewAttestations.$inferSelect): PhysicianReviewAttestationV1 {
    const status = row.status === 'inactive' || row.status === 'revoked' ? row.status : null;
    const lifecycleValid = (status === 'inactive' && row.revokedAt === null) || (status === 'revoked' && row.revokedAt instanceof Date);
    if (row.schemaVersion !== SCHEMA_VERSION || row.capability !== CAPABILITY || !status || !lifecycleValid
        || row.attestationVersion !== 1 || row.policyVersion !== POLICY_VERSION
        || !(row.createdAt instanceof Date) || !(row.updatedAt instanceof Date)) return fail('stored_state_invalid');
    return Object.freeze({
        schemaVersion: SCHEMA_VERSION, actorRef: row.actorRef, capability: CAPABILITY, status,
        attestationVersion: 1, policyVersion: POLICY_VERSION, revokedAt: row.revokedAt,
        createdAt: row.createdAt, updatedAt: row.updatedAt,
    });
}

function storage(error: unknown): never {
    if (error instanceof PhysicianReviewAttestationStoreError) throw error;
    throw new PhysicianReviewAttestationStoreError('storage_unavailable');
}

/** Stores only default-inactive, fixed-capability attestations for canonical local user references. */
export function createPhysicianReviewAttestationStore() {
    const load = (actorRef: unknown): PhysicianReviewAttestationV1 => {
        if (!validActorRef(actorRef)) return fail('actor_invalid');
        try {
            const row = dbServer.select().from(physicianReviewAttestations)
                .where(eq(physicianReviewAttestations.actorRef, actorRef)).get();
            if (!row) return fail('attestation_missing');
            return record(row);
        } catch (error) { return storage(error); }
    };

    return Object.freeze({
        createInactive(actorRef: unknown): PhysicianReviewAttestationV1 {
            if (!validActorRef(actorRef)) return fail('actor_invalid');
            try {
                return runDbServerImmediateTransaction(() => {
                    const actor = dbServer.select({ id: users.id }).from(users).where(eq(users.id, actorRef)).limit(2).all();
                    if (actor.length === 0) return fail('actor_missing');
                    if (actor.length !== 1) return fail('stored_state_invalid');
                    if (dbServer.select({ actorRef: physicianReviewAttestations.actorRef }).from(physicianReviewAttestations).where(eq(physicianReviewAttestations.actorRef, actorRef)).get()) return fail('attestation_conflict');
                    dbServer.insert(physicianReviewAttestations).values({
                        actorRef, schemaVersion: SCHEMA_VERSION, capability: CAPABILITY, status: 'inactive',
                        attestationVersion: 1, policyVersion: POLICY_VERSION, revokedAt: null,
                    }).run();
                    return load(actorRef);
                });
            } catch (error) { return storage(error); }
        },
        read: load,
    });
}
