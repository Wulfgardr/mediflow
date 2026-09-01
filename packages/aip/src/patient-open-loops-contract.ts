/* @Codex */
import { types } from 'node:util';

export const PATIENT_OPEN_LOOPS_READ_OPERATION_V1 = 'mediflow.patient.open_loops.read.v1' as const;
export const PATIENT_OPEN_LOOPS_READ_MAX_ITEMS_V1 = 32 as const;
export const PATIENT_OPEN_LOOPS_READ_PURPOSE_V1 = 'care_coordination' as const;
export const PATIENT_OPEN_LOOPS_READ_TIMEOUT_MODE_V1 = 'cooperative_pending_promise_and_post_callback_fence' as const;
export type PatientOpenLoopsReadV1ErrorCode = 'invalid_input' | 'operation_unavailable'
    | 'authorization_denied' | 'owner_unavailable' | 'lease_unavailable' | 'lease_replay' | 'scope_changed'
    | 'revoked' | 'expired' | 'timeout' | 'cancelled' | 'restart_changed'
    | 'snapshot_unavailable' | 'audit_unavailable' | 'disposed';
export class PatientOpenLoopsReadV1Error extends Error {
    constructor(public readonly code: PatientOpenLoopsReadV1ErrorCode) {
        super(`Patient open-loops read rejected: ${code}`);
        this.name = 'PatientOpenLoopsReadV1Error';
    }
}
export type PatientOpenLoopItemV1 = Readonly<{
    loopRef: string; kind: 'results_pending' | 'series_stalled' | 'registered_expectation';
    temporalState: 'open' | 'overdue' | 'unscheduled'; openedAt: number;
    dueAt: number | null; revision: number;
}>;
export type PatientOpenLoopsReadResultV1 = Readonly<{
    schemaVersion: 'mediflow.patient.open_loops.read.result.v1';
    operationId: typeof PATIENT_OPEN_LOOPS_READ_OPERATION_V1;
    capabilityId: typeof PATIENT_OPEN_LOOPS_READ_OPERATION_V1;
    outcome: 'read'; items: readonly PatientOpenLoopItemV1[]; truncated: boolean; snapshotRevision: number;
    receipt: Readonly<{
        schemaVersion: 'mediflow.patient.open_loops.read.receipt.v1'; receiptRef: string;
        operationId: typeof PATIENT_OPEN_LOOPS_READ_OPERATION_V1;
        capabilityId: typeof PATIENT_OPEN_LOOPS_READ_OPERATION_V1;
        outcome: 'read'; ownerRefHash: string; leaseRefHash: string; receiptRefHash: string;
        generation: number; revocationGeneration: number; selectionEpoch: number;
        snapshotRevision: number; itemCount: number; truncated: boolean; timestamp: number;
    }>;
}>;

export const INPUT_KEYS = ['schemaVersion', 'operationId'] as const;
export const LEASE_KEYS = ['status', 'ownerIdentity', 'leaseIdentity', 'ownerRef', 'leaseRef', 'purposeCode',
    'operationId', 'capabilityId', 'maxStage', 'generation', 'revocationGeneration', 'selectionEpoch',
    'restartGeneration', 'expiresAt'] as const;
export const SNAPSHOT_KEYS = ['status', 'ownerIdentity', 'leaseIdentity', 'snapshotIdentity', 'generation',
    'revocationGeneration', 'selectionEpoch', 'restartGeneration', 'revision', 'capturedAt', 'truncated', 'items'] as const;
export const CURRENT_KEYS = ['status', 'ownerIdentity', 'leaseIdentity', 'snapshotIdentity', 'generation',
    'revocationGeneration', 'selectionEpoch', 'restartGeneration', 'revision'] as const;
const ITEM_KEYS = ['loopRef', 'kind', 'temporalState', 'openedAt', 'dueAt', 'revision'] as const;
export const REF = /^[a-z][a-z0-9._-]{15,127}$/u;
const LOOP_REF = /^aipl_[0-9a-f]{64}$/u;
export const RECEIPT_REF = /^aipr_[0-9a-f]{64}$/u;
export const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const objectAssign = Object.assign, objectCreate = Object.create, objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf, objectIsFrozen = Object.isFrozen;
const reflectOwnKeys = Reflect.ownKeys, reflectApply = Reflect.apply;
const regexpTest = RegExp.prototype.test, numberIsSafeInteger = Number.isSafeInteger;
const isProxy = types.isProxy;

export function fail(code: PatientOpenLoopsReadV1ErrorCode): never { throw new PatientOpenLoopsReadV1Error(code); }
export function record<T extends object>(value: T): Readonly<T> {
    return objectFreeze(objectAssign(objectCreate(null), value)) as Readonly<T>;
}
export function matches(pattern: RegExp, value: unknown): value is string {
    return typeof value === 'string' && reflectApply(regexpTest, pattern, [value]);
}
export function integer(value: unknown, minimum = 0): value is number {
    return numberIsSafeInteger(value) && (value as number) >= minimum;
}
export function exact(value: unknown, keys: readonly string[], canonical = true): Record<string, unknown> | null {
    try {
        if (typeof value !== 'object' || value === null || isProxy(value)) return null;
        const prototype = objectGetPrototypeOf(value);
        if ((canonical && (prototype !== null || !objectIsFrozen(value)))
            || (!canonical && prototype !== null && prototype !== Object.prototype)) return null;
        const actual = reflectOwnKeys(value);
        if (actual.length !== keys.length) return null;
        const output = objectCreate(null) as Record<string, unknown>;
        for (let index = 0; index < keys.length; index += 1) {
            const key = keys[index]!;
            if (actual[index] !== key) return null;
            const descriptor = objectGetOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)
                || (canonical && (descriptor.configurable || descriptor.writable))) return null;
            output[key] = descriptor.value;
        }
        return output;
    } catch { return null; }
}
export function opaque(value: unknown): value is object {
    try { return typeof value === 'object' && value !== null && !isProxy(value)
        && objectGetPrototypeOf(value) === null && objectIsFrozen(value) && reflectOwnKeys(value).length === 0;
    } catch { return false; }
}
function frozenArrayValues(value: unknown): readonly unknown[] | null {
    try {
        if (isProxy(value) || !Array.isArray(value) || objectGetPrototypeOf(value) !== Array.prototype
            || !objectIsFrozen(value) || value.length > PATIENT_OPEN_LOOPS_READ_MAX_ITEMS_V1) return null;
        const keys = reflectOwnKeys(value);
        if (keys.length !== value.length + 1 || keys[value.length] !== 'length') return null;
        const output: unknown[] = [];
        for (let index = 0; index < value.length; index += 1) {
            const descriptor = objectGetOwnPropertyDescriptor(value, String(index));
            if (keys[index] !== String(index) || !descriptor || !descriptor.enumerable || !('value' in descriptor)
                || descriptor.configurable || descriptor.writable) return null;
            output.push(descriptor.value);
        }
        return output;
    } catch { return null; }
}
export function parseItems(candidate: unknown, capturedAt: number): readonly PatientOpenLoopItemV1[] {
    const values = frozenArrayValues(candidate);
    if (!values) return fail('snapshot_unavailable');
    const output: PatientOpenLoopItemV1[] = [];
    const seen = new Set<string>();
    for (const item of values) {
        const value = exact(item, ITEM_KEYS);
        if (!value || !matches(LOOP_REF, value.loopRef) || seen.has(value.loopRef)
            || !['results_pending', 'series_stalled', 'registered_expectation'].includes(value.kind as string)
            || !['open', 'overdue', 'unscheduled'].includes(value.temporalState as string)
            || !integer(value.openedAt) || value.openedAt > capturedAt
            || !((value.temporalState === 'unscheduled' && value.dueAt === null)
                || (value.temporalState === 'overdue' && integer(value.dueAt)
                    && value.dueAt >= value.openedAt && value.dueAt < capturedAt)
                || (value.temporalState === 'open' && integer(value.dueAt)
                    && value.dueAt >= value.openedAt && value.dueAt >= capturedAt))
            || !integer(value.revision, 1)) return fail('snapshot_unavailable');
        seen.add(value.loopRef);
        output.push(record({ loopRef: value.loopRef as string, kind: value.kind,
            temporalState: value.temporalState, openedAt: value.openedAt,
            dueAt: value.dueAt, revision: value.revision }) as PatientOpenLoopItemV1);
    }
    return objectFreeze(output);
}
