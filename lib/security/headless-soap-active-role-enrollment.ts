/* @Codex */
import 'server-only';

import { types } from 'node:util';

const ENROLLMENT_SCHEMA = 'mediflow.headless-soap-active-role-enrollment.v1' as const;
const ATTESTATION_SCHEMA = 'mediflow.headless-soap-active-role-attestation.v1' as const;
const OPERATION_ID = 'mediflow.clinical_diary.append_soap.v1' as const;
const POLICY_VERSION = 'clinician_confirmed_single_use.v1' as const;
const TTL_MS = 8 * 60 * 60 * 1_000;
const SESSION_KEYS = ['id', 'userId', 'username', 'role', 'authChannel', 'createdAt', 'expiresAt'] as const;
const ATTESTATION_KEYS = ['attestationRef', 'actorRef', 'schemaVersion', 'role', 'operationId', 'policyVersion', 'status', 'attestationVersion', 'issuerRef', 'expiresAt', 'activatedAt', 'revocationGeneration', 'revokedAt', 'createdAt', 'updatedAt'] as const;
const objectCreate = Object.create, objectAssign = Object.assign, objectFreeze = Object.freeze;
const objectGetPrototypeOf = Object.getPrototypeOf, objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectIsFrozen = Object.isFrozen, objectPrototype = Object.prototype, reflectOwnKeys = Reflect.ownKeys;
const numberIsSafeInteger = Number.isSafeInteger, datePrototype = Date.prototype, dateGetTime = Date.prototype.getTime;
const reflectApply = Reflect.apply, regexpTest = RegExp.prototype.test, isProxy = types.isProxy, dateNow = Date.now;
const sessionIdPattern = /^[0-9a-f]{64}$/u, attestationRefPattern = /^hsar_[0-9a-f]{32}$/u, issuerRefPattern = /^hsari_[0-9a-f]{32}$/u;

export type HeadlessSoapActiveRoleEnrollmentLifecycleResult =
    | Readonly<{ kind: 'ok'; value: unknown }>
    | Readonly<{ kind: 'missing' | 'conflict' | 'denied' | 'unavailable' }>;
export type HeadlessSoapActiveRoleEnrollmentSources = Readonly<{
    resolveCurrentWebAdmin(): Promise<unknown>;
    verifyCredentials(input: unknown): Promise<unknown>;
    readAttestation(actorRef: string): HeadlessSoapActiveRoleEnrollmentLifecycleResult;
    createInactive(actorRef: string): HeadlessSoapActiveRoleEnrollmentLifecycleResult;
    activate(actorRef: string): HeadlessSoapActiveRoleEnrollmentLifecycleResult;
}>;
export type HeadlessSoapActiveRoleEnrollmentProjectionV1 = Readonly<{
    schemaVersion: typeof ENROLLMENT_SCHEMA;
    status: 'active';
    attestationVersion: 1;
}>;
export type HeadlessSoapActiveRoleEnrollmentErrorCode = 'enrollment_denied' | 'enrollment_conflict' | 'storage_unavailable';

export class HeadlessSoapActiveRoleEnrollmentError extends Error {
    constructor(readonly code: HeadlessSoapActiveRoleEnrollmentErrorCode) {
        super(`Headless SOAP active-role enrollment rejected: ${code}`);
        this.name = 'HeadlessSoapActiveRoleEnrollmentError';
    }
}
function fail(code: HeadlessSoapActiveRoleEnrollmentErrorCode): never { throw new HeadlessSoapActiveRoleEnrollmentError(code); }
function exactRecord(value: unknown, keys: readonly string[], prototype: object | null, frozen = false): Record<string, unknown> | null {
    try {
        if (typeof value !== 'object' || value === null || isProxy(value) || objectGetPrototypeOf(value) !== prototype || (frozen && !objectIsFrozen(value))) return null;
        const descriptors = objectGetOwnPropertyDescriptors(value), ownKeys = reflectOwnKeys(value);
        if (ownKeys.length !== keys.length || reflectOwnKeys(descriptors).length !== keys.length) return null;
        for (const key of keys) {
            const descriptor = descriptors[key];
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || (frozen && (descriptor.configurable || descriptor.writable))) return null;
        }
        return value as Record<string, unknown>;
    } catch { return null; }
}
function observedNow(): number { const value = dateNow(); return numberIsSafeInteger(value) && value >= 0 ? value : fail('storage_unavailable'); }
function session(value: unknown, now: number): Record<string, unknown> | null {
    const record = exactRecord(value, SESSION_KEYS, null, true);
    if (!record || typeof record.id !== 'string' || !reflectApply(regexpTest, sessionIdPattern, [record.id])
        || typeof record.userId !== 'string' || !record.userId || record.userId !== record.userId.trim() || record.userId.length > 256
        || typeof record.username !== 'string' || !record.username || record.username !== record.username.trim()
        || record.role !== 'admin' || record.authChannel !== 'web'
        || !numberIsSafeInteger(record.createdAt) || !numberIsSafeInteger(record.expiresAt)
        || (record.createdAt as number) < 0 || (record.createdAt as number) > now || (record.expiresAt as number) <= now) return null;
    return record;
}
function sameSession(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
    for (const key of SESSION_KEYS) if (before[key] !== after[key]) return false;
    return true;
}
function verifiedAccount(value: unknown, current: Record<string, unknown>): boolean {
    try {
        if (typeof value !== 'object' || value === null || isProxy(value) || objectGetPrototypeOf(value) !== objectPrototype) return false;
        const descriptors = objectGetOwnPropertyDescriptors(value);
        for (const key of ['id', 'username', 'role'] as const) {
            const descriptor = descriptors[key];
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return false;
        }
        return descriptors.id.value === current.userId && descriptors.username.value === current.username && descriptors.role.value === 'admin';
    } catch { return false; }
}
function result(value: unknown): HeadlessSoapActiveRoleEnrollmentLifecycleResult | null {
    try {
        if (typeof value !== 'object' || value === null || isProxy(value) || objectGetPrototypeOf(value) !== objectPrototype) return null;
        const descriptors = objectGetOwnPropertyDescriptors(value), kind = descriptors.kind;
        if (!kind || !kind.enumerable || !('value' in kind)) return null;
        if (kind.value === 'ok') return descriptors.value?.enumerable && 'value' in descriptors.value ? { kind: 'ok', value: descriptors.value.value } : null;
        return ['missing', 'conflict', 'denied', 'unavailable'].includes(kind.value as string) ? { kind: kind.value } as HeadlessSoapActiveRoleEnrollmentLifecycleResult : null;
    } catch { return null; }
}
function lifecycle(call: () => unknown): HeadlessSoapActiveRoleEnrollmentLifecycleResult {
    let value: unknown;
    try { value = call(); } catch { return fail('storage_unavailable'); }
    return result(value) ?? fail('storage_unavailable');
}
function requireOk(value: HeadlessSoapActiveRoleEnrollmentLifecycleResult, allowMissing = false): unknown {
    if (value.kind === 'ok') return value.value;
    if (value.kind === 'missing' && allowMissing) return undefined;
    if (value.kind === 'conflict') return fail('enrollment_conflict');
    if (value.kind === 'denied') return fail('enrollment_denied');
    return fail('storage_unavailable');
}
function dateMillis(value: unknown): number | null {
    try {
        if (typeof value !== 'object' || value === null || isProxy(value) || objectGetPrototypeOf(value) !== datePrototype) return null;
        const milliseconds = reflectApply(dateGetTime, value, []);
        return numberIsSafeInteger(milliseconds) && milliseconds >= 0 ? milliseconds : null;
    } catch { return null; }
}
function validActivation(value: unknown, actorRef: string, now: number): boolean {
    const record = exactRecord(value, ATTESTATION_KEYS, null, true);
    if (!record || record.actorRef !== actorRef || record.schemaVersion !== ATTESTATION_SCHEMA || record.role !== 'physician'
        || record.operationId !== OPERATION_ID || record.policyVersion !== POLICY_VERSION || record.status !== 'active'
        || record.attestationVersion !== 1 || record.revocationGeneration !== 0 || record.revokedAt !== null
        || typeof record.attestationRef !== 'string' || !reflectApply(regexpTest, attestationRefPattern, [record.attestationRef])
        || typeof record.issuerRef !== 'string' || !reflectApply(regexpTest, issuerRefPattern, [record.issuerRef])) return false;
    const created = dateMillis(record.createdAt), updated = dateMillis(record.updatedAt);
    const activated = dateMillis(record.activatedAt), expires = dateMillis(record.expiresAt);
    return created !== null && updated !== null && activated !== null && expires !== null
        && activated >= created && updated >= activated && updated <= now && activated <= now && now < expires
        && expires - activated === TTL_MS;
}

/** PIN-only controlled setup. Its projection grants no active-role session or clinical authority. */
export function createHeadlessSoapActiveRoleEnrollmentService(sources: HeadlessSoapActiveRoleEnrollmentSources) {
    async function enroll(candidatePin: string): Promise<HeadlessSoapActiveRoleEnrollmentProjectionV1> {
        if (typeof candidatePin !== 'string' || candidatePin.length < 4 || candidatePin.length > 8) return fail('enrollment_denied');
        let beforeValue: unknown;
        try { beforeValue = await sources.resolveCurrentWebAdmin(); } catch { return fail('storage_unavailable'); }
        const before = session(beforeValue, observedNow());
        if (!before) return fail('enrollment_denied');
        let verification: unknown;
        try { verification = await sources.verifyCredentials({ username: before.username, pin: candidatePin }); } catch { return fail('storage_unavailable'); }
        const verified = exactRecord(verification, ['kind', 'account'], objectPrototype);
        if (!verified || verified.kind !== 'verified' || !verifiedAccount(verified.account, before)) return fail('enrollment_denied');
        let afterValue: unknown;
        try { afterValue = await sources.resolveCurrentWebAdmin(); } catch { return fail('storage_unavailable'); }
        const after = session(afterValue, observedNow());
        if (!after || !sameSession(before, after)) return fail('enrollment_denied');
        const actorRef = before.userId as string;
        const current = lifecycle(() => sources.readAttestation(actorRef));
        if (current.kind === 'missing') requireOk(lifecycle(() => sources.createInactive(actorRef)));
        else requireOk(current, true);
        const activated = requireOk(lifecycle(() => sources.activate(actorRef)));
        if (!validActivation(activated, actorRef, observedNow())) return fail('storage_unavailable');
        return objectFreeze(objectAssign(objectCreate(null), { schemaVersion: ENROLLMENT_SCHEMA, status: 'active' as const, attestationVersion: 1 as const })) as HeadlessSoapActiveRoleEnrollmentProjectionV1;
    }
    return objectFreeze(objectAssign(objectCreate(null), { enroll }));
}
