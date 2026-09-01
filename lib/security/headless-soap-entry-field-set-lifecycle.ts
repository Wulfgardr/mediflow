/* @Codex */
import 'server-only';

import { types } from 'node:util';

import {
    createClinicianSoapEntryFieldSet, type ClinicianSoapEntryFieldSetV1,
} from '../headless/clinician-soap-entry-field-set';
import type {
    ClinicianSoapWriteAccepted,
} from '../headless/clinician-soap-write-contract';
import type { HeadlessSoapProposalBindingV1 } from './headless-soap-proposal-lifecycle';

declare const entryRefIdentity: unique symbol;
declare const entryDependentRegistrationIdentity: unique symbol;
export type HeadlessSoapEntryRefV1 = Readonly<{ readonly [entryRefIdentity]?: never }>;
export type HeadlessSoapEntryDependentRegistrationV1 = Readonly<{ readonly [entryDependentRegistrationIdentity]?: never }>;
export type HeadlessSoapEntryFieldSetLifecycleErrorCode = 'proposal_unavailable' | 'field_set_unavailable'
    | 'seal_unavailable' | 'seal_mismatch' | 'lifecycle_unavailable';
export class HeadlessSoapEntryFieldSetLifecycleError extends Error {
    constructor(readonly code: HeadlessSoapEntryFieldSetLifecycleErrorCode) {
        super(`Headless SOAP entry field set lifecycle rejected: ${code}`); this.name = 'HeadlessSoapEntryFieldSetLifecycleError';
    }
}
export type HeadlessSoapProposalLifecyclePortForEntryV1 = Readonly<{
    withCurrentProposal(candidate: unknown, operation: (snapshot: ClinicianSoapWriteAccepted) => void): Promise<boolean>;
    registerDependent(candidate: unknown, dispose: () => void): unknown | null;
    confirmDependent(candidate: unknown, registration: unknown): boolean;
    unregisterDependent(candidate: unknown, registration: unknown): boolean;
    withCurrentDependent(candidate: unknown, registration: unknown,
        operation: (snapshot: ClinicianSoapWriteAccepted) => void): Promise<boolean>;
}>;
export type HeadlessSoapEntryFieldSetLifecycleSources = Readonly<{
    proposalLifecycle: HeadlessSoapProposalLifecyclePortForEntryV1;
    proposalBinding?: Readonly<{
        withCurrentDependentBinding(candidate: unknown, registration: unknown,
            operation: (binding: HeadlessSoapProposalBindingV1) => void): Promise<boolean>;
    }>;
    proposalService: Readonly<{ wipe(candidate: unknown): boolean }>;
    clock(): number;
    createFieldSet?(snapshot: unknown, epochMilliseconds: unknown): ClinicianSoapEntryFieldSetV1 | null;
}>;
export type HeadlessSoapEntryFieldSetLifecycleServiceV1 = Readonly<{
    materialize(proposalRef: unknown): Promise<HeadlessSoapEntryRefV1>;
    wipe(entryRef: unknown): boolean;
}>;
export type HeadlessSoapEntryFieldSetLifecycleControllerV1 = Readonly<{
    withCurrentEntry(candidate: unknown, operation: (fieldSet: ClinicianSoapEntryFieldSetV1) => void): Promise<boolean>;
    registerDependent(candidate: unknown, dispose: () => void): HeadlessSoapEntryDependentRegistrationV1 | null;
    confirmDependent(candidate: unknown, registration: unknown): boolean;
    unregisterDependent(candidate: unknown, registration: unknown): boolean;
    withCurrentDependent(candidate: unknown, registration: unknown,
        operation: (fieldSet: ClinicianSoapEntryFieldSetV1) => void): Promise<boolean>;
}>;
export type HeadlessSoapEntryFieldSetBindingV1 = Readonly<{
    activeRole: HeadlessSoapProposalBindingV1['activeRole'];
    childLease: HeadlessSoapProposalBindingV1['childLease'];
    selection: HeadlessSoapProposalBindingV1['selection'];
    patientVersion: HeadlessSoapProposalBindingV1['patientVersion'];
    proposal: HeadlessSoapProposalBindingV1['proposal'];
    entryIdentity: HeadlessSoapEntryRefV1;
    payloadDigest: ClinicianSoapEntryFieldSetV1['payloadDigest'];
}>;
export type HeadlessSoapEntryFieldSetBindingControllerV1 = Readonly<{
    withCurrentDependentBinding(candidate: unknown, registration: unknown,
        operation: (binding: HeadlessSoapEntryFieldSetBindingV1) => void): Promise<boolean>;
}>;

type EntryRecord = {
    active: boolean; proposalRef: object; proposalRegistration: unknown; entryRef: HeadlessSoapEntryRefV1;
    fieldSet: ClinicianSoapEntryFieldSetV1 | null; dependents: EntryDependentRecord | null;
};
type EntryDependentRecord = {
    registration: HeadlessSoapEntryDependentRegistrationV1; lifecycle: EntryRecord; dispose: () => void;
    active: boolean; next: EntryDependentRecord | null; drainNext: EntryDependentRecord | null;
};
type LifecycleOperation = {
    lifecycle: EntryRecord | null; dependent: EntryDependentRecord | null; created: EntryDependentRecord[]; poisoned: boolean;
};
const objectCreate = Object.create, objectFreeze = Object.freeze, objectGetPrototypeOf = Object.getPrototypeOf;
const weakMapGet = WeakMap.prototype.get, weakMapSet = WeakMap.prototype.set, weakMapDelete = WeakMap.prototype.delete;
const weakSetAdd = WeakSet.prototype.add, weakSetHas = WeakSet.prototype.has, weakSetDelete = WeakSet.prototype.delete;
const apply = Reflect.apply, promiseThen = Promise.prototype.then, functionPrototype = Function.prototype;
const isAsyncFunction = types.isAsyncFunction, isGeneratorFunction = types.isGeneratorFunction;
const isPromise = types.isPromise, isProxy = types.isProxy;
function weakGet<T>(registry: WeakMap<object, T>, key: object): T | undefined { return apply(weakMapGet, registry, [key]) as T | undefined; }
function weakSet<T>(registry: WeakMap<object, T>, key: object, value: T): void { apply(weakMapSet, registry, [key, value]); }
function weakDelete<T>(registry: WeakMap<object, T>, key: object): void { apply(weakMapDelete, registry, [key]); }
function opaque(): Readonly<Record<never, never>> { return objectFreeze(objectCreate(null)) as Readonly<Record<never, never>>; }
function fail(code: HeadlessSoapEntryFieldSetLifecycleErrorCode): never { throw new HeadlessSoapEntryFieldSetLifecycleError(code); }
function synchronousCallback(value: unknown): value is (...args: never[]) => void {
    return typeof value === 'function' && !isProxy(value) && !isAsyncFunction(value) && !isGeneratorFunction(value)
        && objectGetPrototypeOf(value) === functionPrototype;
}
function callbackSucceeded(operation: (...args: never[]) => void, args: unknown[]): boolean {
    try { const result = apply(operation, undefined, args); if (result === undefined) return true;
        if (isPromise(result)) try { apply(promiseThen, result, [undefined, () => undefined]); } catch { /* denial remains local */ }
    } catch { /* fixed false below */ } return false;
}

/** Owns one memory-only H4 field-set lifecycle and grants no clinical write authority. */
export function createHeadlessSoapEntryFieldSetLifecycleOwner(sources: HeadlessSoapEntryFieldSetLifecycleSources): Readonly<{
    service: HeadlessSoapEntryFieldSetLifecycleServiceV1;
    lifecycleController: HeadlessSoapEntryFieldSetLifecycleControllerV1;
    bindingController: HeadlessSoapEntryFieldSetBindingControllerV1;
}> {
    const entries = new WeakMap<object, EntryRecord>(), pending = new WeakSet<object>(), claimed = new WeakSet<object>();
    const dependentRegistrations = new WeakMap<object, EntryDependentRecord>();
    const fieldSetFactory = sources.createFieldSet ?? createClinicianSoapEntryFieldSet;
    let h3CallInFlight = false, callbackActive = false, lifecycleOperation: LifecycleOperation | null = null, lifecycleDrainActive = false;
    const recordFor = (candidate: unknown): EntryRecord | null => {
        if (typeof candidate !== 'object' || candidate === null || isProxy(candidate)) return null;
        const record = weakGet(entries, candidate); return record?.active && record.entryRef === candidate && record.fieldSet ? record : null;
    };
    const dependentFor = (record: EntryRecord, registration: unknown): EntryDependentRecord | null => {
        if (typeof registration !== 'object' || registration === null || isProxy(registration)) return null;
        const dependent = weakGet(dependentRegistrations, registration); return dependent?.active
            && dependent.registration === registration && dependent.lifecycle === record ? dependent : null;
    };
    const unlinkDependent = (dependent: EntryDependentRecord): void => { const record = dependent.lifecycle;
        if (record.dependents === dependent) record.dependents = dependent.next;
        else { let previous = record.dependents; while (previous && previous.next !== dependent) previous = previous.next;
            if (previous) previous.next = dependent.next; } dependent.next = null;
    };
    const snapshotDependents = (record: EntryRecord): EntryDependentRecord | null => { let dependent = record.dependents;
        let drain: EntryDependentRecord | null = null; record.dependents = null;
        while (dependent) { const next = dependent.next; dependent.next = null; dependent.drainNext = drain; drain = dependent;
            dependent.active = false; weakDelete(dependentRegistrations, dependent.registration); dependent = next; } return drain;
    };
    const invokeDependentDrain = (dependent: EntryDependentRecord | null): void => { let current = dependent;
        const previousDrain = lifecycleDrainActive; lifecycleDrainActive = true;
        while (current) { const next = current.drainNext; current.drainNext = null;
            try { const result = apply(current.dispose, undefined, []); if (isPromise(result)) {
                try { apply(promiseThen, result, [undefined, () => undefined]); } catch { /* rejection remains observed */ }
            } } catch { /* one disposer cannot retain siblings */ } current = next; }
        lifecycleDrainActive = previousDrain;
    };
    const terminalize = (record: EntryRecord, fromH3: boolean): boolean => {
        if (!record.active) return false; record.active = false; const dependents = snapshotDependents(record);
        weakDelete(entries, record.entryRef); record.fieldSet = null;
        if (!fromH3) {
            try { sources.proposalLifecycle.unregisterDependent(record.proposalRef, record.proposalRegistration); } catch { /* local retirement won */ }
            try { sources.proposalService.wipe(record.proposalRef); } catch { /* local retirement won */ }
        }
        invokeDependentDrain(dependents); return true;
    };
    const poisonReentry = (): boolean => { if (!callbackActive && !lifecycleDrainActive) return false;
        if (lifecycleOperation) lifecycleOperation.poisoned = true; return true; };
    const createdCurrent = (operation: LifecycleOperation): boolean => { for (let index = 0; index < operation.created.length; index += 1) {
        const dependent = operation.created[index]!; if (!dependent.active
            || weakGet(dependentRegistrations, dependent.registration) !== dependent) return false; } return true;
    };
    const materialize = async (candidate: unknown): Promise<HeadlessSoapEntryRefV1> => {
        if (typeof candidate !== 'object' || candidate === null || isProxy(candidate) || apply(weakSetHas, pending, [candidate])
            || apply(weakSetHas, claimed, [candidate])) return fail('proposal_unavailable');
        if (h3CallInFlight) { poisonReentry(); return fail('lifecycle_unavailable'); }
        apply(weakSetAdd, pending, [candidate]); const recordBox: { value: EntryRecord | null } = { value: null };
        let registration: unknown = null;
        const activeOperation: LifecycleOperation = { lifecycle: null, dependent: null, created: [], poisoned: false };
        let invoked = false, fieldSetFailure = false, current = false;
        try {
            h3CallInFlight = true; lifecycleOperation = activeOperation;
            try { current = await sources.proposalLifecycle.withCurrentProposal(candidate, (snapshot) => {
                if (callbackActive || invoked) { activeOperation.poisoned = true; return; }
                callbackActive = true; invoked = true; apply(weakSetAdd, claimed, [candidate]);
                let fieldSet: ClinicianSoapEntryFieldSetV1 | null = null;
                try { const epochMilliseconds = sources.clock(); fieldSet = fieldSetFactory(snapshot, epochMilliseconds); }
                catch { fieldSet = null; }
                if (!fieldSet) { fieldSetFailure = true; callbackActive = false; return; }
                const entryRef = opaque() as HeadlessSoapEntryRefV1;
                const provisional: EntryRecord = { active: true, proposalRef: candidate, proposalRegistration: null,
                    entryRef, fieldSet, dependents: null };
                recordBox.value = provisional; activeOperation.lifecycle = provisional;
                registration = sources.proposalLifecycle.registerDependent(candidate, () => {
                    const attachedRecord = recordBox.value; if (attachedRecord) terminalize(attachedRecord, true);
                });
                if (registration !== null) provisional.proposalRegistration = registration;
                callbackActive = false;
            }); } catch { current = false; } finally { callbackActive = false; h3CallInFlight = false; lifecycleOperation = null; }
            if (!invoked) return fail('proposal_unavailable');
            if (fieldSetFailure) return fail('field_set_unavailable');
            const record = recordBox.value; let attached = false;
            if (current && !activeOperation.poisoned && record?.active && registration !== null
                && record.proposalRegistration === registration) {
                try { attached = sources.proposalLifecycle.confirmDependent(candidate, registration); } catch { attached = false; }
            }
            if (!attached || !record?.active || activeOperation.poisoned || registration === null
                || record.proposalRef !== candidate || record.proposalRegistration !== registration) return fail('lifecycle_unavailable');
            weakSet(entries, record.entryRef, record);
            return record.entryRef;
        } catch (error) {
            const record = recordBox.value;
            if (record) { if (record.active) terminalize(record, false); }
            else if (apply(weakSetHas, claimed, [candidate])) {
                try { sources.proposalService.wipe(candidate); } catch { /* claim remains terminal */ }
            }
            if (error instanceof HeadlessSoapEntryFieldSetLifecycleError) throw error; return fail('lifecycle_unavailable');
        } finally { callbackActive = false; h3CallInFlight = false; if (lifecycleOperation === activeOperation) lifecycleOperation = null;
            apply(weakSetDelete, pending, [candidate]); }
    };
    const runLifecycleOperation = async (candidate: unknown, registration: unknown,
        operation: (fieldSet: ClinicianSoapEntryFieldSetV1) => void, requiresDependent: boolean): Promise<boolean> => {
        const record = recordFor(candidate); if (!record) return false;
        const dependent = requiresDependent ? dependentFor(record, registration) : null; if (requiresDependent && !dependent) return false;
        if (h3CallInFlight) { poisonReentry(); return false; }
        if (!synchronousCallback(operation)) { terminalize(record, false); return false; }
        const activeOperation: LifecycleOperation = { lifecycle: record, dependent, created: [], poisoned: false };
        h3CallInFlight = true; lifecycleOperation = activeOperation;
        const locallyCurrent = (): boolean => recordFor(candidate) === record
            && (!dependent || dependentFor(record, registration) === dependent);
        let invoked = false, callbackAccepted = false, h3Current = false;
        try { h3Current = await sources.proposalLifecycle.withCurrentDependent(record.proposalRef, record.proposalRegistration, () => {
            if (callbackActive || invoked || !locallyCurrent()) { activeOperation.poisoned = true; return; }
            const fieldSet = record.fieldSet; if (!fieldSet) { activeOperation.poisoned = true; return; }
            callbackActive = true; invoked = true; callbackAccepted = callbackSucceeded(operation as (...args: never[]) => void, [fieldSet]);
            callbackActive = false;
        }); } catch { h3Current = false; } finally { callbackActive = false; h3CallInFlight = false;
            if (lifecycleOperation === activeOperation) lifecycleOperation = null; }
        let attached = false;
        if (!activeOperation.poisoned && invoked && callbackAccepted && h3Current && locallyCurrent() && createdCurrent(activeOperation)) {
            try { attached = sources.proposalLifecycle.confirmDependent(record.proposalRef, record.proposalRegistration); } catch { attached = false; }
        }
        const accepted = !activeOperation.poisoned && invoked && callbackAccepted && h3Current && attached
            && locallyCurrent() && createdCurrent(activeOperation);
        if (!accepted) terminalize(record, false); return accepted;
    };
    const service: HeadlessSoapEntryFieldSetLifecycleServiceV1 = objectFreeze({ materialize,
        wipe(candidate: unknown): boolean { if (poisonReentry()) return false; const record = recordFor(candidate); return !!record && terminalize(record, false); } });
    const lifecycleController: HeadlessSoapEntryFieldSetLifecycleControllerV1 = objectFreeze({
        withCurrentEntry(candidate: unknown, operation: (fieldSet: ClinicianSoapEntryFieldSetV1) => void): Promise<boolean> {
            return runLifecycleOperation(candidate, null, operation, false);
        },
        registerDependent(candidate: unknown, dispose: () => void): HeadlessSoapEntryDependentRegistrationV1 | null {
            if (lifecycleDrainActive) return null; const record = recordFor(candidate);
            if (!record || !synchronousCallback(dispose) || (h3CallInFlight
                && (!callbackActive || lifecycleOperation?.lifecycle !== record || lifecycleOperation.dependent !== null))) {
                if (callbackActive && lifecycleOperation) lifecycleOperation.poisoned = true; return null;
            }
            const registration = opaque() as HeadlessSoapEntryDependentRegistrationV1;
            const dependent: EntryDependentRecord = { registration, lifecycle: record, dispose, active: true,
                next: record.dependents, drainNext: null }; record.dependents = dependent; weakSet(dependentRegistrations, registration, dependent);
            if (callbackActive && lifecycleOperation) lifecycleOperation.created.push(dependent);
            let attached = false; try { attached = sources.proposalLifecycle.confirmDependent(record.proposalRef, record.proposalRegistration); }
            catch { attached = false; }
            if (!attached || recordFor(candidate) !== record || dependentFor(record, registration) !== dependent) {
                if (callbackActive && lifecycleOperation) lifecycleOperation.poisoned = true; terminalize(record, false); return null;
            }
            return registration;
        },
        confirmDependent(candidate: unknown, registration: unknown): boolean {
            if (lifecycleDrainActive) return false; const record = recordFor(candidate); if (!record || !dependentFor(record, registration)) return false;
            if (callbackActive) { if (lifecycleOperation) lifecycleOperation.poisoned = true; return false; }
            if (h3CallInFlight) return false;
            let attached = false; try { attached = sources.proposalLifecycle.confirmDependent(record.proposalRef, record.proposalRegistration); }
            catch { attached = false; }
            if (!attached || recordFor(candidate) !== record || !dependentFor(record, registration)) { terminalize(record, false); return false; }
            return true;
        },
        unregisterDependent(candidate: unknown, registration: unknown): boolean {
            if (lifecycleDrainActive) return false; const record = recordFor(candidate); if (!record) return false;
            const dependent = dependentFor(record, registration); if (!dependent) return false;
            if (callbackActive) { if (lifecycleOperation) lifecycleOperation.poisoned = true; return false; }
            if (h3CallInFlight) return false;
            dependent.active = false;
            weakDelete(dependentRegistrations, dependent.registration); unlinkDependent(dependent); return true;
        },
        withCurrentDependent(candidate: unknown, registration: unknown,
            operation: (fieldSet: ClinicianSoapEntryFieldSetV1) => void): Promise<boolean> {
            return runLifecycleOperation(candidate, registration, operation, true);
        },
    });
    const bindingController: HeadlessSoapEntryFieldSetBindingControllerV1 = objectFreeze({
        async withCurrentDependentBinding(candidate: unknown, registration: unknown,
            operation: (binding: HeadlessSoapEntryFieldSetBindingV1) => void): Promise<boolean> {
            const record = recordFor(candidate); if (!record) return false;
            const dependent = dependentFor(record, registration); if (!dependent) return false;
            if (h3CallInFlight) { poisonReentry(); return false; }
            if (!synchronousCallback(operation) || !sources.proposalBinding) { terminalize(record, false); return false; }
            const activeOperation: LifecycleOperation = { lifecycle: record, dependent, created: [], poisoned: false };
            h3CallInFlight = true; lifecycleOperation = activeOperation;
            const locallyCurrent = (): boolean => recordFor(candidate) === record
                && dependentFor(record, registration) === dependent;
            let invoked = false, callbackAccepted = false, h3Current = false;
            try {
                h3Current = await sources.proposalBinding.withCurrentDependentBinding(
                    record.proposalRef,
                    record.proposalRegistration,
                    (upstream) => {
                        if (callbackActive || invoked || !locallyCurrent()) { activeOperation.poisoned = true; return; }
                        const fieldSet = record.fieldSet; if (!fieldSet) { activeOperation.poisoned = true; return; }
                        callbackActive = true; invoked = true;
                        const binding = objectCreate(null) as Record<string, unknown>;
                        binding.activeRole = upstream.activeRole;
                        binding.childLease = upstream.childLease;
                        binding.selection = upstream.selection;
                        binding.patientVersion = upstream.patientVersion;
                        binding.proposal = upstream.proposal;
                        binding.entryIdentity = record.entryRef;
                        binding.payloadDigest = fieldSet.payloadDigest;
                        callbackAccepted = callbackSucceeded(
                            operation as (...args: never[]) => void,
                            [objectFreeze(binding)],
                        );
                        callbackActive = false;
                    },
                );
            } catch { h3Current = false; }
            finally {
                callbackActive = false; h3CallInFlight = false;
                if (lifecycleOperation === activeOperation) lifecycleOperation = null;
            }
            let attached = false;
            if (!activeOperation.poisoned && invoked && callbackAccepted && h3Current
                && locallyCurrent() && createdCurrent(activeOperation)) {
                try { attached = sources.proposalLifecycle.confirmDependent(record.proposalRef, record.proposalRegistration); }
                catch { attached = false; }
            }
            const accepted = !activeOperation.poisoned && invoked && callbackAccepted && h3Current && attached
                && locallyCurrent() && createdCurrent(activeOperation);
            if (!accepted) terminalize(record, false);
            return accepted;
        },
    });
    return objectFreeze({ service, lifecycleController, bindingController });
}
