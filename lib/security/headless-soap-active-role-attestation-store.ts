/* @Codex */
import 'server-only';

import { randomBytes } from 'node:crypto';
import { types } from 'node:util';

import { dbServer, hasCanonicalHeadlessSoapActiveRoleAttestationSchema, runDbServerImmediateTransaction } from '../db-server';

const SCHEMA_VERSION = 'mediflow.headless-soap-active-role-attestation.v1' as const;
const ROLE = 'physician' as const;
const OPERATION_ID = 'mediflow.clinical_diary.append_soap.v1' as const;
const POLICY_VERSION = 'clinician_confirmed_single_use.v1' as const;
const objectCreate = Object.create, objectFreeze = Object.freeze, objectAssign = Object.assign, objectPrototype = Object.prototype;
const objectGetPrototypeOf = Object.getPrototypeOf, objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const reflectOwnKeys = Reflect.ownKeys, arrayIsArray = Array.isArray, arrayPrototype = Array.prototype;
const numberIsSafeInteger = Number.isSafeInteger, dateConstructor = Date, errorConstructor = Error;
const regexpTest = RegExp.prototype.test, refPattern = /^hsar_[0-9a-f]{32}$/;
const isProxy = types.isProxy, entropy = randomBytes, transaction = runDbServerImmediateTransaction;
const canonicalSchema = hasCanonicalHeadlessSoapActiveRoleAttestationSchema;
const errors = new WeakSet<object>(), brandError = WeakSet.prototype.add.bind(errors), hasError = WeakSet.prototype.has.bind(errors);
const client = dbServer.$client, prepare = client.prepare.bind(client);
const statementPrototype = objectGetPrototypeOf(prepare('SELECT 1')) as { get: (...args: unknown[]) => unknown; all: (...args: unknown[]) => unknown; run: (...args: unknown[]) => unknown };
const invoke = Function.prototype.call.bind(Function.prototype.call);
const get = (query: string, value: string): unknown => invoke(statementPrototype.get, prepare(query), value);
const all = (query: string, value: string): unknown => invoke(statementPrototype.all, prepare(query), value);
const run = (query: string, values: readonly unknown[]): unknown => invoke(statementPrototype.run, prepare(query), ...values);

const SELECT_ACTOR = 'SELECT id FROM users WHERE id = ? LIMIT 2';
const SELECT_REF = 'SELECT attestation_ref AS attestationRef FROM headless_soap_active_role_attestations WHERE attestation_ref = ? LIMIT 1';
const SELECT_ATTESTATION = `SELECT attestation_ref AS attestationRef, actor_ref AS actorRef, schema_version AS schemaVersion,
 role, operation_id AS operationId, policy_version AS policyVersion, status, attestation_version AS attestationVersion,
 issuer_ref AS issuerRef, expires_at AS expiresAt, activated_at AS activatedAt, revocation_generation AS revocationGeneration,
 revoked_at AS revokedAt, created_at AS createdAt, updated_at AS updatedAt
 FROM headless_soap_active_role_attestations WHERE actor_ref = ? LIMIT 1`;
const INSERT_ATTESTATION = `INSERT INTO headless_soap_active_role_attestations (
 attestation_ref, actor_ref, schema_version, role, operation_id, policy_version, status, attestation_version,
 issuer_ref, expires_at, activated_at, revocation_generation, revoked_at, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, 'inactive', 1, NULL, NULL, NULL, 0, NULL, unixepoch(), unixepoch())`;
const REVOKE_ATTESTATION = `UPDATE headless_soap_active_role_attestations
 SET status = 'revoked', revocation_generation = 1, revoked_at = unixepoch(), updated_at = unixepoch()
 WHERE actor_ref = ? AND attestation_ref = ? AND schema_version = ? AND role = ? AND operation_id = ?
 AND policy_version = ? AND status = 'inactive' AND attestation_version = 1 AND issuer_ref IS NULL
 AND expires_at IS NULL AND activated_at IS NULL AND revocation_generation = 0 AND revoked_at IS NULL`;
const rowKeys = ['attestationRef', 'actorRef', 'schemaVersion', 'role', 'operationId', 'policyVersion', 'status', 'attestationVersion', 'issuerRef', 'expiresAt', 'activatedAt', 'revocationGeneration', 'revokedAt', 'createdAt', 'updatedAt'] as const;
const expectedKeys = ['attestationRef', 'attestationVersion', 'revocationGeneration'] as const;

type Lifecycle = { status: 'inactive'; revocationGeneration: 0; revokedAt: null } | { status: 'revoked'; revocationGeneration: 1; revokedAt: Date };
export type HeadlessSoapActiveRoleAttestationV1 = Readonly<{ attestationRef: string; actorRef: string; schemaVersion: typeof SCHEMA_VERSION; role: typeof ROLE; operationId: typeof OPERATION_ID; policyVersion: typeof POLICY_VERSION; attestationVersion: 1; issuerRef: null; expiresAt: null; activatedAt: null; createdAt: Date; updatedAt: Date } & Lifecycle>;
export type HeadlessSoapActiveRoleAttestationRevokeExpected = Readonly<{ attestationRef: string; attestationVersion: 1; revocationGeneration: 0 }>;
export type HeadlessSoapActiveRoleAttestationStoreErrorCode = 'actor_invalid' | 'actor_missing' | 'attestation_conflict' | 'attestation_missing' | 'schema_incompatible' | 'storage_unavailable' | 'stored_state_invalid';
export type HeadlessSoapActiveRoleAttestationStoreError = Error & Readonly<{ code: HeadlessSoapActiveRoleAttestationStoreErrorCode }>;

function fail(code: HeadlessSoapActiveRoleAttestationStoreErrorCode): never {
    const error = objectFreeze(objectAssign(new errorConstructor(`Headless SOAP attestation rejected: ${code}`), { name: 'HeadlessSoapActiveRoleAttestationStoreError', code })) as HeadlessSoapActiveRoleAttestationStoreError;
    brandError(error); throw error;
}
export function isHeadlessSoapActiveRoleAttestationStoreError(value: unknown): value is HeadlessSoapActiveRoleAttestationStoreError { return typeof value === 'object' && value !== null && hasError(value); }
function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    if (value === null || typeof value !== 'object' || arrayIsArray(value) || isProxy(value) || objectGetPrototypeOf(value) !== objectPrototype) return null;
    const descriptors = objectGetOwnPropertyDescriptors(value);
    if (reflectOwnKeys(descriptors).length !== keys.length || reflectOwnKeys(value).length !== keys.length) return null;
    const copy = objectCreate(null) as Record<string, unknown>;
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
        copy[key] = descriptor.value;
    }
    return copy;
}
function exactArray(value: unknown): unknown[] | null {
    if (!arrayIsArray(value) || isProxy(value) || objectGetPrototypeOf(value) !== arrayPrototype) return null;
    const descriptors = objectGetOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>, length = descriptors.length;
    if (!length || length.enumerable || !('value' in length) || !numberIsSafeInteger(length.value) || length.value < 0) return null;
    const values: unknown[] = [];
    for (let index = 0; index < length.value; index++) {
        const descriptor = descriptors[index];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
        values.push(descriptor.value);
    }
    return values;
}
function actor(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 256 && value === value.trim(); }
function seconds(value: unknown): value is number { return typeof value === 'number' && numberIsSafeInteger(value) && value >= 0; }
function date(value: number): Date { return new dateConstructor(value * 1000); }
function ref(): string {
    const bytes = entropy(16), hex = '0123456789abcdef'; let value = 'hsar_';
    for (let index = 0; index < 16; index++) { const byte = bytes[index]; if (!numberIsSafeInteger(byte) || byte < 0 || byte > 255) return fail('storage_unavailable'); value += hex[byte >>> 4] + hex[byte & 15]; }
    return value;
}
function canonicalActor(actorRef: string): void {
    const rows = exactArray(all(SELECT_ACTOR, actorRef));
    if (!rows) return fail('stored_state_invalid');
    if (rows.length === 0) return fail('actor_missing');
    const row = exactRecord(rows[0], ['id']);
    if (rows.length !== 1 || !row || row.id !== actorRef) return fail('stored_state_invalid');
}
function expected(value: unknown): HeadlessSoapActiveRoleAttestationRevokeExpected | null {
    const candidate = exactRecord(value, expectedKeys);
    if (!candidate || typeof candidate.attestationRef !== 'string' || !invoke(regexpTest, refPattern, candidate.attestationRef)
        || candidate.attestationVersion !== 1 || candidate.revocationGeneration !== 0) return null;
    return objectFreeze(objectAssign(objectCreate(null), { attestationRef: candidate.attestationRef, attestationVersion: 1 as const, revocationGeneration: 0 as const })) as HeadlessSoapActiveRoleAttestationRevokeExpected;
}
function record(value: unknown): HeadlessSoapActiveRoleAttestationV1 {
    const row = exactRecord(value, rowKeys);
    const revokedAt = row?.revokedAt;
    const inactive = row?.status === 'inactive' && row.revocationGeneration === 0 && row.revokedAt === null;
    const revoked = row?.status === 'revoked' && row.revocationGeneration === 1 && seconds(revokedAt);
    if (!row || !actor(row.actorRef) || row.schemaVersion !== SCHEMA_VERSION || row.role !== ROLE || row.operationId !== OPERATION_ID || row.policyVersion !== POLICY_VERSION || row.attestationVersion !== 1 || row.issuerRef !== null || row.expiresAt !== null || row.activatedAt !== null || (!inactive && !revoked) || !seconds(row.createdAt) || !seconds(row.updatedAt) || row.updatedAt < row.createdAt || (revoked && (revokedAt as number) < row.createdAt) || typeof row.attestationRef !== 'string' || !invoke(regexpTest, refPattern, row.attestationRef)) return fail('stored_state_invalid');
    const lifecycle: Lifecycle = inactive ? { status: 'inactive', revocationGeneration: 0, revokedAt: null } : { status: 'revoked', revocationGeneration: 1, revokedAt: date(revokedAt as number) };
    return objectFreeze(objectAssign(objectCreate(null), { attestationRef: row.attestationRef, actorRef: row.actorRef, schemaVersion: SCHEMA_VERSION, role: ROLE, operationId: OPERATION_ID, policyVersion: POLICY_VERSION, attestationVersion: 1 as const, issuerRef: null, expiresAt: null, activatedAt: null, createdAt: date(row.createdAt), updatedAt: date(row.updatedAt) }, lifecycle)) as HeadlessSoapActiveRoleAttestationV1;
}
function readExact(actorRef: string): HeadlessSoapActiveRoleAttestationV1 {
    canonicalActor(actorRef); const row = get(SELECT_ATTESTATION, actorRef);
    if (row === undefined) return fail('attestation_missing'); return record(row);
}
function storage(error: unknown): never { if (isHeadlessSoapActiveRoleAttestationStoreError(error)) throw error; return fail('storage_unavailable'); }

/** Host-owned persistence for a fixed inactive SOAP attestation. It grants no authority. */
export function createHeadlessSoapActiveRoleAttestationStore() {
    const read = (actorRef: unknown): HeadlessSoapActiveRoleAttestationV1 => {
        if (!actor(actorRef)) return fail('actor_invalid');
        try { return transaction(() => { if (!canonicalSchema()) return fail('schema_incompatible'); return readExact(actorRef); }); } catch (error) { return storage(error); }
    };
    return objectFreeze(objectAssign(objectCreate(null), {
        createInactive(actorRef: unknown): HeadlessSoapActiveRoleAttestationV1 {
            if (!actor(actorRef)) return fail('actor_invalid');
            try { return transaction(() => {
                if (!canonicalSchema()) return fail('schema_incompatible'); canonicalActor(actorRef);
                const existing = get(SELECT_ATTESTATION, actorRef);
                if (existing !== undefined) { record(existing); return fail('attestation_conflict'); }
                for (let attempt = 0; attempt < 3; attempt++) {
                    const attestationRef = ref(), collision = get(SELECT_REF, attestationRef);
                    if (collision !== undefined) { if (!exactRecord(collision, ['attestationRef'])) return fail('stored_state_invalid'); continue; }
                    const result = exactRecord(run(INSERT_ATTESTATION, [attestationRef, actorRef, SCHEMA_VERSION, ROLE, OPERATION_ID, POLICY_VERSION]), ['changes', 'lastInsertRowid']);
                    if (!result || result.changes !== 1 || (typeof result.lastInsertRowid !== 'number' && typeof result.lastInsertRowid !== 'bigint')) return fail('storage_unavailable');
                    return readExact(actorRef);
                }
                return fail('attestation_conflict');
            }); } catch (error) { return storage(error); }
        },
        revoke(actorRef: unknown, current: unknown): HeadlessSoapActiveRoleAttestationV1 {
            if (!actor(actorRef) || !expected(current)) return fail('actor_invalid');
            const currentExpected = expected(current)!;
            try { return transaction(() => {
                if (!canonicalSchema()) return fail('schema_incompatible');
                const before = readExact(actorRef);
                if (before.status !== 'inactive' || before.attestationRef !== currentExpected.attestationRef || before.attestationVersion !== currentExpected.attestationVersion || before.revocationGeneration !== currentExpected.revocationGeneration) return fail('attestation_conflict');
                const result = exactRecord(run(REVOKE_ATTESTATION, [actorRef, currentExpected.attestationRef, SCHEMA_VERSION, ROLE, OPERATION_ID, POLICY_VERSION]), ['changes', 'lastInsertRowid']);
                if (!result || (typeof result.lastInsertRowid !== 'number' && typeof result.lastInsertRowid !== 'bigint')) return fail('storage_unavailable');
                if (result.changes !== 1) return fail('attestation_conflict');
                const revoked = readExact(actorRef);
                if (revoked.status !== 'revoked' || revoked.revocationGeneration !== 1 || revoked.revokedAt === null) return fail('stored_state_invalid');
                return revoked;
            }); } catch (error) { return storage(error); }
        }, read,
    }));
}
