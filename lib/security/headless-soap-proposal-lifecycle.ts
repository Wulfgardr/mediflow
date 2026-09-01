/* @Codex */
import 'server-only';
import { types } from 'node:util';
import {
    validateClinicianSoapWriteDraft, type ClinicianSoapWriteAccepted,
} from '../headless/clinician-soap-write-contract';
import type { HeadlessSoapAuthorizationLineageV1 } from './headless-soap-authorization-lineage';

export const HEADLESS_SOAP_PROPOSAL_TTL_MS = 120_000;
declare const inspectRefIdentity: unique symbol;
declare const previewRefIdentity: unique symbol;
declare const proposalRefIdentity: unique symbol;
declare const proposalDependentRegistrationIdentity: unique symbol;
export type HeadlessSoapInspectRefV1 = Readonly<{ readonly [inspectRefIdentity]?: never }>;
export type HeadlessSoapPreviewRefV1 = Readonly<{ readonly [previewRefIdentity]?: never }>;
export type HeadlessSoapProposalRefV1 = Readonly<{ readonly [proposalRefIdentity]?: never }>;
export type HeadlessSoapProposalDependentRegistrationV1 = Readonly<{ readonly [proposalDependentRegistrationIdentity]?: never }>;
export type HeadlessSoapProposalStageRefV1 = HeadlessSoapInspectRefV1 | HeadlessSoapPreviewRefV1 | HeadlessSoapProposalRefV1;
export type HeadlessSoapProposalLifecycleErrorCode = 'snapshot_unavailable' | 'lease_unavailable' | 'selection_unavailable'
    | 'stage_unavailable' | 'proposal_expired' | 'proposal_budget_exhausted' | 'lifecycle_unavailable';
export class HeadlessSoapProposalLifecycleError extends Error {
    constructor(readonly code: HeadlessSoapProposalLifecycleErrorCode) {
        super(`Headless SOAP proposal lifecycle rejected: ${code}`); this.name = 'HeadlessSoapProposalLifecycleError';
    }
}
export type HeadlessSoapLeaseLifecyclePortV1 = Readonly<{
    withCurrentLease(candidate: unknown, operation: (lease: unknown) => void): Promise<boolean>;
    registerDependent(candidate: unknown, dispose: () => void): unknown | null;
    confirmDependent(candidate: unknown, registration: unknown): boolean;
    unregisterDependent(candidate: unknown, registration: unknown): boolean;
    withCurrentDependent(candidate: unknown, registration: unknown, operation: () => void): Promise<boolean>;
    withCurrentProposalBudget(candidate: unknown, registration: unknown, operation: () => void): Promise<boolean>;
}>;
export type HeadlessSoapSelectionLifecyclePortV1 = Readonly<{
    withCurrentSelection(session: unknown, operation: (scope: unknown) => void): boolean;
    registerDependent(scope: unknown, dispose: () => void): unknown | null;
    confirmDependent(scope: unknown, registration: unknown): boolean;
    unregisterDependent(scope: unknown, registration: unknown): boolean;
    withCurrentDependent(scope: unknown, registration: unknown, operation: () => void): boolean;
}>;
export type HeadlessSoapProposalBindingV1 = Readonly<{
    activeRole: HeadlessSoapAuthorizationLineageV1['activeRole'];
    childLease: HeadlessSoapAuthorizationLineageV1['childLease'];
    selection: HeadlessSoapAuthorizationLineageV1['selection'];
    patientVersion: HeadlessSoapAuthorizationLineageV1['patientVersion'];
    proposal: HeadlessSoapAuthorizationLineageV1['proposal'];
}>;
export type HeadlessSoapProposalBindingControllerV1 = Readonly<{
    withCurrentDependentBinding(candidate: unknown, registration: unknown,
        operation: (binding: HeadlessSoapProposalBindingV1) => void): Promise<boolean>;
}>;
export type HeadlessSoapProposalLifecycleSources = Readonly<{
    leaseLifecycle: HeadlessSoapLeaseLifecyclePortV1;
    leaseBinding?: Readonly<{
        withCurrentDependentBinding(candidate: unknown, registration: unknown,
            operation: (childLease: HeadlessSoapProposalBindingV1['childLease'],
                activeRole: HeadlessSoapProposalBindingV1['activeRole']) => void): Promise<boolean>;
    }>;
    leaseService: Readonly<{ terminate(candidate: unknown): boolean }>;
    selectionLifecycle: HeadlessSoapSelectionLifecyclePortV1;
    selectionBinding?: Readonly<{
        withCurrentDependentBinding(candidate: unknown, registration: unknown,
            operation: (binding: Readonly<{
                selection: HeadlessSoapProposalBindingV1['selection'];
                patientVersion: HeadlessSoapProposalBindingV1['patientVersion'];
            }>) => void): boolean;
    }>;
    readCurrentSelectionSession(): Promise<unknown | null>;
    clock(): number;
    scheduler(delayMs: number, operation: () => void): () => void;
}>;
export type HeadlessSoapProposalLifecycleServiceV1 = Readonly<{
    inspect(lease: unknown, h1Snapshot: unknown): Promise<HeadlessSoapInspectRefV1>;
    preview(inspectRef: unknown): Promise<HeadlessSoapPreviewRefV1>;
    proposal(previewRef: unknown): Promise<HeadlessSoapProposalRefV1>;
    wipe(stageRef: unknown): boolean;
}>;
export type HeadlessSoapProposalLifecycleControllerV1 = Readonly<{
    withCurrentProposal(candidate: unknown, operation: (snapshot: ClinicianSoapWriteAccepted) => void): Promise<boolean>;
    registerDependent(candidate: unknown, dispose: () => void): HeadlessSoapProposalDependentRegistrationV1 | null;
    confirmDependent(candidate: unknown, registration: unknown): boolean;
    unregisterDependent(candidate: unknown, registration: unknown): boolean;
    withCurrentDependent(candidate: unknown, registration: unknown, operation: (snapshot: ClinicianSoapWriteAccepted) => void): Promise<boolean>;
}>;

type Stage = 'inspect' | 'preview' | 'proposal';
type LifecycleRecord = {
    active: boolean; lease: object; leaseRegistration: unknown; scope: unknown; selectionRegistration: unknown;
    snapshot: ClinicianSoapWriteAccepted | null; stage: Stage; stageRef: object; refs: object[]; expiresAt: number; lastObservedAt: number;
    proposalRevision: 1 | null; cancel: (() => void) | null; dependents: ProposalDependentRecord | null;
};
type ProposalDependentRecord = {
    registration: HeadlessSoapProposalDependentRegistrationV1; lifecycle: LifecycleRecord; dispose: () => void;
    active: boolean; next: ProposalDependentRecord | null; drainNext: ProposalDependentRecord | null;
};
type LifecycleOperation = {
    lifecycle: LifecycleRecord; dependent: ProposalDependentRecord | null; created: ProposalDependentRecord[]; poisoned: boolean;
};
const objectCreate = Object.create, objectFreeze = Object.freeze, objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors, objectIsFrozen = Object.isFrozen, arrayIsArray = Array.isArray;
const arrayPrototype = Array.prototype;
const ownKeys = Reflect.ownKeys, reflectApply = Reflect.apply, numberIsSafeInteger = Number.isSafeInteger, maxSafeInteger = Number.MAX_SAFE_INTEGER;
const numberToString = Number.prototype.toString;
const functionPrototype = Function.prototype, promiseThen = Promise.prototype.then;
const isAsyncFunction = types.isAsyncFunction, isGeneratorFunction = types.isGeneratorFunction, isPromise = types.isPromise, isProxy = types.isProxy;
const weakMapGet = WeakMap.prototype.get, weakMapSet = WeakMap.prototype.set, weakMapDelete = WeakMap.prototype.delete;
const weakSetAdd = WeakSet.prototype.add, weakSetHas = WeakSet.prototype.has, weakSetDelete = WeakSet.prototype.delete;
const expectedSnapshotKeys = ['status', 'schema', 'operationId', 'subjective', 'objective', 'assessment', 'plan', 'digest'] as const;
const expectedDigestKeys = ['codec', 'sha256'] as const, expectedShaKeys = ['bytes', 'hex'] as const;
function weakGet<T>(registry: WeakMap<object, T>, key: object): T | undefined { return Reflect.apply(weakMapGet, registry, [key]) as T | undefined; }
function weakSet<T>(registry: WeakMap<object, T>, key: object, value: T): void { Reflect.apply(weakMapSet, registry, [key, value]); }
function weakDelete<T>(registry: WeakMap<object, T>, key: object): void { Reflect.apply(weakMapDelete, registry, [key]); }
function fail(code: HeadlessSoapProposalLifecycleErrorCode): never { throw new HeadlessSoapProposalLifecycleError(code); }
function opaque(): Readonly<Record<never, never>> { return objectFreeze(objectCreate(null)) as Readonly<Record<never, never>>; }
function synchronousCallback(value: unknown): value is (...args: never[]) => void {
    return typeof value === 'function' && !isProxy(value) && !isAsyncFunction(value) && !isGeneratorFunction(value)
        && objectGetPrototypeOf(value) === functionPrototype;
}
function callbackSucceeded(operation: (...args: never[]) => void, args: unknown[]): boolean {
    try { const result = reflectApply(operation, undefined, args); if (result === undefined) return true;
        if (isPromise(result)) try { reflectApply(promiseThen, result, [undefined, () => undefined]); } catch { /* denial stays local */ }
    } catch { /* fixed false below */ } return false;
}
function exactData(value: unknown, keys: readonly PropertyKey[]): Record<PropertyKey, unknown> | null {
    if (typeof value !== 'object' || value === null || isProxy(value) || objectGetPrototypeOf(value) !== null || !objectIsFrozen(value)) return null;
    const actual = ownKeys(value); if (actual.length !== keys.length) return null;
    const descriptors = objectGetOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>, output = objectCreate(null) as Record<PropertyKey, unknown>;
    for (let index = 0; index < keys.length; index += 1) { const key = keys[index]!; if (actual[index] !== key) return null;
        const descriptor = descriptors[key]; if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return null; output[key] = descriptor.value; }
    return output;
}
function acceptedSnapshot(value: unknown): ClinicianSoapWriteAccepted | null {
    try {
        const candidate = exactData(value, expectedSnapshotKeys); if (!candidate || candidate.status !== 'accepted') return null;
        const digest = exactData(candidate.digest, expectedDigestKeys); if (!digest) return null;
        const sha256 = exactData(digest.sha256, expectedShaKeys); if (!sha256 || typeof sha256.hex !== 'string') return null;
        const bytes = sha256.bytes; if (!arrayIsArray(bytes) || isProxy(bytes) || objectGetPrototypeOf(bytes) !== arrayPrototype || !objectIsFrozen(bytes) || bytes.length !== 32) return null;
        const draft = objectCreate(null) as Record<string, string>;
        for (let index = 1; index < 7; index += 1) { const key = expectedSnapshotKeys[index]!; if (typeof candidate[key] !== 'string') return null; draft[key] = candidate[key] as string; }
        const checked = validateClinicianSoapWriteDraft(draft); if (checked.status !== 'accepted') return null;
        for (let index = 1; index < 7; index += 1) { const key = expectedSnapshotKeys[index]!; if (candidate[key] !== checked[key]) return null; }
        if (checked.digest.codec !== digest.codec || checked.digest.sha256.hex !== sha256.hex) return null;
        const byteKeys = ownKeys(bytes); if (byteKeys.length !== checked.digest.sha256.bytes.length + 1
            || byteKeys[byteKeys.length - 1] !== 'length') return null;
        const byteDescriptors = objectGetOwnPropertyDescriptors(bytes);
        for (let index = 0; index < checked.digest.sha256.bytes.length; index += 1) { const descriptor = byteDescriptors[index];
            if (byteKeys[index] !== Reflect.apply(numberToString, index, []) || !descriptor || !('value' in descriptor)
                || !descriptor.enumerable || descriptor.value !== checked.digest.sha256.bytes[index]) return null; }
        return checked;
    } catch { return null; }
}

/** Owns one memory-only SOAP proposal lifecycle. It does not authorize or perform a clinical write. */
export function createHeadlessSoapProposalLifecycleOwner(sources: HeadlessSoapProposalLifecycleSources): Readonly<{
    service: HeadlessSoapProposalLifecycleServiceV1;
    lifecycleController: HeadlessSoapProposalLifecycleControllerV1;
    bindingController: HeadlessSoapProposalBindingControllerV1;
}> {
    const stages = new WeakMap<object, LifecycleRecord>(), leases = new WeakMap<object, LifecycleRecord>(), pending = new WeakSet<object>();
    const dependentRegistrations = new WeakMap<object, ProposalDependentRecord>(); let lifecycleOperation: LifecycleOperation | null = null;
    let lifecycleDrainActive = false;
    const proposalRecord = (candidate: unknown): LifecycleRecord | null => {
        if (typeof candidate !== 'object' || candidate === null || isProxy(candidate)) return null;
        const record = weakGet(stages, candidate); return record?.active && record.stage === 'proposal'
            && record.stageRef === candidate && record.snapshot !== null && record.proposalRevision === 1 ? record : null;
    };
    const dependentRecord = (record: LifecycleRecord, registration: unknown): ProposalDependentRecord | null => {
        if (typeof registration !== 'object' || registration === null || isProxy(registration)) return null;
        const dependent = weakGet(dependentRegistrations, registration); return dependent?.active && dependent.registration === registration
            && dependent.lifecycle === record ? dependent : null;
    };
    const unlinkDependent = (dependent: ProposalDependentRecord): void => { const record = dependent.lifecycle;
        if (record.dependents === dependent) record.dependents = dependent.next;
        else { let previous = record.dependents; while (previous && previous.next !== dependent) previous = previous.next;
            if (previous) previous.next = dependent.next; } dependent.next = null;
    };
    const snapshotDependents = (record: LifecycleRecord): ProposalDependentRecord | null => { let dependent = record.dependents;
        let drain: ProposalDependentRecord | null = null; record.dependents = null;
        while (dependent) { const next = dependent.next; dependent.next = null; dependent.drainNext = drain; drain = dependent;
            dependent.active = false; weakDelete(dependentRegistrations, dependent.registration); dependent = next; } return drain;
    };
    const invokeDependentDrain = (dependent: ProposalDependentRecord | null): void => { let pending = dependent; const previousDrain = lifecycleDrainActive;
        lifecycleDrainActive = true; while (pending) { const next = pending.drainNext; pending.drainNext = null;
            try { const result = reflectApply(pending.dispose, undefined, []); if (isPromise(result)) {
                try { reflectApply(promiseThen, result, [undefined, () => undefined]); } catch { /* rejection remains observed */ }
            } } catch { /* one disposer cannot retain siblings */ } pending = next; } lifecycleDrainActive = previousDrain;
    };
    const terminalize = (record: LifecycleRecord): boolean => {
        if (!record.active) return false; record.active = false; const dependents = snapshotDependents(record);
        const cancel = record.cancel; record.cancel = null; try { cancel?.(); } catch { /* logical retirement already won */ }
        for (let index = 0; index < record.refs.length; index += 1) weakDelete(stages, record.refs[index]!); weakDelete(leases, record.lease);
        record.snapshot = null; record.proposalRevision = null;
        try { sources.leaseLifecycle.unregisterDependent(record.lease, record.leaseRegistration); } catch { /* local state is terminal */ }
        try { sources.selectionLifecycle.unregisterDependent(record.scope, record.selectionRegistration); } catch { /* local state is terminal */ }
        try { sources.leaseService.terminate(record.lease); } catch { /* local state is terminal */ } invokeDependentDrain(dependents); return true;
    };
    const lifecycleReentry = (): boolean => { if (lifecycleDrainActive) { if (lifecycleOperation) lifecycleOperation.poisoned = true; return true; }
        if (!lifecycleOperation) return false; lifecycleOperation.poisoned = true; return true; };
    const observe = (record: LifecycleRecord): HeadlessSoapProposalLifecycleErrorCode | null => {
        if (!record.active) return 'lifecycle_unavailable';
        let observedAt: unknown; try { observedAt = sources.clock(); } catch { terminalize(record); return 'lifecycle_unavailable'; }
        if (!record.active) return 'lifecycle_unavailable';
        if (!numberIsSafeInteger(observedAt) || (observedAt as number) < 0 || (observedAt as number) < record.lastObservedAt) { terminalize(record); return 'lifecycle_unavailable'; }
        if ((observedAt as number) >= record.expiresAt) { terminalize(record); return 'proposal_expired'; }
        record.lastObservedAt = observedAt as number; return null;
    };
    const arm = (record: LifecycleRecord, delayMs: number): boolean => {
        let scheduling = true, firedSynchronously = false, cancel: unknown;
        const callback = () => {
            if (scheduling) { firedSynchronously = true; return; } if (!record.active) return; record.cancel = null;
            if (observe(record)) return;
            const remaining = record.expiresAt - record.lastObservedAt; if (remaining <= 0 || !arm(record, remaining)) terminalize(record);
        };
        try { cancel = sources.scheduler(delayMs, callback); } catch { scheduling = false; terminalize(record); return false; }
        scheduling = false;
        if (firedSynchronously || typeof cancel !== 'function') { try { if (typeof cancel === 'function') cancel(); } catch { /* unpublished timer denied */ } terminalize(record); return false; }
        record.cancel = cancel as () => void; return true;
    };
    const inspect = async (lease: unknown, h1Snapshot: unknown): Promise<HeadlessSoapInspectRefV1> => {
        if (lifecycleReentry()) return fail('lifecycle_unavailable');
        const snapshot = acceptedSnapshot(h1Snapshot); if (!snapshot) return fail('snapshot_unavailable');
        if (typeof lease !== 'object' || lease === null || isProxy(lease) || weakGet(leases, lease)
            || Reflect.apply(weakSetHas, pending, [lease])) return fail('lease_unavailable');
        Reflect.apply(weakSetAdd, pending, [lease]);
        let scope: unknown, selectionRegistration: unknown = null, leaseRegistration: unknown = null, record: LifecycleRecord | null = null, leaseVerified = false;
        try {
            if (!await sources.leaseLifecycle.withCurrentLease(lease, () => undefined)) return fail('lease_unavailable');
            leaseVerified = true;
            let selectionSession: unknown;
            try { selectionSession = await sources.readCurrentSelectionSession(); } catch { return fail('selection_unavailable'); }
            if (selectionSession === null) return fail('selection_unavailable');
            const selected = sources.selectionLifecycle.withCurrentSelection(selectionSession, (candidate) => {
                scope = candidate; selectionRegistration = sources.selectionLifecycle.registerDependent(candidate, () => { if (record) terminalize(record); });
            });
            if (!selected || selectionRegistration === null || scope === undefined) return fail('selection_unavailable');
            leaseRegistration = sources.leaseLifecycle.registerDependent(lease, () => { if (record) terminalize(record); });
            if (leaseRegistration === null) return fail('lease_unavailable');
            let selectionAttached = false, leaseCurrent = false;
            try { leaseCurrent = await sources.leaseLifecycle.withCurrentDependent(lease, leaseRegistration, () => {
                try { selectionAttached = sources.selectionLifecycle.confirmDependent(scope, selectionRegistration); } catch { selectionAttached = false; }
            }); } catch { return fail('lease_unavailable'); }
            if (!leaseCurrent) return fail('lease_unavailable');
            if (!selectionAttached) return fail('selection_unavailable');
            let leaseAttached = false, selectionCurrent = false;
            try { selectionCurrent = sources.selectionLifecycle.withCurrentDependent(scope, selectionRegistration, () => {
                try { leaseAttached = sources.leaseLifecycle.confirmDependent(lease, leaseRegistration); } catch { leaseAttached = false; }
            }); } catch { return fail('selection_unavailable'); }
            if (!selectionCurrent) return fail('selection_unavailable');
            if (!leaseAttached) return fail('lease_unavailable');
            const observedAt = sources.clock(); if (!numberIsSafeInteger(observedAt) || observedAt < 0 || observedAt > maxSafeInteger - HEADLESS_SOAP_PROPOSAL_TTL_MS) return fail('lifecycle_unavailable');
            const inspectRef = opaque() as HeadlessSoapInspectRefV1;
            record = { active: true, lease, leaseRegistration, scope, selectionRegistration, snapshot, stage: 'inspect', stageRef: inspectRef,
                refs: [inspectRef], expiresAt: observedAt + HEADLESS_SOAP_PROPOSAL_TTL_MS, lastObservedAt: observedAt,
                proposalRevision: null, cancel: null, dependents: null };
            if (!arm(record, HEADLESS_SOAP_PROPOSAL_TTL_MS)) return fail('lifecycle_unavailable');
            const finalLeaseAttached = sources.leaseLifecycle.confirmDependent(lease, leaseRegistration);
            const finalSelectionAttached = sources.selectionLifecycle.confirmDependent(scope, selectionRegistration);
            if (!finalLeaseAttached || !finalSelectionAttached || !record.active || record.lease !== lease || record.leaseRegistration !== leaseRegistration
                || record.scope !== scope || record.selectionRegistration !== selectionRegistration || record.stage !== 'inspect' || record.stageRef !== inspectRef) {
                terminalize(record); return fail('lifecycle_unavailable');
            }
            const finalTimeFailure = observe(record); if (finalTimeFailure) return fail(finalTimeFailure);
            weakSet(stages, inspectRef, record); weakSet(leases, lease, record); return inspectRef;
        } catch (error) { if (record?.active) terminalize(record); if (error instanceof HeadlessSoapProposalLifecycleError) throw error; return fail('lifecycle_unavailable'); }
        finally { Reflect.apply(weakSetDelete, pending, [lease]); if (!record?.active) { if (leaseRegistration !== null) try { sources.leaseLifecycle.unregisterDependent(lease, leaseRegistration); } catch { /* partial attach retired */ }
            if (selectionRegistration !== null && scope !== undefined) try { sources.selectionLifecycle.unregisterDependent(scope, selectionRegistration); } catch { /* partial attach retired */ }
            if (leaseVerified && record === null) try { sources.leaseService.terminate(lease); } catch { /* verified lease remains denied locally */ } } }
    };
    const transition = async (candidate: unknown, expected: 'inspect' | 'preview', next: 'preview' | 'proposal'): Promise<HeadlessSoapPreviewRefV1 | HeadlessSoapProposalRefV1> => {
        if (lifecycleReentry()) return fail('lifecycle_unavailable');
        const publishesProposal = next === 'proposal';
        if (typeof candidate !== 'object' || candidate === null || isProxy(candidate)) return fail('stage_unavailable');
        const record = weakGet(stages, candidate); if (!record || !record.active) return fail('stage_unavailable');
        let leaseCurrent = false, selectionCurrent = false;
        try { leaseCurrent = await sources.leaseLifecycle.withCurrentDependent(record.lease, record.leaseRegistration, () => undefined); }
        catch { terminalize(record); return fail('lease_unavailable'); }
        if (!leaseCurrent) { terminalize(record); return fail('lease_unavailable'); }
        try { selectionCurrent = sources.selectionLifecycle.withCurrentDependent(record.scope, record.selectionRegistration, () => undefined); }
        catch { terminalize(record); return fail('selection_unavailable'); }
        if (!selectionCurrent) { terminalize(record); return fail('selection_unavailable'); }
        const timeFailure = observe(record); if (timeFailure) return fail(timeFailure);
        if (record.stage !== expected || record.stageRef !== candidate) return fail('stage_unavailable');
        let published: object | null = null, raced = false, lostSelection = false, callbackTimeFailure: HeadlessSoapProposalLifecycleErrorCode | null = null, transitioned = false;
        const publish = () => {
            if (!record.active || record.stage !== expected || record.stageRef !== candidate) { raced = true; return; }
            try { if (!sources.selectionLifecycle.confirmDependent(record.scope, record.selectionRegistration)) { lostSelection = true; return; } }
            catch { lostSelection = true; return; }
            callbackTimeFailure = observe(record); if (callbackTimeFailure) return;
            published = opaque(); record.stage = next; record.stageRef = published;
            record.refs.push(published); weakSet(stages, published, record); transitioned = true;
        };
        let current = false;
        try {
            current = publishesProposal
                ? await sources.leaseLifecycle.withCurrentProposalBudget(record.lease, record.leaseRegistration, publish)
                : await sources.leaseLifecycle.withCurrentDependent(record.lease, record.leaseRegistration, publish);
        } catch (error) {
            if ((error as { code?: unknown } | null)?.code === 'proposal_budget_exhausted') {
                if (!record.active || record.stage !== expected || record.stageRef !== candidate) return fail('stage_unavailable');
                terminalize(record); return fail('proposal_budget_exhausted');
            }
            if (raced) return fail('stage_unavailable'); terminalize(record); return fail('lease_unavailable');
        }
        if (callbackTimeFailure) return fail(callbackTimeFailure);
        if (lostSelection) { terminalize(record); return fail('selection_unavailable'); }
        if (!current) { if (raced) return fail('stage_unavailable'); terminalize(record); return fail('lease_unavailable'); }
        if (raced) return fail('stage_unavailable');
        let leaseAttached = false, selectionAttached = false;
        try { leaseAttached = sources.leaseLifecycle.confirmDependent(record.lease, record.leaseRegistration); }
        catch { terminalize(record); return fail('lifecycle_unavailable'); }
        try { selectionAttached = sources.selectionLifecycle.confirmDependent(record.scope, record.selectionRegistration); }
        catch { terminalize(record); return fail('lifecycle_unavailable'); }
        if (!transitioned || !published || !leaseAttached || !selectionAttached || !record.active || record.stage !== next
            || record.stageRef !== published || weakGet(stages, published) !== record) { terminalize(record); return fail('lifecycle_unavailable'); }
        const finalTimeFailure = observe(record); if (finalTimeFailure) return fail(finalTimeFailure);
        if (publishesProposal) record.proposalRevision = 1;
        return published as HeadlessSoapPreviewRefV1 | HeadlessSoapProposalRefV1;
    };
    const createdCurrent = (operation: LifecycleOperation): boolean => { for (let index = 0; index < operation.created.length; index += 1) {
        const dependent = operation.created[index]!; if (!dependent.active
            || weakGet(dependentRegistrations, dependent.registration) !== dependent) return false; } return true;
    };
    const runLifecycleOperation = async (candidate: unknown, registration: unknown,
        operation: (snapshot: ClinicianSoapWriteAccepted) => void, requiresDependent: boolean): Promise<boolean> => {
        if (lifecycleReentry()) return false;
        if (!synchronousCallback(operation)) return false;
        const record = proposalRecord(candidate); if (!record) return false;
        const dependent = requiresDependent ? dependentRecord(record, registration) : null; if (requiresDependent && !dependent) return false;
        if (observe(record) || proposalRecord(candidate) !== record) return false;
        const activeOperation: LifecycleOperation = { lifecycle: record, dependent, created: [], poisoned: false }; lifecycleOperation = activeOperation;
        const locallyCurrent = (): boolean => proposalRecord(candidate) === record
            && (!dependent || dependentRecord(record, registration) === dependent);
        let invoked = false, callbackAccepted = false, leaseCurrent = false, selectionCurrent = false;
        try { leaseCurrent = await sources.leaseLifecycle.withCurrentDependent(record.lease, record.leaseRegistration, () => {
            if (!locallyCurrent()) return;
            try { selectionCurrent = sources.selectionLifecycle.withCurrentDependent(record.scope, record.selectionRegistration, () => {
                if (!locallyCurrent()) return; const snapshot = record.snapshot; if (!snapshot) return;
                invoked = true; callbackAccepted = callbackSucceeded(operation as (...args: never[]) => void, [snapshot]);
            }); } catch { selectionCurrent = false; }
        }); } catch { leaseCurrent = false; }
        let leaseAttached = false, selectionAttached = false, timeCurrent = false;
        if (!activeOperation.poisoned && invoked && callbackAccepted && leaseCurrent && selectionCurrent && locallyCurrent()
            && createdCurrent(activeOperation)) {
            try { leaseAttached = sources.leaseLifecycle.confirmDependent(record.lease, record.leaseRegistration); } catch { leaseAttached = false; }
            try { selectionAttached = sources.selectionLifecycle.confirmDependent(record.scope, record.selectionRegistration); } catch { selectionAttached = false; }
            if (leaseAttached && selectionAttached && locallyCurrent() && createdCurrent(activeOperation)) timeCurrent = observe(record) === null;
        }
        const accepted = !activeOperation.poisoned && invoked && callbackAccepted && leaseCurrent && selectionCurrent && leaseAttached
            && selectionAttached && timeCurrent && locallyCurrent() && createdCurrent(activeOperation);
        lifecycleOperation = null; if (!accepted) terminalize(record); return accepted;
    };
    const service: HeadlessSoapProposalLifecycleServiceV1 = objectFreeze({
        inspect,
        preview(candidate: unknown): Promise<HeadlessSoapPreviewRefV1> { return transition(candidate, 'inspect', 'preview') as Promise<HeadlessSoapPreviewRefV1>; },
        proposal(candidate: unknown): Promise<HeadlessSoapProposalRefV1> { return transition(candidate, 'preview', 'proposal') as Promise<HeadlessSoapProposalRefV1>; },
        wipe(candidate: unknown): boolean { if (lifecycleReentry() || typeof candidate !== 'object' || candidate === null) return false;
            const record = weakGet(stages, candidate); return !!record && terminalize(record); },
    });
    const lifecycleController: HeadlessSoapProposalLifecycleControllerV1 = objectFreeze({
        withCurrentProposal(candidate: unknown, operation: (snapshot: ClinicianSoapWriteAccepted) => void): Promise<boolean> {
            return runLifecycleOperation(candidate, null, operation, false);
        },
        registerDependent(candidate: unknown, dispose: () => void): HeadlessSoapProposalDependentRegistrationV1 | null {
            if (lifecycleDrainActive) return null;
            const record = proposalRecord(candidate);
            if (!record || !synchronousCallback(dispose) || (lifecycleOperation
                && (lifecycleOperation.lifecycle !== record || lifecycleOperation.dependent !== null))) {
                if (lifecycleOperation) lifecycleOperation.poisoned = true; return null;
            }
            if (observe(record) || proposalRecord(candidate) !== record) { if (lifecycleOperation) lifecycleOperation.poisoned = true; return null; }
            const registration = opaque() as HeadlessSoapProposalDependentRegistrationV1;
            const dependent: ProposalDependentRecord = { registration, lifecycle: record, dispose, active: true,
                next: record.dependents, drainNext: null }; record.dependents = dependent; weakSet(dependentRegistrations, registration, dependent);
            if (lifecycleOperation) lifecycleOperation.created.push(dependent);
            let leaseAttached = false, selectionAttached = false;
            try { leaseAttached = sources.leaseLifecycle.confirmDependent(record.lease, record.leaseRegistration); } catch { leaseAttached = false; }
            try { selectionAttached = sources.selectionLifecycle.confirmDependent(record.scope, record.selectionRegistration); } catch { selectionAttached = false; }
            if (!leaseAttached || !selectionAttached || proposalRecord(candidate) !== record
                || dependentRecord(record, registration) !== dependent) {
                if (lifecycleOperation) lifecycleOperation.poisoned = true; terminalize(record); return null;
            }
            return registration;
        },
        confirmDependent(candidate: unknown, registration: unknown): boolean {
            if (lifecycleDrainActive) return false;
            const record = proposalRecord(candidate); if (!record || !dependentRecord(record, registration)) return false;
            let leaseAttached = false, selectionAttached = false;
            try { leaseAttached = sources.leaseLifecycle.confirmDependent(record.lease, record.leaseRegistration); } catch { leaseAttached = false; }
            try { selectionAttached = sources.selectionLifecycle.confirmDependent(record.scope, record.selectionRegistration); } catch { selectionAttached = false; }
            if (!leaseAttached || !selectionAttached || observe(record) || proposalRecord(candidate) !== record
                || !dependentRecord(record, registration)) { terminalize(record); return false; } return true;
        },
        unregisterDependent(candidate: unknown, registration: unknown): boolean {
            if (lifecycleDrainActive) return false;
            const record = proposalRecord(candidate); if (!record) return false; const dependent = dependentRecord(record, registration);
            if (!dependent) return false; dependent.active = false; weakDelete(dependentRegistrations, dependent.registration); unlinkDependent(dependent); return true;
        },
        withCurrentDependent(candidate: unknown, registration: unknown,
            operation: (snapshot: ClinicianSoapWriteAccepted) => void): Promise<boolean> {
            return runLifecycleOperation(candidate, registration, operation, true);
        },
    });
    const bindingController: HeadlessSoapProposalBindingControllerV1 = objectFreeze({
        async withCurrentDependentBinding(candidate: unknown, registration: unknown,
            operation: (binding: HeadlessSoapProposalBindingV1) => void): Promise<boolean> {
            if (lifecycleReentry()) return false;
            const record = proposalRecord(candidate); if (!record) return false;
            const dependent = dependentRecord(record, registration); if (!dependent) return false;
            if (!synchronousCallback(operation) || !sources.leaseBinding || !sources.selectionBinding) {
                terminalize(record); return false;
            }
            if (observe(record) || proposalRecord(candidate) !== record
                || dependentRecord(record, registration) !== dependent) return false;
            const activeOperation: LifecycleOperation = { lifecycle: record, dependent, created: [], poisoned: false };
            lifecycleOperation = activeOperation;
            const locallyCurrent = (): boolean => proposalRecord(candidate) === record
                && dependentRecord(record, registration) === dependent;
            let leaseInvoked = false, selectionInvoked = false, invoked = false, callbackAccepted = false;
            let leaseCurrent = false, selectionCurrent = false;
            try {
                leaseCurrent = await sources.leaseBinding.withCurrentDependentBinding(
                    record.lease,
                    record.leaseRegistration,
                    (childLease, activeRole) => {
                        if (leaseInvoked || !locallyCurrent()) { activeOperation.poisoned = true; return; }
                        leaseInvoked = true;
                        try {
                            selectionCurrent = sources.selectionBinding!.withCurrentDependentBinding(
                                record.scope,
                                record.selectionRegistration,
                                (selectionSnapshot) => {
                                    if (selectionInvoked || !locallyCurrent()) { activeOperation.poisoned = true; return; }
                                    selectionInvoked = true; invoked = true;
                                    const proposal = objectCreate(null) as Record<string, unknown>;
                                    proposal.proposalIdentity = candidate; proposal.revision = record.proposalRevision;
                                    proposal.expiresAt = record.expiresAt;
                                    const binding = objectCreate(null) as Record<string, unknown>;
                                    binding.activeRole = activeRole; binding.childLease = childLease;
                                    binding.selection = selectionSnapshot.selection;
                                    binding.patientVersion = selectionSnapshot.patientVersion;
                                    binding.proposal = objectFreeze(proposal);
                                    callbackAccepted = callbackSucceeded(
                                        operation as (...args: never[]) => void,
                                        [objectFreeze(binding)],
                                    );
                                },
                            );
                        } catch { selectionCurrent = false; }
                    },
                );
            } catch { leaseCurrent = false; }
            let leaseAttached = false, selectionAttached = false, timeCurrent = false;
            if (!activeOperation.poisoned && leaseInvoked && selectionInvoked && invoked && callbackAccepted
                && leaseCurrent && selectionCurrent && locallyCurrent() && createdCurrent(activeOperation)) {
                try { leaseAttached = sources.leaseLifecycle.confirmDependent(record.lease, record.leaseRegistration); }
                catch { leaseAttached = false; }
                try { selectionAttached = sources.selectionLifecycle.confirmDependent(record.scope, record.selectionRegistration); }
                catch { selectionAttached = false; }
                if (leaseAttached && selectionAttached && locallyCurrent()
                    && createdCurrent(activeOperation)) timeCurrent = observe(record) === null;
            }
            const accepted = !activeOperation.poisoned && leaseInvoked && selectionInvoked && invoked && callbackAccepted
                && leaseCurrent && selectionCurrent && leaseAttached && selectionAttached && timeCurrent
                && locallyCurrent() && createdCurrent(activeOperation);
            lifecycleOperation = null; if (!accepted) terminalize(record); return accepted;
        },
    });
    return objectFreeze({ service, lifecycleController, bindingController });
}
