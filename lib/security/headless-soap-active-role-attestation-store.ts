/* @Codex */
import 'server-only';

import { randomBytes } from 'node:crypto';
import { types } from 'node:util';
import { eq } from 'drizzle-orm';

import { dbServer, hasCanonicalHeadlessSoapActiveRoleAttestationSchema, runDbServerImmediateTransaction } from '../db-server';
import { headlessSoapActiveRoleAttestations, users } from '../schema';

const SCHEMA_VERSION = 'mediflow.headless-soap-active-role-attestation.v1' as const;
const ROLE = 'physician' as const;
const OPERATION_ID = 'mediflow.clinical_diary.append_soap.v1' as const;
const POLICY_VERSION = 'clinician_confirmed_single_use.v1' as const;
const select = dbServer.select.bind(dbServer);
const transaction = runDbServerImmediateTransaction;
const canonicalSchema = hasCanonicalHeadlessSoapActiveRoleAttestationSchema;
const entropy = randomBytes;
const dateGetTime = Date.prototype.getTime;
const brandedErrors = new WeakSet<object>();

export type HeadlessSoapActiveRoleAttestationV1 = Readonly<{
    attestationRef: string;
    actorRef: string;
    schemaVersion: typeof SCHEMA_VERSION;
    role: typeof ROLE;
    operationId: typeof OPERATION_ID;
    policyVersion: typeof POLICY_VERSION;
    status: 'inactive';
    attestationVersion: 1;
    issuerRef: null;
    expiresAt: null;
    activatedAt: null;
    revocationGeneration: 0;
    revokedAt: null;
    createdAt: Date;
    updatedAt: Date;
}>;

export type HeadlessSoapActiveRoleAttestationStoreErrorCode =
    | 'actor_invalid' | 'actor_missing' | 'attestation_conflict' | 'attestation_missing'
    | 'schema_incompatible' | 'storage_unavailable' | 'stored_state_invalid';

export type HeadlessSoapActiveRoleAttestationStoreError = Error & Readonly<{
    code: HeadlessSoapActiveRoleAttestationStoreErrorCode;
}>;

function fail(code: HeadlessSoapActiveRoleAttestationStoreErrorCode): never {
    const error = Object.freeze(Object.assign(new Error(`Headless SOAP attestation rejected: ${code}`), {
        name: 'HeadlessSoapActiveRoleAttestationStoreError', code,
    })) as HeadlessSoapActiveRoleAttestationStoreError;
    brandedErrors.add(error);
    throw error;
}

export function isHeadlessSoapActiveRoleAttestationStoreError(value: unknown): value is HeadlessSoapActiveRoleAttestationStoreError {
    return typeof value === 'object' && value !== null && brandedErrors.has(value);
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)
        || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== keys.length || Reflect.ownKeys(value).length !== keys.length) return null;
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
        result[key] = descriptor.value;
    }
    return result;
}

function validActorRef(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 256 && value === value.trim();
}
function validDate(value: unknown): value is Date {
    if (value === null || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Date.prototype) return false;
    const valueMs = dateGetTime.call(value);
    return Number.isFinite(valueMs) && valueMs >= 0 && valueMs % 1000 === 0;
}
function timeOf(value: Date): number { return dateGetTime.call(value); }
function timestamp(): Date { return new Date(Math.floor(Date.now() / 1000) * 1000); }
function attestationRef(): string { return `hsar_${entropy(16).toString('hex')}`; }

const rowKeys = [
    'attestationRef', 'actorRef', 'schemaVersion', 'role', 'operationId', 'policyVersion', 'status',
    'attestationVersion', 'issuerRef', 'expiresAt', 'activatedAt', 'revocationGeneration', 'revokedAt', 'createdAt', 'updatedAt',
] as const;
function record(value: unknown): HeadlessSoapActiveRoleAttestationV1 {
    const row = exactRecord(value, rowKeys);
    if (!row || !validActorRef(row.actorRef) || row.schemaVersion !== SCHEMA_VERSION || row.role !== ROLE
        || row.operationId !== OPERATION_ID || row.policyVersion !== POLICY_VERSION || row.status !== 'inactive'
        || row.attestationVersion !== 1 || row.issuerRef !== null || row.expiresAt !== null || row.activatedAt !== null
        || row.revocationGeneration !== 0 || row.revokedAt !== null || !validDate(row.createdAt) || !validDate(row.updatedAt)
        || timeOf(row.updatedAt) < timeOf(row.createdAt) || typeof row.attestationRef !== 'string'
        || !/^hsar_[0-9a-f]{32}$/.test(row.attestationRef)) return fail('stored_state_invalid');
    return Object.freeze(Object.assign(Object.create(null), {
        attestationRef: row.attestationRef, actorRef: row.actorRef, schemaVersion: SCHEMA_VERSION, role: ROLE,
        operationId: OPERATION_ID, policyVersion: POLICY_VERSION, status: 'inactive' as const, attestationVersion: 1 as const,
        issuerRef: null, expiresAt: null, activatedAt: null, revocationGeneration: 0 as const, revokedAt: null,
        createdAt: new Date(timeOf(row.createdAt)), updatedAt: new Date(timeOf(row.updatedAt)),
    })) as HeadlessSoapActiveRoleAttestationV1;
}
function canonicalActor(actorRef: string): void {
    const matches = select({ id: users.id }).from(users).where(eq(users.id, actorRef)).limit(2).all();
    if (matches.length === 0) return fail('actor_missing');
    const match = exactRecord(matches[0], ['id']);
    if (matches.length !== 1 || !match || match.id !== actorRef) return fail('stored_state_invalid');
}
function storage(error: unknown): never {
    if (isHeadlessSoapActiveRoleAttestationStoreError(error)) throw error;
    return fail('storage_unavailable');
}

/** Host-owned persistence for a fixed, inactive SOAP authorization attestation; it grants no authority. */
export function createHeadlessSoapActiveRoleAttestationStore() {
    const read = (actorRef: unknown): HeadlessSoapActiveRoleAttestationV1 => {
        if (!validActorRef(actorRef)) return fail('actor_invalid');
        try {
            return transaction(() => {
                if (!canonicalSchema()) return fail('schema_incompatible');
                canonicalActor(actorRef);
                const row = select().from(headlessSoapActiveRoleAttestations)
                    .where(eq(headlessSoapActiveRoleAttestations.actorRef, actorRef)).get();
                if (!row) return fail('attestation_missing');
                return record(row);
            });
        } catch (error) { return storage(error); }
    };
    return Object.freeze(Object.assign(Object.create(null), {
        createInactive(actorRef: unknown): HeadlessSoapActiveRoleAttestationV1 {
            if (!validActorRef(actorRef)) return fail('actor_invalid');
            try {
                return transaction(() => {
                    if (!canonicalSchema()) return fail('schema_incompatible');
                    canonicalActor(actorRef);
                    if (select({ actorRef: headlessSoapActiveRoleAttestations.actorRef }).from(headlessSoapActiveRoleAttestations)
                        .where(eq(headlessSoapActiveRoleAttestations.actorRef, actorRef)).get()) return fail('attestation_conflict');
                    const now = timestamp();
                    dbServer.insert(headlessSoapActiveRoleAttestations).values({
                        attestationRef: attestationRef(), actorRef, schemaVersion: SCHEMA_VERSION, role: ROLE,
                        operationId: OPERATION_ID, policyVersion: POLICY_VERSION, status: 'inactive', attestationVersion: 1,
                        issuerRef: null, expiresAt: null, activatedAt: null, revocationGeneration: 0, revokedAt: null,
                        createdAt: now, updatedAt: now,
                    }).run();
                    return read(actorRef);
                });
            } catch (error) { return storage(error); }
        },
        read,
    }));
}
