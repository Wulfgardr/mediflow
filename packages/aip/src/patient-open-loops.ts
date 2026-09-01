/* @Codex */
import { types } from 'node:util';
import {
    CURRENT_KEYS, DIGEST, INPUT_KEYS, LEASE_KEYS, PATIENT_OPEN_LOOPS_READ_MAX_ITEMS_V1,
    PATIENT_OPEN_LOOPS_READ_OPERATION_V1, PATIENT_OPEN_LOOPS_READ_PURPOSE_V1, RECEIPT_REF, REF,
    SNAPSHOT_KEYS, PatientOpenLoopsReadV1Error, exact, fail, integer, matches, opaque, parseItems, record,
    type PatientOpenLoopsReadResultV1, type PatientOpenLoopsReadV1ErrorCode,
} from './patient-open-loops-contract.ts';

export {
    PATIENT_OPEN_LOOPS_READ_MAX_ITEMS_V1, PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
    PATIENT_OPEN_LOOPS_READ_PURPOSE_V1, PATIENT_OPEN_LOOPS_READ_TIMEOUT_MODE_V1,
    PatientOpenLoopsReadV1Error,
} from './patient-open-loops-contract.ts';
export type {
    PatientOpenLoopItemV1, PatientOpenLoopsReadResultV1, PatientOpenLoopsReadV1ErrorCode,
} from './patient-open-loops-contract.ts';
const SOURCE_KEYS = ['now', 'nextRef', 'hashRef', 'current', 'beginPermit', 'bindPermit', 'finalizeBoundPermit',
    'denyPermit', 'acquireLease', 'readSnapshot', 'readCurrentness', 'writeAudit', 'timeoutMs'] as const;
const reflectApply = Reflect.apply;
const promiseThen = Promise.prototype.then, isProxy = types.isProxy, isPromise = types.isPromise;
const NativePromise = Promise, setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout;
const AbortControllerType = AbortController, queueTask = globalThis.queueMicrotask;
function discardPromise(value: unknown): boolean {
    try { if (isProxy(value) || !isPromise(value)) return false;
        reflectApply(promiseThen, value, [() => undefined, () => undefined]);
        return true; } catch { return true; }
}
/** ADR 0114 core: only pending native Promises are preempted; sync ports cooperate and post-call clock fences deny output. */
export function createPatientOpenLoopsReadServiceV1(sourcesValue: unknown) {
    const sources = exact(sourcesValue, SOURCE_KEYS, false);
    if (!sources || SOURCE_KEYS.slice(0, -1).some((key) => typeof sources[key] !== 'function' || isProxy(sources[key]))
        || !integer(sources.timeoutMs, 1) || (sources.timeoutMs as number) > 2_000) return fail('operation_unavailable');
    const nowSource = sources.now as () => unknown, nextRefSource = sources.nextRef as (kind: 'receipt') => unknown;
    const hashRefSource = sources.hashRef as (value: string) => unknown, ownerCurrentSource = sources.current as () => unknown;
    const beginSource = sources.beginPermit as (permit: unknown, current: unknown, claim: object) => unknown;
    const bindSource = sources.bindPermit as (execution: unknown, binding: object,
        current: unknown, claim: object) => unknown;
    const finalizeSource = sources.finalizeBoundPermit as (execution: unknown, binding: object,
        current: unknown, claim: object) => unknown;
    const denySource = sources.denyPermit as (execution: unknown) => unknown;
    const acquireSource = sources.acquireLease as (execution: object) => unknown;
    const readSource = sources.readSnapshot as (binding: object, request: object) => unknown;
    const currentSource = sources.readCurrentness as (binding: object, snapshot: object) => unknown, auditSource = sources.writeAudit as (record: object) => unknown;
    const timeoutMs = sources.timeoutMs as number;
    let state: 'available' | 'pending' | 'terminal' = 'available', lastNow = -1;
    let terminalCode: PatientOpenLoopsReadV1ErrorCode = 'lease_replay', controller: AbortController | null = null;
    let rejectActive: ((error: PatientOpenLoopsReadV1Error) => void) | null = null, deadlineTimer: ReturnType<typeof setTimer> | null = null;
    let activeDeadline: number | null = null;
    let activeDeadlineCode: PatientOpenLoopsReadV1ErrorCode = 'timeout';
    const now = (): number => {
        let candidate: unknown; try { candidate = nowSource(); } catch {
            if (state === 'terminal') return fail(terminalCode);
            return fail('operation_unavailable');
        }
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
    const fence = (): void => {
        if (state !== 'pending') return fail(terminalCode);
        if (activeDeadline !== null && now() >= activeDeadline) {
            terminalize(activeDeadlineCode); return fail(activeDeadlineCode);
        }
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
    const writeDenialAudit = async (code: PatientOpenLoopsReadV1ErrorCode): Promise<void> => {
        const denial = record({ schemaVersion: 'mediflow.aip.audit.v1' as const,
            eventType: 'patient_open_loops_read' as const, outcome: 'denied' as const,
            operation: PATIENT_OPEN_LOOPS_READ_OPERATION_V1, capabilityId: PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
            purposeCode: PATIENT_OPEN_LOOPS_READ_PURPOSE_V1, maxStage: 'read_only' as const,
            ownerRefHash: null, leaseRefHash: null, receiptRefHash: null, itemCount: 0 as const,
            truncated: false as const, egress: 'none' as const, writesPerformed: 0 as const,
            timestamp: lastNow < 0 ? 0 : lastNow, denialCode: code });
        let candidate: unknown;
        try { candidate = auditSource(denial); } catch {
            if (state === 'terminal') return fail(terminalCode);
            return fail('audit_unavailable');
        }
        if (candidate === undefined) return;
        if (isProxy(candidate) || !isPromise(candidate)) return fail('audit_unavailable');
        await new NativePromise<void>((resolve, reject) => {
            let settled = false;
            const timer = setTimer(() => finish(() => reject(new PatientOpenLoopsReadV1Error('audit_unavailable'))), timeoutMs);
            const finish = (action: () => void): void => {
                if (settled) return; settled = true; clearTimer(timer); action();
            };
            try { reflectApply(promiseThen, candidate, [() => finish(resolve),
                () => finish(() => reject(new PatientOpenLoopsReadV1Error('audit_unavailable')))]); }
            catch { finish(() => reject(new PatientOpenLoopsReadV1Error('audit_unavailable'))); }
        });
    };
    const sync = (source: () => unknown, code: PatientOpenLoopsReadV1ErrorCode): unknown => {
        fence();
        let value: unknown;
        try { value = source(); } catch { fence(); return fail(code); }
        try { fence(); } catch (error) { discardPromise(value); throw error; }
        if (discardPromise(value)) return fail(code);
        return value;
    };
    const call = (source: () => unknown, code: PatientOpenLoopsReadV1ErrorCode): unknown => {
        fence();
        let value: unknown;
        try { value = source(); } catch { fence(); return fail(code); }
        try { fence(); } catch (error) { discardPromise(value); throw error; }
        return value;
    };
    const digest = (value: string): string => {
        const candidate = sync(() => hashRefSource(value), 'audit_unavailable');
        if (!matches(DIGEST, candidate)) return fail('audit_unavailable');
        return candidate;
    };
    const claim = record({ operation: PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
        capabilityId: PATIENT_OPEN_LOOPS_READ_OPERATION_V1 });
    const read = async (permitValue: unknown, inputValue: unknown): Promise<PatientOpenLoopsReadResultV1> => {
        const input = exact(inputValue, INPUT_KEYS, false);
        if (!input || input.schemaVersion !== 'mediflow.patient.open_loops.read.input.v1'
            || input.operationId !== PATIENT_OPEN_LOOPS_READ_OPERATION_V1) return fail('invalid_input');
        if (!opaque(permitValue)) return fail('authorization_denied');
        if (state !== 'available') {
            const code = state === 'terminal' ? terminalCode : 'lease_replay';
            await writeDenialAudit(code); return fail(code);
        }
        state = 'pending'; controller = new AbortControllerType();
        let execution: unknown;
        let began = false;
        try {
            const startedAt = now();
            const timeoutAt = startedAt + timeoutMs;
            if (!integer(timeoutAt, startedAt + 1)) return fail('operation_unavailable');
            activeDeadline = timeoutAt;
            const ownerCurrent = sync(ownerCurrentSource, 'authorization_denied');
            execution = sync(() => beginSource(permitValue, ownerCurrent, claim), 'authorization_denied');
            began = true;
            if (!opaque(execution)) return fail('authorization_denied');
            const leaseValue = sync(() => acquireSource(execution as object), 'lease_unavailable');
            const lease = exact(leaseValue, LEASE_KEYS);
            if (!lease || lease.status !== 'available' || !opaque(lease.ownerIdentity) || !opaque(lease.leaseIdentity)
                || !matches(REF, lease.ownerRef) || !matches(REF, lease.leaseRef)
                || lease.purposeCode !== PATIENT_OPEN_LOOPS_READ_PURPOSE_V1
                || lease.operationId !== PATIENT_OPEN_LOOPS_READ_OPERATION_V1
                || lease.capabilityId !== PATIENT_OPEN_LOOPS_READ_OPERATION_V1 || lease.maxStage !== 'read_only'
                || !matches(DIGEST, lease.scopeDigest)
                || !integer(lease.generation, 1) || !integer(lease.revocationGeneration)
                || !integer(lease.selectionEpoch) || !integer(lease.restartGeneration, 1)
                || !integer(lease.expiresAt, startedAt + 1)) return fail('lease_unavailable');
            const deadline = Math.min(timeoutAt, lease.expiresAt as number);
            const deadlineCode: PatientOpenLoopsReadV1ErrorCode = deadline === lease.expiresAt ? 'expired' : 'timeout';
            activeDeadline = deadline; activeDeadlineCode = deadlineCode;
            const leaseBinding = record({ scopeDigest: lease.scopeDigest, generation: lease.generation,
                revocationGeneration: lease.revocationGeneration, selectionEpoch: lease.selectionEpoch });
            const bindingCurrent = sync(ownerCurrentSource, 'authorization_denied');
            const binding = sync(() => bindSource(execution, leaseBinding, bindingCurrent, claim),
                'authorization_denied');
            if (!opaque(binding)) return fail('authorization_denied');
            const reservedAt = now();
            if (reservedAt >= deadline) { terminalize(deadlineCode); return fail(deadlineCode); }
            deadlineTimer = setTimer(() => { terminalize(deadlineCode); }, deadline - reservedAt);
            const request = record({ limit: PATIENT_OPEN_LOOPS_READ_MAX_ITEMS_V1, signal: controller.signal });
            const rawSnapshot = (await bounded(call(() => readSource(binding, request), 'snapshot_unavailable'),
                'snapshot_unavailable')).value;
            if (state !== 'pending') return fail(terminalCode);
            const observedAt = now();
            if (observedAt >= deadline) { terminalize(deadlineCode); return fail(deadlineCode); }
            const snapshot = exact(rawSnapshot, SNAPSHOT_KEYS);
            if (!snapshot || snapshot.status !== 'available' || snapshot.ownerIdentity !== lease.ownerIdentity
                || snapshot.leaseIdentity !== lease.leaseIdentity || !opaque(snapshot.snapshotIdentity)
                || snapshot.scopeDigest !== lease.scopeDigest
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
            const audit = record({ schemaVersion: 'mediflow.aip.audit.v1',
                eventType: 'patient_open_loops_read', outcome: 'allowed', operation: PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
                capabilityId: PATIENT_OPEN_LOOPS_READ_OPERATION_V1, purposeCode: lease.purposeCode, maxStage: 'read_only',
                ownerRefHash: receipt.ownerRefHash, leaseRefHash: receipt.leaseRefHash,
                receiptRefHash: receipt.receiptRefHash, generation: receipt.generation,
                revocationGeneration: receipt.revocationGeneration, selectionEpoch: receipt.selectionEpoch,
                snapshotRevision: receipt.snapshotRevision, itemCount: receipt.itemCount,
                truncated: receipt.truncated, egress: 'none', writesPerformed: 0,
                timestamp: receipt.timestamp, denialCode: null });
            await bounded(call(() => auditSource(audit), 'audit_unavailable'), 'audit_unavailable');
            if (state !== 'pending') return fail(terminalCode);
            if (now() >= deadline) { terminalize(deadlineCode); return fail(deadlineCode); }
            const currentValue = sync(() => currentSource(binding, snapshot.snapshotIdentity as object), 'scope_changed');
            const current = exact(currentValue, CURRENT_KEYS);
            if (!current || current.status !== 'current' || current.ownerIdentity !== lease.ownerIdentity
                || current.leaseIdentity !== lease.leaseIdentity || current.snapshotIdentity !== snapshot.snapshotIdentity
                || current.scopeDigest !== lease.scopeDigest
                || current.generation !== lease.generation || current.revocationGeneration !== lease.revocationGeneration
                || current.selectionEpoch !== lease.selectionEpoch || current.restartGeneration !== lease.restartGeneration
                || current.revision !== snapshot.revision) return fail('scope_changed');
            const finalCurrent = sync(ownerCurrentSource, 'authorization_denied');
            const finalBinding = record({ scopeDigest: current.scopeDigest, generation: current.generation,
                revocationGeneration: current.revocationGeneration, selectionEpoch: current.selectionEpoch });
            const finalized = sync(() => finalizeSource(binding, finalBinding, finalCurrent, claim),
                'authorization_denied');
            if (finalized !== true) return fail('authorization_denied');
            if (now() >= deadline) { terminalize(deadlineCode); return fail(deadlineCode); }
            state = 'terminal'; terminalCode = 'lease_replay';
            return record({ schemaVersion: 'mediflow.patient.open_loops.read.result.v1' as const,
                operationId: PATIENT_OPEN_LOOPS_READ_OPERATION_V1, capabilityId: PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
                outcome: 'read' as const, items, truncated: snapshot.truncated as boolean,
                snapshotRevision: snapshot.revision as number, receipt });
        } catch (error) {
            if (began) { try { denySource(execution); } catch { /* broker reservation remains terminal */ } }
            const publicError = error instanceof PatientOpenLoopsReadV1Error
                ? error : new PatientOpenLoopsReadV1Error('operation_unavailable');
            try { await writeDenialAudit(publicError.code); } catch (auditError) {
                if (state === 'terminal') throw publicError;
                throw auditError;
            }
            if (state !== 'terminal') terminalize(publicError.code);
            throw publicError;
        } finally {
            if (deadlineTimer) { clearTimer(deadlineTimer); deadlineTimer = null; }
            controller = null; rejectActive = null; activeDeadline = null; activeDeadlineCode = 'timeout';
        }
    };
    const stop = (code: PatientOpenLoopsReadV1ErrorCode): boolean => {
        if (state === 'terminal') return false;
        terminalize(code); return true;
    };
    return record({ read, cancel: () => stop('cancelled'), revoke: () => stop('revoked'),
        restart: () => stop('restart_changed'), dispose: () => stop('disposed') });
}
