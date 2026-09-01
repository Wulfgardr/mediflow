/* @Codex */
import 'server-only';
import { types } from 'node:util';
import { createHeadlessSoapEntryPresentationHandoff,
    type HeadlessSoapEntryPresentationHandoffV1 } from './headless-soap-entry-presentation-handoff';
import type { ClinicianSoapEntryFieldSetV1 } from '../headless/clinician-soap-entry-field-set';
import type { ClinicianSoapEntrySealV1 } from '../headless/clinician-soap-entry-seal';
import { verifyHeadlessSoapEntryGestureSealBundle } from './headless-soap-entry-seal-binding';
declare const presentationDependentRegistrationIdentity: unique symbol;
export type HeadlessSoapEntryPresentationDependentRegistrationV1 =
    Readonly<{ readonly [presentationDependentRegistrationIdentity]?: never }>;
export type HeadlessSoapEntryPresentationLifecycleErrorCode = 'field_set_unavailable' | 'seal_unavailable'
    | 'seal_mismatch' | 'lifecycle_unavailable' | 'gesture_unavailable';
export class HeadlessSoapEntryPresentationLifecycleError extends Error {
    constructor(readonly code: HeadlessSoapEntryPresentationLifecycleErrorCode) {
        super(`Headless SOAP entry presentation lifecycle rejected: ${code}`); this.name = 'HeadlessSoapEntryPresentationLifecycleError'; }
}
type EntryLifecyclePort = Readonly<{
    withCurrentEntry(candidate: unknown, operation: (fieldSet: ClinicianSoapEntryFieldSetV1) => void): Promise<boolean>;
    registerDependent(candidate: unknown, dispose: () => void): unknown | null;
    confirmDependent(candidate: unknown, registration: unknown): boolean;
    unregisterDependent(candidate: unknown, registration: unknown): boolean;
    withCurrentDependent(candidate: unknown, registration: unknown, operation: () => void): Promise<boolean>;
}>;
export type HeadlessSoapEntryPresentationLifecycleSources = Readonly<{
    entryLifecycle: EntryLifecyclePort;
    entryService: Readonly<{ wipe(candidate: unknown): boolean }>;
    entropy(): unknown;
}>;
export type HeadlessSoapEntryPresentationLifecycleServiceV1 = Readonly<{
    present(entryRef: unknown): Promise<HeadlessSoapEntryPresentationHandoffV1>;
    cancel(correlationToken: unknown): boolean;
}>;
export type HeadlessSoapEntryPresentationLifecycleControllerV1 = Readonly<{
    withCurrentPresentation(correlationToken: unknown, operation: () => void): Promise<boolean>;
    registerDependent(correlationToken: unknown, dispose: () => void):
        HeadlessSoapEntryPresentationDependentRegistrationV1 | null;
    confirmDependent(correlationToken: unknown, registration: unknown): boolean;
    unregisterDependent(correlationToken: unknown, registration: unknown): boolean;
    withCurrentDependent(correlationToken: unknown, registration: unknown, operation: () => void): Promise<boolean>;
}>;
export type HeadlessSoapEntryPresentationSealBindingControllerV1 = Readonly<{
    bindGestureSeal(correlationToken: unknown, sealBundle: unknown): Promise<boolean>;
}>;
type PresentationRecord = {
    active: boolean;
    state: 'presented' | 'gesture_bound';
    entryRef: object;
    entryRegistration: unknown;
    token: string | null;
    handoff: HeadlessSoapEntryPresentationHandoffV1 | null;
    sealBundle: ClinicianSoapEntrySealV1 | null;
    dependent: PresentationDependentRecord | null;
    dependentClaimed: boolean;
};
type PresentationDependentRecord = {
    active: boolean;
    lifecycle: PresentationRecord;
    registration: HeadlessSoapEntryPresentationDependentRegistrationV1;
    dispose: () => void;
    drainNext: PresentationDependentRecord | null;
};
type LifecycleOperation = {
    lifecycle: PresentationRecord;
    dependent: PresentationDependentRecord | null;
    created: PresentationDependentRecord | null;
    poisoned: boolean;
};
const objectCreate = Object.create, objectFreeze = Object.freeze, objectGetPrototypeOf = Object.getPrototypeOf;
const weakSetAdd = WeakSet.prototype.add, weakSetHas = WeakSet.prototype.has, weakSetDelete = WeakSet.prototype.delete;
const weakMapGet = WeakMap.prototype.get, weakMapSet = WeakMap.prototype.set, weakMapDelete = WeakMap.prototype.delete;
const mapGet = Map.prototype.get, mapSet = Map.prototype.set, mapDelete = Map.prototype.delete, mapHas = Map.prototype.has;
const setAdd = Set.prototype.add, setDelete = Set.prototype.delete, setHas = Set.prototype.has;
const apply = Reflect.apply, promiseThen = Promise.prototype.then, functionPrototype = Function.prototype;
const isAsyncFunction = types.isAsyncFunction, isGeneratorFunction = types.isGeneratorFunction;
const isPromise = types.isPromise, isProxy = types.isProxy;
function weakHas(registry: WeakSet<object>, key: object): boolean { return apply(weakSetHas, registry, [key]) as boolean; }
function weakAdd(registry: WeakSet<object>, key: object): void { apply(weakSetAdd, registry, [key]); }
function weakDelete(registry: WeakSet<object>, key: object): void { apply(weakSetDelete, registry, [key]); }
function weakGet<T>(registry: WeakMap<object, T>, key: object): T | undefined {
    return apply(weakMapGet, registry, [key]) as T | undefined;
}
function weakSet<T>(registry: WeakMap<object, T>, key: object, value: T): void { apply(weakMapSet, registry, [key, value]); }
function weakMapRemove<T>(registry: WeakMap<object, T>, key: object): void { apply(weakMapDelete, registry, [key]); }
function mapRead<T>(registry: Map<string, T>, key: string): T | undefined { return apply(mapGet, registry, [key]) as T | undefined; }
function mapWrite<T>(registry: Map<string, T>, key: string, value: T): void { apply(mapSet, registry, [key, value]); }
function mapRemove<T>(registry: Map<string, T>, key: string): void { apply(mapDelete, registry, [key]); }
function mapContains<T>(registry: Map<string, T>, key: string): boolean { return apply(mapHas, registry, [key]) as boolean; }
function setContains(registry: Set<string>, key: string): boolean { return apply(setHas, registry, [key]) as boolean; }
function setInsert(registry: Set<string>, key: string): void { apply(setAdd, registry, [key]); }
function setRemove(registry: Set<string>, key: string): void { apply(setDelete, registry, [key]); }
function opaque(): Readonly<Record<never, never>> { return objectFreeze(objectCreate(null)) as Readonly<Record<never, never>>; }
function fail(code: HeadlessSoapEntryPresentationLifecycleErrorCode): never {
    throw new HeadlessSoapEntryPresentationLifecycleError(code);
}
function synchronousCallback(value: unknown): value is (...args: never[]) => void {
    return typeof value === 'function' && !isProxy(value) && !isAsyncFunction(value) && !isGeneratorFunction(value)
        && objectGetPrototypeOf(value) === functionPrototype;
}
function callbackSucceeded(operation: (...args: never[]) => void): boolean {
    try {
        const result = apply(operation, undefined, []);
        if (result === undefined) return true;
        if (isPromise(result)) try { apply(promiseThen, result, [undefined, () => undefined]); } catch { /* denial remains local */ }
    } catch { /* fixed false below */ }
    return false;
}
/** Owns memory-only H5a presentation currentness without granting SOAP write authority. */
export function createHeadlessSoapEntryPresentationLifecycleOwner(
    sources: HeadlessSoapEntryPresentationLifecycleSources,
): Readonly<{
    service: HeadlessSoapEntryPresentationLifecycleServiceV1;
    lifecycleController: HeadlessSoapEntryPresentationLifecycleControllerV1;
    sealBindingController: HeadlessSoapEntryPresentationSealBindingControllerV1;
}> {
    const pendingEntries = new WeakSet<object>(), claimedEntries = new WeakSet<object>();
    const presentations = new Map<string, PresentationRecord>(), pendingTokens = new Set<string>(), claimedTokens = new Set<string>();
    const dependentRegistrations = new WeakMap<object, PresentationDependentRecord>();
    let h4CallInFlight = false, callbackActive = false, drainActive = false;
    let lifecycleOperation: LifecycleOperation | null = null;
    const recordFor = (candidate: unknown): PresentationRecord | null => {
        if (typeof candidate !== 'string') return null;
        const record = mapRead(presentations, candidate);
        return record?.active && record.token === candidate && record.handoff ? record : null;
    };
    const dependentFor = (record: PresentationRecord, registration: unknown): PresentationDependentRecord | null => {
        if (typeof registration !== 'object' || registration === null || isProxy(registration)) return null;
        const dependent = weakGet(dependentRegistrations, registration);
        return dependent?.active && dependent.lifecycle === record && dependent.registration === registration ? dependent : null;
    };
    const snapshotDependent = (record: PresentationRecord): PresentationDependentRecord | null => {
        const dependent = record.dependent; record.dependent = null;
        if (!dependent) return null;
        dependent.active = false; weakMapRemove(dependentRegistrations, dependent.registration); dependent.drainNext = null;
        return dependent;
    };
    const drainDependent = (dependent: PresentationDependentRecord | null): void => {
        let current = dependent; const previousDrain = drainActive; drainActive = true;
        while (current) {
            const next = current.drainNext; current.drainNext = null;
            try {
                const result = apply(current.dispose, undefined, []);
                if (isPromise(result)) try { apply(promiseThen, result, [undefined, () => undefined]); } catch { /* observed */ }
            } catch { /* one disposer cannot escape the boundary */ }
            current = next;
        }
        drainActive = previousDrain;
    };
    const terminalize = (record: PresentationRecord, fromH4: boolean): boolean => {
        if (!record.active) return false;
        record.active = false; const dependent = snapshotDependent(record), token = record.token;
        if (token !== null) { if (mapRead(presentations, token) === record) mapRemove(presentations, token); setRemove(pendingTokens, token); }
        record.token = null; record.handoff = null; record.sealBundle = null;
        if (!fromH4) {
            if (record.entryRegistration !== null) {
                try { sources.entryLifecycle.unregisterDependent(record.entryRef, record.entryRegistration); }
                catch { /* local retirement won */ }
            }
            try { sources.entryService.wipe(record.entryRef); } catch { /* local retirement won */ }
        }
        record.entryRegistration = null; drainDependent(dependent); return true;
    };
    const poisonReentry = (): boolean => {
        if (!callbackActive && !drainActive) return false;
        if (lifecycleOperation) lifecycleOperation.poisoned = true;
        return true;
    };
    const present = async (candidate: unknown): Promise<HeadlessSoapEntryPresentationHandoffV1> => {
        if (poisonReentry()) return fail('lifecycle_unavailable');
        if (typeof candidate !== 'object' || candidate === null || isProxy(candidate)
            || weakHas(pendingEntries, candidate) || weakHas(claimedEntries, candidate)) return fail('field_set_unavailable');
        weakAdd(pendingEntries, candidate);
        if (h4CallInFlight) { poisonReentry(); weakDelete(pendingEntries, candidate); return fail('lifecycle_unavailable'); }
        const recordBox: { value: PresentationRecord | null } = { value: null };
        let invoked = false, h4Current = false;
        const operation: LifecycleOperation = { lifecycle: null as unknown as PresentationRecord,
            dependent: null, created: null, poisoned: false };
        try {
            h4CallInFlight = true; lifecycleOperation = operation;
            try {
                h4Current = await sources.entryLifecycle.withCurrentEntry(candidate, (fieldSet) => {
                    if (callbackActive || invoked) { operation.poisoned = true; return; }
                    callbackActive = true; invoked = true; weakAdd(claimedEntries, candidate);
                    let handoff: HeadlessSoapEntryPresentationHandoffV1 | null = null;
                    try { handoff = createHeadlessSoapEntryPresentationHandoff(fieldSet, sources.entropy()); } catch { handoff = null; }
                    if (!handoff || setContains(claimedTokens, handoff.correlationToken)
                        || mapContains(presentations, handoff.correlationToken)
                        || setContains(pendingTokens, handoff.correlationToken)) { callbackActive = false; return; }
                    setInsert(claimedTokens, handoff.correlationToken); setInsert(pendingTokens, handoff.correlationToken);
                    recordBox.value = { active: true, state: 'presented', entryRef: candidate, entryRegistration: null,
                        token: handoff.correlationToken, handoff, sealBundle: null, dependent: null, dependentClaimed: false };
                    operation.lifecycle = recordBox.value;
                    const attachedRecord = recordBox.value;
                    const registration = sources.entryLifecycle.registerDependent(candidate, () => {
                        terminalize(attachedRecord, true);
                    });
                    if (registration !== null) attachedRecord.entryRegistration = registration;
                    callbackActive = false;
                });
            } catch { h4Current = false; }
            finally { callbackActive = false; h4CallInFlight = false; if (lifecycleOperation === operation) lifecycleOperation = null; }
            if (!invoked) return fail('field_set_unavailable');
            const record = recordBox.value;
            if (!record?.active || !record.handoff || record.entryRegistration === null || operation.poisoned || !h4Current) {
                return fail('lifecycle_unavailable');
            }
            let attached = false;
            try { attached = sources.entryLifecycle.confirmDependent(candidate, record.entryRegistration); } catch { attached = false; }
            if (!attached || !record.active || operation.poisoned || record.token === null || record.handoff === null
                || !setContains(pendingTokens, record.token) || mapContains(presentations, record.token)) {
                return fail('lifecycle_unavailable');
            }
            const handoff = record.handoff; mapWrite(presentations, record.token, record); setRemove(pendingTokens, record.token);
            return handoff;
        } catch (error) {
            const record = recordBox.value;
            if (record) { if (record.active) terminalize(record, false); }
            else if (invoked) try { sources.entryService.wipe(candidate); } catch { /* claimed entry remains spent */ }
            if (error instanceof HeadlessSoapEntryPresentationLifecycleError) throw error;
            return fail('lifecycle_unavailable');
        } finally {
            callbackActive = false; h4CallInFlight = false; if (lifecycleOperation === operation) lifecycleOperation = null;
            weakDelete(pendingEntries, candidate);
        }
    };
    const runLifecycleOperation = async (candidate: unknown, registration: unknown,
        callback: () => void, requiresDependent: boolean): Promise<boolean> => {
        if (poisonReentry()) return false;
        const record = recordFor(candidate); if (!record) return false;
        const dependent = requiresDependent ? dependentFor(record, registration) : null;
        if (requiresDependent && !dependent) return false;
        if (h4CallInFlight) { poisonReentry(); return false; }
        if (!synchronousCallback(callback)) { terminalize(record, false); return false; }
        const operation: LifecycleOperation = { lifecycle: record, dependent, created: null, poisoned: false };
        h4CallInFlight = true; lifecycleOperation = operation;
        const locallyCurrent = (): boolean => recordFor(candidate) === record
            && (!dependent || dependentFor(record, registration) === dependent);
        let invoked = false, callbackAccepted = false, h4Current = false;
        try {
            h4Current = await sources.entryLifecycle.withCurrentDependent(record.entryRef, record.entryRegistration, () => {
                if (callbackActive || invoked || !locallyCurrent()) { operation.poisoned = true; return; }
                callbackActive = true; invoked = true; callbackAccepted = callbackSucceeded(callback); callbackActive = false;
            });
        } catch { h4Current = false; }
        finally { callbackActive = false; h4CallInFlight = false; if (lifecycleOperation === operation) lifecycleOperation = null; }
        const createdCurrent = !operation.created || dependentFor(record, operation.created.registration) === operation.created;
        let attached = false;
        if (!operation.poisoned && invoked && callbackAccepted && h4Current && locallyCurrent() && createdCurrent) {
            try { attached = sources.entryLifecycle.confirmDependent(record.entryRef, record.entryRegistration); } catch { attached = false; }
        }
        const accepted = !operation.poisoned && invoked && callbackAccepted && h4Current && attached
            && locallyCurrent() && createdCurrent;
        if (!accepted) terminalize(record, false);
        return accepted;
    };
    const service: HeadlessSoapEntryPresentationLifecycleServiceV1 = objectFreeze({ present,
        cancel(candidate: unknown): boolean {
            if (poisonReentry()) return false; const record = recordFor(candidate); return !!record && terminalize(record, false);
        } });
    const lifecycleController: HeadlessSoapEntryPresentationLifecycleControllerV1 = objectFreeze({
        withCurrentPresentation(candidate: unknown, operation: () => void): Promise<boolean> {
            return runLifecycleOperation(candidate, null, operation, false);
        },
        registerDependent(candidate: unknown, dispose: () => void): HeadlessSoapEntryPresentationDependentRegistrationV1 | null {
            if (drainActive) return null; const record = recordFor(candidate);
            if (!record || record.state !== 'gesture_bound' || record.dependentClaimed || !synchronousCallback(dispose)
                || (h4CallInFlight && (!callbackActive || lifecycleOperation?.lifecycle !== record
                    || lifecycleOperation.dependent !== null))) {
                if (callbackActive && lifecycleOperation) lifecycleOperation.poisoned = true;
                return null;
            }
            const registration = opaque() as HeadlessSoapEntryPresentationDependentRegistrationV1;
            const dependent: PresentationDependentRecord = { active: true, lifecycle: record, registration,
                dispose, drainNext: null };
            record.dependentClaimed = true; record.dependent = dependent; weakSet(dependentRegistrations, registration, dependent);
            if (callbackActive && lifecycleOperation) lifecycleOperation.created = dependent;
            let attached = false;
            try { attached = sources.entryLifecycle.confirmDependent(record.entryRef, record.entryRegistration); } catch { attached = false; }
            if (!attached || recordFor(candidate) !== record || dependentFor(record, registration) !== dependent) {
                if (callbackActive && lifecycleOperation) lifecycleOperation.poisoned = true;
                terminalize(record, false); return null;
            }
            return registration;
        },
        confirmDependent(candidate: unknown, registration: unknown): boolean {
            if (drainActive) return false; const record = recordFor(candidate);
            if (!record || !dependentFor(record, registration)) return false;
            if (h4CallInFlight && (!callbackActive || lifecycleOperation?.lifecycle !== record)) {
                if (callbackActive && lifecycleOperation) lifecycleOperation.poisoned = true; return false;
            }
            let attached = false;
            try { attached = sources.entryLifecycle.confirmDependent(record.entryRef, record.entryRegistration); } catch { attached = false; }
            if (!attached || recordFor(candidate) !== record || !dependentFor(record, registration)) {
                terminalize(record, false); return false;
            }
            return true;
        },
        unregisterDependent(candidate: unknown, registration: unknown): boolean {
            if (drainActive) return false; const record = recordFor(candidate); if (!record) return false;
            const dependent = dependentFor(record, registration); if (!dependent) return false;
            if (h4CallInFlight && (!callbackActive || lifecycleOperation?.lifecycle !== record)) {
                if (callbackActive && lifecycleOperation) lifecycleOperation.poisoned = true; return false;
            }
            dependent.active = false; record.dependent = null; weakMapRemove(dependentRegistrations, dependent.registration); return true;
        },
        withCurrentDependent(candidate: unknown, registration: unknown, operation: () => void): Promise<boolean> {
            return runLifecycleOperation(candidate, registration, operation, true);
        },
    });
    const sealBindingController: HeadlessSoapEntryPresentationSealBindingControllerV1 = objectFreeze({
        async bindGestureSeal(candidate: unknown, sealBundleCandidate: unknown): Promise<boolean> {
            if (poisonReentry()) return false;
            const record = recordFor(candidate);
            if (!record) return false;
            if (record.state !== 'presented' || record.sealBundle !== null || !record.handoff) {
                terminalize(record, false);
                return false;
            }
            const sealBundle = verifyHeadlessSoapEntryGestureSealBundle(record.handoff.fieldSet, sealBundleCandidate);
            if (!sealBundle) {
                terminalize(record, false);
                return false;
            }
            const accepted = await runLifecycleOperation(candidate, null, () => {
                if (record.state !== 'presented' || record.sealBundle !== null) throw new Error('gesture binding changed');
                record.sealBundle = sealBundle;
                record.state = 'gesture_bound';
            }, false);
            const boundRecord = recordFor(candidate);
            if (!accepted || boundRecord !== record || boundRecord?.state !== 'gesture_bound'
                || boundRecord.sealBundle !== sealBundle) {
                terminalize(record, false);
                return false;
            }
            return true;
        },
    });
    return objectFreeze({ service, lifecycleController, sealBindingController });
}
