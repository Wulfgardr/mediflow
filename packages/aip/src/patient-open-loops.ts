/* @Codex */
import { types } from 'node:util';

export const PATIENT_OPEN_LOOPS_READ_OPERATION_V1 = 'mediflow.patient.open_loops.read.v1' as const;
export const PATIENT_OPEN_LOOPS_READ_MAX_ITEMS_V1 = 32 as const;
export const PATIENT_OPEN_LOOPS_READ_PURPOSE_V1 = 'care_coordination' as const;
export type PatientOpenLoopsReadV1ErrorCode = 'invalid_input' | 'operation_unavailable'
    | 'owner_unavailable' | 'lease_unavailable' | 'lease_replay' | 'scope_changed'
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
    outcome: 'read';
    items: readonly PatientOpenLoopItemV1[];
    truncated: boolean;
    snapshotRevision: number;
    receipt: Readonly<{
        schemaVersion: 'mediflow.patient.open_loops.read.receipt.v1'; receiptRef: string;
        operationId: typeof PATIENT_OPEN_LOOPS_READ_OPERATION_V1;
        capabilityId: typeof PATIENT_OPEN_LOOPS_READ_OPERATION_V1;
        outcome: 'read'; ownerRefHash: string; leaseRefHash: string; receiptRefHash: string;
        generation: number; revocationGeneration: number; selectionEpoch: number;
        snapshotRevision: number; itemCount: number; truncated: boolean; timestamp: number;
    }>;
}>;
const SOURCE_KEYS = ['now', 'nextRef', 'hashRef', 'acquireLease', 'readSnapshot',
    'readCurrentness', 'writeAudit', 'timeoutMs'] as const;
const INPUT_KEYS = ['schemaVersion', 'operationId'] as const;
const LEASE_KEYS = ['status', 'ownerIdentity', 'leaseIdentity', 'ownerRef', 'leaseRef', 'purposeCode',
    'operationId', 'capabilityId', 'maxStage', 'generation', 'revocationGeneration', 'selectionEpoch',
    'restartGeneration', 'expiresAt'] as const;
const SNAPSHOT_KEYS = ['status', 'ownerIdentity', 'leaseIdentity', 'snapshotIdentity', 'generation',
    'revocationGeneration', 'selectionEpoch', 'restartGeneration', 'revision', 'capturedAt', 'truncated', 'items'] as const;
const CURRENT_KEYS = ['status', 'ownerIdentity', 'leaseIdentity', 'snapshotIdentity', 'generation',
    'revocationGeneration', 'selectionEpoch', 'restartGeneration', 'revision'] as const;
const ITEM_KEYS = ['loopRef', 'kind', 'temporalState', 'openedAt', 'dueAt', 'revision'] as const;
const REF = /^[a-z][a-z0-9._-]{15,127}$/u;
const LOOP_REF = /^aipl_[0-9a-f]{64}$/u;
const RECEIPT_REF = /^aipr_[0-9a-f]{64}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const objectAssign = Object.assign, objectCreate = Object.create, objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf, objectIsFrozen = Object.isFrozen;
const reflectOwnKeys = Reflect.ownKeys, reflectApply = Reflect.apply;
const regexpTest = RegExp.prototype.test, promiseThen = Promise.prototype.then;
const numberIsSafeInteger = Number.isSafeInteger, isProxy = types.isProxy, isPromise = types.isPromise;
const NativePromise = Promise, setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout;
const AbortControllerType = AbortController, queueTask = globalThis.queueMicrotask;
function fail(code: PatientOpenLoopsReadV1ErrorCode): never { throw new PatientOpenLoopsReadV1Error(code); }
function record<T extends object>(value: T): Readonly<T> { return objectFreeze(objectAssign(objectCreate(null), value)) as Readonly<T>; }
function matches(pattern: RegExp, value: unknown): value is string { return typeof value === 'string' && reflectApply(regexpTest, pattern, [value]); }
function integer(value: unknown, minimum = 0): value is number { return numberIsSafeInteger(value) && (value as number) >= minimum; }
function discardPromise(value: unknown): boolean {
    try { if (isProxy(value) || !isPromise(value)) return false;
        reflectApply(promiseThen, value, [() => undefined, () => undefined]);
        return true; } catch { return true; }
}
function exact(value: unknown, keys: readonly string[], canonical = true): Record<string, unknown> | null {
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
function opaque(value: unknown): value is object {
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
/** Creates the DB-free, one-lease Application Service for ADR 0114's first clinical read. */
export function createPatientOpenLoopsReadServiceV1(sourcesValue: unknown) {
    const sources = exact(sourcesValue, SOURCE_KEYS, false);
    if (!sources || SOURCE_KEYS.slice(0, -1).some((key) => typeof sources[key] !== 'function' || isProxy(sources[key]))
        || !integer(sources.timeoutMs, 1) || (sources.timeoutMs as number) > 2_000) return fail('operation_unavailable');
    const nowSource = sources.now as () => unknown;
    const nextRefSource = sources.nextRef as (kind: 'receipt') => unknown;
    const hashRefSource = sources.hashRef as (value: string) => unknown;
    const acquireSource = sources.acquireLease as () => unknown;
    const readSource = sources.readSnapshot as (binding: object, request: object) => unknown;
    const currentSource = sources.readCurrentness as (binding: object, snapshot: object) => unknown;
    const auditSource = sources.writeAudit as (record: object) => unknown;
    const timeoutMs = sources.timeoutMs as number;
    let state: 'available' | 'pending' | 'terminal' = 'available';
    let terminalCode: PatientOpenLoopsReadV1ErrorCode = 'lease_replay';
    let lastNow = -1;
    let controller: AbortController | null = null;
    let rejectActive: ((error: PatientOpenLoopsReadV1Error) => void) | null = null;
    let deadlineTimer: ReturnType<typeof setTimer> | null = null;
    const now = (): number => {
        let candidate: unknown; try { candidate = nowSource(); } catch { return fail('operation_unavailable'); }
        if (state !== 'pending') { discardPromise(candidate); return fail(terminalCode); }
        if (!integer(candidate) || candidate < lastNow || discardPromise(candidate)) return fail('operation_unavailable');
        lastNow = candidate; return candidate;
    };
    const terminalize = (code: PatientOpenLoopsReadV1ErrorCode): void => {
        if (state === 'terminal') return;
        state = 'terminal'; terminalCode = code;
        if (deadlineTimer) { clearTimer(deadlineTimer); deadlineTimer = null; }
        const reject = rejectActive; rejectActive = null;
        if (reject) reject(new PatientOpenLoopsReadV1Error(code));
        const active = controller;
        if (active && !active.signal.aborted) queueTask(() => { try { active.abort(); } catch { /* terminal */ } });
    };
    const bounded = (candidate: unknown, failureCode: PatientOpenLoopsReadV1ErrorCode): Promise<Readonly<{ value: unknown }>> => {
        if (isProxy(candidate) || !isPromise(candidate)) {
            return NativePromise.reject(new PatientOpenLoopsReadV1Error(failureCode));
        }
        return new NativePromise<Readonly<{ value: unknown }>>((resolve, reject) => {
            let settled = false;
            const finish = (action: () => void): void => {
                if (settled) return;
                settled = true;
                if (rejectActive === rejectBoundary) rejectActive = null;
                action();
            };
            const rejectBoundary = (error: PatientOpenLoopsReadV1Error): void => finish(() => reject(error));
            rejectActive = rejectBoundary;
            try {
                reflectApply(promiseThen, candidate, [
                    (value: unknown) => finish(() => resolve(record({ value }))),
                    () => finish(() => reject(new PatientOpenLoopsReadV1Error(failureCode))),
                ]);
            } catch { finish(() => reject(new PatientOpenLoopsReadV1Error(failureCode))); }
        });
    };
    const sync = (source: () => unknown, code: PatientOpenLoopsReadV1ErrorCode): unknown => {
        let value: unknown;
        try { value = source(); } catch { return fail(code); }
        if (state !== 'pending') { discardPromise(value); return fail(terminalCode); }
        if (discardPromise(value)) return fail(code);
        return value;
    };
    const call = (source: () => unknown, code: PatientOpenLoopsReadV1ErrorCode): unknown => {
        let value: unknown;
        try { value = source(); } catch { return fail(code); }
        if (state !== 'pending') { discardPromise(value); return fail(terminalCode); }
        return value;
    };
    const digest = (value: string): string => {
        const candidate = sync(() => hashRefSource(value), 'audit_unavailable');
        if (!matches(DIGEST, candidate)) return fail('audit_unavailable');
        return candidate;
    };
    const parseItems = (candidate: unknown, capturedAt: number): readonly PatientOpenLoopItemV1[] => {
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
                || !integer(value.revision, 1)) {
                return fail('snapshot_unavailable');
            }
            seen.add(value.loopRef);
            output.push(record({ loopRef: value.loopRef as string, kind: value.kind,
                temporalState: value.temporalState, openedAt: value.openedAt,
                dueAt: value.dueAt, revision: value.revision }) as PatientOpenLoopItemV1);
        }
        return objectFreeze(output);
    };
    const read = async (inputValue: unknown): Promise<PatientOpenLoopsReadResultV1> => {
        const input = exact(inputValue, INPUT_KEYS, false);
        if (!input || input.schemaVersion !== 'mediflow.patient.open_loops.read.input.v1'
            || input.operationId !== PATIENT_OPEN_LOOPS_READ_OPERATION_V1) return fail('invalid_input');
        if (state !== 'available') return fail(state === 'terminal' ? terminalCode : 'lease_replay');
        state = 'pending'; controller = new AbortControllerType();
        try {
            const startedAt = now();
            const leaseValue = sync(acquireSource, 'lease_unavailable');
            const lease = exact(leaseValue, LEASE_KEYS);
            if (!lease || lease.status !== 'available' || !opaque(lease.ownerIdentity) || !opaque(lease.leaseIdentity)
                || !matches(REF, lease.ownerRef) || !matches(REF, lease.leaseRef)
                || lease.purposeCode !== PATIENT_OPEN_LOOPS_READ_PURPOSE_V1
                || lease.operationId !== PATIENT_OPEN_LOOPS_READ_OPERATION_V1
                || lease.capabilityId !== PATIENT_OPEN_LOOPS_READ_OPERATION_V1 || lease.maxStage !== 'read_only'
                || !integer(lease.generation, 1) || !integer(lease.revocationGeneration)
                || !integer(lease.selectionEpoch) || !integer(lease.restartGeneration, 1)
                || !integer(lease.expiresAt, startedAt + 1)) return fail('lease_unavailable');
            const timeoutAt = startedAt + timeoutMs;
            if (!integer(timeoutAt, startedAt + 1)) return fail('operation_unavailable');
            const deadline = Math.min(timeoutAt, lease.expiresAt as number);
            const deadlineCode: PatientOpenLoopsReadV1ErrorCode = deadline === lease.expiresAt ? 'expired' : 'timeout';
            deadlineTimer = setTimer(() => { terminalize(deadlineCode); }, deadline - startedAt);
            const binding = record({ ownerIdentity: lease.ownerIdentity, leaseIdentity: lease.leaseIdentity,
                generation: lease.generation, revocationGeneration: lease.revocationGeneration,
                selectionEpoch: lease.selectionEpoch, restartGeneration: lease.restartGeneration });
            const request = record({ limit: PATIENT_OPEN_LOOPS_READ_MAX_ITEMS_V1, signal: controller.signal });
            const rawSnapshot = (await bounded(call(() => readSource(binding, request), 'snapshot_unavailable'),
                'snapshot_unavailable')).value;
            if (state !== 'pending') return fail(terminalCode);
            const observedAt = now();
            if (observedAt >= deadline) { terminalize(deadlineCode); return fail(deadlineCode); }
            const snapshot = exact(rawSnapshot, SNAPSHOT_KEYS);
            if (!snapshot || snapshot.status !== 'available' || snapshot.ownerIdentity !== lease.ownerIdentity
                || snapshot.leaseIdentity !== lease.leaseIdentity || !opaque(snapshot.snapshotIdentity)
                || snapshot.generation !== lease.generation || snapshot.revocationGeneration !== lease.revocationGeneration
                || snapshot.selectionEpoch !== lease.selectionEpoch || snapshot.restartGeneration !== lease.restartGeneration
                || !integer(snapshot.revision, 1) || !integer(snapshot.capturedAt, startedAt)
                || snapshot.capturedAt > observedAt || typeof snapshot.truncated !== 'boolean') return fail('snapshot_unavailable');
            const items = parseItems(snapshot.items, snapshot.capturedAt as number);
            const receiptRef = sync(() => nextRefSource('receipt'), 'operation_unavailable');
            if (!matches(RECEIPT_REF, receiptRef)) return fail('operation_unavailable');
            const receipt = record({ schemaVersion: 'mediflow.patient.open_loops.read.receipt.v1' as const,
                receiptRef, operationId: PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
                capabilityId: PATIENT_OPEN_LOOPS_READ_OPERATION_V1, outcome: 'read' as const,
                ownerRefHash: digest(lease.ownerRef as string), leaseRefHash: digest(lease.leaseRef as string),
                receiptRefHash: digest(receiptRef), generation: lease.generation as number,
                revocationGeneration: lease.revocationGeneration as number, selectionEpoch: lease.selectionEpoch as number,
                snapshotRevision: snapshot.revision as number, itemCount: items.length,
                truncated: snapshot.truncated as boolean, timestamp: observedAt });
            const audit = record({ schemaVersion: 'mediflow.aip.patient_open_loops.read.audit.v1',
                eventType: 'read_materialized', outcome: 'allowed', operationId: PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
                capabilityId: PATIENT_OPEN_LOOPS_READ_OPERATION_V1, purposeCode: lease.purposeCode,
                ownerRefHash: receipt.ownerRefHash, leaseRefHash: receipt.leaseRefHash,
                receiptRefHash: receipt.receiptRefHash, generation: receipt.generation,
                revocationGeneration: receipt.revocationGeneration, selectionEpoch: receipt.selectionEpoch,
                snapshotRevision: receipt.snapshotRevision, itemCount: receipt.itemCount,
                truncated: receipt.truncated, timestamp: receipt.timestamp });
            await bounded(call(() => auditSource(audit), 'audit_unavailable'), 'audit_unavailable');
            if (state !== 'pending') return fail(terminalCode);
            const currentValue = sync(() => currentSource(binding, snapshot.snapshotIdentity as object), 'scope_changed');
            const current = exact(currentValue, CURRENT_KEYS);
            if (!current || current.status !== 'current' || current.ownerIdentity !== lease.ownerIdentity
                || current.leaseIdentity !== lease.leaseIdentity || current.snapshotIdentity !== snapshot.snapshotIdentity
                || current.generation !== lease.generation || current.revocationGeneration !== lease.revocationGeneration
                || current.selectionEpoch !== lease.selectionEpoch || current.restartGeneration !== lease.restartGeneration
                || current.revision !== snapshot.revision) return fail('scope_changed');
            if (now() >= deadline) { terminalize(deadlineCode); return fail(deadlineCode); }
            state = 'terminal'; terminalCode = 'lease_replay';
            return record({ schemaVersion: 'mediflow.patient.open_loops.read.result.v1' as const,
                operationId: PATIENT_OPEN_LOOPS_READ_OPERATION_V1, capabilityId: PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
                outcome: 'read' as const, items, truncated: snapshot.truncated as boolean,
                snapshotRevision: snapshot.revision as number, receipt });
        } catch (error) {
            if (state !== 'terminal') terminalize(error instanceof PatientOpenLoopsReadV1Error ? error.code : 'operation_unavailable');
            if (error instanceof PatientOpenLoopsReadV1Error) throw error;
            return fail(terminalCode);
        } finally {
            if (deadlineTimer) { clearTimer(deadlineTimer); deadlineTimer = null; }
            controller = null; rejectActive = null;
        }
    };
    const stop = (code: PatientOpenLoopsReadV1ErrorCode): boolean => {
        if (state === 'terminal') return false;
        terminalize(code); return true;
    };
    return record({ read, cancel: () => stop('cancelled'), revoke: () => stop('revoked'),
        restart: () => stop('restart_changed'), dispose: () => stop('disposed') });
}
