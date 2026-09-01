/* @Codex */
import 'server-only';
import { types } from 'node:util';
import {
    createHeadlessSoapAuthorizationProofToken,
    digestHeadlessSoapAuthorizationProof,
} from './headless-soap-authorization-proof-token';
import {
    isHeadlessSoapFreshPinVerificationV1,
    type HeadlessSoapFreshPinVerificationV1,
} from './headless-soap-fresh-pin-verification';
import {
    createHeadlessSoapAuthorizationLineage,
    HEADLESS_SOAP_AUTHORIZATION_LINEAGE_SCHEMA,
    HEADLESS_SOAP_AUTHORIZATION_POLICY_DIGEST,
    type HeadlessSoapAuthorizationLineageV1,
} from './headless-soap-authorization-lineage';
import type {
    HeadlessSoapEntryPresentationBindingV1,
} from './headless-soap-entry-presentation-lifecycle';
import type { ClinicianSoapEntrySealV1 } from '../headless/clinician-soap-entry-seal';

export const HEADLESS_SOAP_AUTHORIZATION_PROOF_TTL_MS = 30_000;
declare const proofDependentRegistrationIdentity: unique symbol;
export type HeadlessSoapAuthorizationProofDependentRegistrationV1 =
    Readonly<{ readonly [proofDependentRegistrationIdentity]?: never }>;
export type HeadlessSoapAuthorizationProofLifecycleErrorCode = 'presentation_unavailable' | 'pin_unavailable'
    | 'proof_unavailable' | 'proof_expired' | 'lifecycle_unavailable';
export class HeadlessSoapAuthorizationProofLifecycleError extends Error {
    constructor(readonly code: HeadlessSoapAuthorizationProofLifecycleErrorCode) {
        super(`Headless SOAP authorization proof rejected: ${code}`); this.name = 'HeadlessSoapAuthorizationProofLifecycleError';
    }
}
type PresentationLifecyclePort = Readonly<{
    withCurrentPresentation(candidate: unknown, operation: () => void): Promise<boolean>;
    registerDependent(candidate: unknown, dispose: () => void): unknown | null;
    confirmDependent(candidate: unknown, registration: unknown): boolean;
    unregisterDependent(candidate: unknown, registration: unknown): boolean;
    withCurrentDependent(candidate: unknown, registration: unknown, operation: () => void): Promise<boolean>;
}>;
type PresentationBindingPort = Readonly<{
    withCurrentDependentBinding(candidate: unknown, registration: unknown,
        operation: (binding: HeadlessSoapEntryPresentationBindingV1,
            sealBundle: ClinicianSoapEntrySealV1) => void): Promise<boolean>;
}>;
export type HeadlessSoapAuthorizationProofLifecycleSources = Readonly<{
    presentationLifecycle: PresentationLifecyclePort;
    presentationBinding?: PresentationBindingPort;
    presentationService: Readonly<{ cancel(candidate: unknown): boolean }>;
    verifyFreshPin(candidate: unknown): Promise<unknown>;
    entropy(): unknown;
    now(): number;
    schedule(dispose: () => void, delayMs: number): unknown;
    cancelSchedule(handle: unknown): void;
}>;
export type HeadlessSoapAuthorizationProofIssueResultV1 = Readonly<{
    status: 'proof_issued'; authorizationProof: string;
}>;
export type HeadlessSoapAuthorizationProofLifecycleServiceV1 = Readonly<{
    issue(correlationToken: unknown, candidatePin: unknown): Promise<HeadlessSoapAuthorizationProofIssueResultV1>;
    wipe(authorizationProof: unknown): boolean;
}>;
export type HeadlessSoapAuthorizationProofLifecycleControllerV1 = Readonly<{
    withCurrentProof(candidate: unknown, operation: () => void): Promise<boolean>;
    registerDependent(candidate: unknown, dispose: () => void): HeadlessSoapAuthorizationProofDependentRegistrationV1 | null;
    confirmDependent(candidate: unknown, registration: unknown): boolean;
    unregisterDependent(candidate: unknown, registration: unknown): boolean;
    withCurrentDependent(candidate: unknown, registration: unknown, operation: () => void): Promise<boolean>;
    withSingleUseProof(candidate: unknown, operation: () => void): Promise<boolean>;
}>;
export type HeadlessSoapAuthorizationProofBindingControllerV1 = Readonly<{
    withCurrentDependentBinding(candidate: unknown, registration: unknown,
        operation: (lineage: HeadlessSoapAuthorizationLineageV1,
            sealBundle: ClinicianSoapEntrySealV1) => void): Promise<boolean>;
    withSingleUseDependentBinding(candidate: unknown, registration: unknown,
        operation: (lineage: HeadlessSoapAuthorizationLineageV1,
            sealBundle: ClinicianSoapEntrySealV1) => void): Promise<boolean>;
}>;
type State = 'minted' | 'in_flight' | 'spent';
type ProofRecord = { active: boolean; state: State; digest: string; token: unknown; presentationRegistration: unknown;
    expiresAt: number; lastObservedAt: number; scheduled: boolean; scheduleHandle: unknown; dependent: DependentRecord | null;
    dependentClaimed: boolean; upstreamGone: boolean; cleaned: boolean; pendingDrain: DependentRecord | null;
    verifiedSession: HeadlessSoapFreshPinVerificationV1 | null };
type DependentRecord = { active: boolean; owner: ProofRecord; registration: HeadlessSoapAuthorizationProofDependentRegistrationV1;
    dispose: () => void };
type Operation = { record: ProofRecord; poisoned: boolean; callbackActive: boolean; timeFailure: HeadlessSoapAuthorizationProofLifecycleErrorCode | null };
const objectCreate = Object.create, objectAssign = Object.assign, objectFreeze = Object.freeze;
const objectGetPrototypeOf = Object.getPrototypeOf, numberIsSafeInteger = Number.isSafeInteger;
const maxSafeInteger = Number.MAX_SAFE_INTEGER;
const mapGet = Map.prototype.get, mapSet = Map.prototype.set, mapDelete = Map.prototype.delete;
const setAdd = Set.prototype.add, setHas = Set.prototype.has;
const weakMapGet = WeakMap.prototype.get, weakMapSet = WeakMap.prototype.set, weakMapDelete = WeakMap.prototype.delete;
const apply = Reflect.apply, functionPrototype = Function.prototype, promiseThen = Promise.prototype.then;
const isAsyncFunction = types.isAsyncFunction, isGeneratorFunction = types.isGeneratorFunction, isPromise = types.isPromise, isProxy = types.isProxy;
function fail(code: HeadlessSoapAuthorizationProofLifecycleErrorCode): never { throw new HeadlessSoapAuthorizationProofLifecycleError(code); }
function opaque(): Readonly<Record<never, never>> { return objectFreeze(objectCreate(null)) as Readonly<Record<never, never>>; }
function result(authorizationProof: string): HeadlessSoapAuthorizationProofIssueResultV1 {
    return objectFreeze(objectAssign(objectCreate(null), { status: 'proof_issued', authorizationProof }));
}
function synchronous(value: unknown): value is (...args: never[]) => void { return typeof value === 'function' && !isProxy(value)
    && !isAsyncFunction(value) && !isGeneratorFunction(value) && objectGetPrototypeOf(value) === functionPrototype; }
function callbackSucceeded(callback: (...args: never[]) => void, args: unknown[] = []): boolean { try { const value = apply(callback, undefined, args); if (value === undefined) return true;
        if (isPromise(value)) try { apply(promiseThen, value, [undefined, () => undefined]); } catch { /* denial remains local */ }
    } catch { /* fixed false below */ } return false; }

/** Owns the process-local H5b fresh-PIN proof lifecycle without write authority. */
export function createHeadlessSoapAuthorizationProofLifecycleOwner(sources: HeadlessSoapAuthorizationProofLifecycleSources): Readonly<{
    service: HeadlessSoapAuthorizationProofLifecycleServiceV1;
    lifecycleController: HeadlessSoapAuthorizationProofLifecycleControllerV1;
    bindingController: HeadlessSoapAuthorizationProofBindingControllerV1;
}> {
    const proofs = new Map<string, ProofRecord>(), tombstones = new Set<string>();
    const registrations = new WeakMap<object, DependentRecord>(); let operation: Operation | null = null, drainActive = false;
    const presentationCurrent = (token: unknown, registration: unknown): boolean => {
        try { return sources.presentationLifecycle.confirmDependent(token, registration) === true; } catch { return false; } };
    const proofFor = (candidate: unknown): ProofRecord | null => { const digest = digestHeadlessSoapAuthorizationProof(candidate);
        if (!digest) return null; const record = apply(mapGet, proofs, [digest]) as ProofRecord | undefined;
        return record?.active && record.digest === digest ? record : null; };
    const dependentFor = (record: ProofRecord, candidate: unknown): DependentRecord | null => {
        if (typeof candidate !== 'object' || candidate === null || isProxy(candidate)) return null;
        const dependent = apply(weakMapGet, registrations, [candidate]) as DependentRecord | undefined;
        return dependent?.active && dependent.owner === record && dependent.registration === candidate ? dependent : null; };
    const cancelTimer = (record: ProofRecord): void => { if (!record.scheduled) return; record.scheduled = false;
        const handle = record.scheduleHandle; record.scheduleHandle = null; try { sources.cancelSchedule(handle); } catch { /* spent wins */ } };
    const snapshotDependent = (record: ProofRecord): DependentRecord | null => { const dependent = record.dependent;
        record.dependent = null; if (!dependent) return null; dependent.active = false;
        apply(weakMapDelete, registrations, [dependent.registration]); return dependent; };
    const drain = (dependent: DependentRecord | null): void => { if (!dependent) return; const previous = drainActive; drainActive = true;
        try { const value = apply(dependent.dispose, undefined, []); if (isPromise(value)) try {
            apply(promiseThen, value, [undefined, () => undefined]); } catch { /* observed */ } } catch { /* contained */ }
        drainActive = previous; };
    const cleanup = (record: ProofRecord): void => { if (record.cleaned || operation?.record === record) return; record.cleaned = true;
        if (!record.upstreamGone) { try { sources.presentationLifecycle.unregisterDependent(record.token, record.presentationRegistration); } catch { /* local state won */ }
            try { sources.presentationService.cancel(record.token); } catch { /* local state won */ } }
        record.presentationRegistration = null; record.token = null; record.verifiedSession = null;
        const pending = record.pendingDrain; record.pendingDrain = null; drain(pending); };
    const retire = (record: ProofRecord, upstream = false): boolean => { const changed = record.active;
        record.upstreamGone ||= upstream; if (changed) { record.active = false; record.state = 'spent';
            if ((apply(mapGet, proofs, [record.digest]) as ProofRecord | undefined) === record) apply(mapDelete, proofs, [record.digest]);
            cancelTimer(record); record.pendingDrain = snapshotDependent(record); } cleanup(record); return changed; };
    const readTime = (record: ProofRecord): HeadlessSoapAuthorizationProofLifecycleErrorCode | null => { let observed: unknown;
        try { observed = sources.now(); } catch { return 'lifecycle_unavailable'; }
        if (!numberIsSafeInteger(observed) || (observed as number) < 0 || (observed as number) < record.lastObservedAt) return 'lifecycle_unavailable';
        record.lastObservedAt = observed as number; return (observed as number) >= record.expiresAt ? 'proof_expired' : null; };
    const arm = (record: ProofRecord, delayMs: number): boolean => { let arming = true, fired = false, handle: unknown;
        const callback = () => { if (arming) { fired = true; return; } if (!record.active || !record.scheduled || record.scheduleHandle !== handle) return;
            record.scheduled = false; record.scheduleHandle = null; const denied = readTime(record);
            if (denied) { retire(record); return; } if (!arm(record, record.expiresAt - record.lastObservedAt)) retire(record); };
        try { handle = sources.schedule(callback, delayMs); } catch { arming = false; return false; } arming = false;
        if (fired) { try { sources.cancelSchedule(handle); } catch { /* unpublished */ } return false; }
        record.scheduleHandle = handle; record.scheduled = true; return true; };
    const rejectReentry = (record: ProofRecord | null): boolean => { if (!operation && !drainActive) return false;
        if (operation) operation.poisoned = true; if (record) retire(record); return true; };
    const abortIssue = (token: unknown, registration: unknown, code: HeadlessSoapAuthorizationProofLifecycleErrorCode): never => {
        try { sources.presentationLifecycle.unregisterDependent(token, registration); } catch { /* cancel remains */ }
        try { sources.presentationService.cancel(token); } catch { /* denial remains */ } return fail(code); };
    const materializeLineage = (record: ProofRecord,
        binding: HeadlessSoapEntryPresentationBindingV1): HeadlessSoapAuthorizationLineageV1 | null => {
        const webSession = record.verifiedSession; if (!webSession) return null;
        const candidate = objectCreate(null) as Record<string, unknown>;
        candidate.schema = HEADLESS_SOAP_AUTHORIZATION_LINEAGE_SCHEMA;
        candidate.operationId = 'mediflow.clinical_diary.append_soap.v1';
        candidate.webSession = webSession;
        candidate.activeRole = binding.activeRole;
        candidate.childLease = binding.childLease;
        candidate.selection = binding.selection;
        candidate.patientVersion = binding.patientVersion;
        candidate.action = 'append';
        candidate.purpose = 'clinician_requested_documentation';
        candidate.proposal = binding.proposal;
        candidate.entryIdentity = binding.entryIdentity;
        candidate.payloadDigest = binding.payloadDigest;
        candidate.sealDigest = binding.sealDigest;
        candidate.policyDigest = HEADLESS_SOAP_AUTHORIZATION_POLICY_DIGEST;
        return createHeadlessSoapAuthorizationLineage(objectFreeze(candidate));
    };
    const issue = async (token: unknown, candidatePin: unknown): Promise<HeadlessSoapAuthorizationProofIssueResultV1> => {
        if (rejectReentry(null)) return fail('lifecycle_unavailable'); let record: ProofRecord | null = null, upstreamGone = false;
        let registration: unknown = null; try { registration = sources.presentationLifecycle.registerDependent(token, () => {
            upstreamGone = true; if (record) retire(record, true); }); } catch { registration = null; }
        if (registration === null) return fail('presentation_unavailable');
        if (!presentationCurrent(token, registration)) return abortIssue(token, registration, 'presentation_unavailable');
        if (upstreamGone) return abortIssue(token, registration, 'presentation_unavailable');
        if (typeof candidatePin !== 'string' || candidatePin.length < 4 || candidatePin.length > 8) return abortIssue(token, registration, 'pin_unavailable');
        let pinVerification: unknown = null; try { pinVerification = await sources.verifyFreshPin(candidatePin); } catch { pinVerification = null; }
        if (upstreamGone) return fail('presentation_unavailable');
        if (!isHeadlessSoapFreshPinVerificationV1(pinVerification)) return abortIssue(token, registration, 'pin_unavailable');
        let minted: ReturnType<typeof createHeadlessSoapAuthorizationProofToken> = null;
        try { minted = createHeadlessSoapAuthorizationProofToken(sources.entropy()); } catch { minted = null; }
        if (!minted) return abortIssue(token, registration, 'proof_unavailable');
        if (apply(setHas, tombstones, [minted.digest])) return abortIssue(token, registration, 'proof_unavailable');
        let current = false; try { current = await sources.presentationLifecycle.withCurrentDependent(token, registration, () => undefined); } catch { current = false; }
        if (!current || upstreamGone || !presentationCurrent(token, registration)) return abortIssue(token, registration, 'presentation_unavailable');
        apply(setAdd, tombstones, [minted.digest]); let observed: unknown; try { observed = sources.now(); } catch { observed = null; }
        if (!numberIsSafeInteger(observed) || (observed as number) < 0
            || (observed as number) > maxSafeInteger - HEADLESS_SOAP_AUTHORIZATION_PROOF_TTL_MS) return abortIssue(token, registration, 'lifecycle_unavailable');
        record = { active: true, state: 'minted', digest: minted.digest, token, presentationRegistration: registration,
            expiresAt: (observed as number) + HEADLESS_SOAP_AUTHORIZATION_PROOF_TTL_MS, lastObservedAt: observed as number,
            scheduled: false, scheduleHandle: null, dependent: null, dependentClaimed: false, upstreamGone: false, cleaned: false,
            pendingDrain: null, verifiedSession: pinVerification };
        if (!arm(record, HEADLESS_SOAP_AUTHORIZATION_PROOF_TTL_MS)) { retire(record); return fail('lifecycle_unavailable'); }
        if (upstreamGone || !record.active) { retire(record, upstreamGone); return fail('presentation_unavailable'); }
        apply(mapSet, proofs, [minted.digest, record]); return result(minted.authorizationProof);
    };
    const run = async (candidate: unknown, registration: unknown, callback: () => void, requiresDependent: boolean, singleUse: boolean): Promise<boolean> => {
        const record = proofFor(candidate); if (!record || rejectReentry(record) || record.state !== 'minted') return false;
        const dependent = requiresDependent ? dependentFor(record, registration) : null; if (requiresDependent && !dependent) return false;
        if (!synchronous(callback)) { retire(record); return false; }
        const currentOperation: Operation = { record, poisoned: false, callbackActive: false, timeFailure: null };
        operation = currentOperation; let invoked = false, accepted = false, upstreamCurrent = false;
        try { upstreamCurrent = await sources.presentationLifecycle.withCurrentDependent(record.token, record.presentationRegistration, () => {
            if (operation !== currentOperation || invoked || currentOperation.callbackActive || !record.active || record.state !== 'minted'
                || (requiresDependent && dependentFor(record, registration) !== dependent)) { currentOperation.poisoned = true; retire(record); return; }
            currentOperation.timeFailure = readTime(record); if (currentOperation.timeFailure) return;
            if (operation !== currentOperation || currentOperation.poisoned || !record.active || record.state !== 'minted'
                || (requiresDependent && dependentFor(record, registration) !== dependent)) {
                currentOperation.poisoned = true; retire(record); return;
            }
            if (singleUse) record.state = 'in_flight'; currentOperation.callbackActive = true; invoked = true; accepted = callbackSucceeded(callback);
            currentOperation.callbackActive = false; const after = readTime(record); if (after) currentOperation.timeFailure = after;
            if (singleUse) retire(record); }); } catch { upstreamCurrent = false; }
        finally { currentOperation.callbackActive = false; operation = null; }
        if (singleUse) {
            const finalTime = readTime(record), finalCurrent = upstreamCurrent && !record.upstreamGone;
            retire(record); cleanup(record);
            if (currentOperation.timeFailure) return fail(currentOperation.timeFailure);
            if (finalCurrent && finalTime) return fail(finalTime);
            return !currentOperation.poisoned && invoked && accepted && finalCurrent;
        }
        if (currentOperation.poisoned) { retire(record); return false; }
        if (currentOperation.timeFailure) { retire(record); return fail(currentOperation.timeFailure); }
        if (!invoked || !accepted) { retire(record); return false; }
        const finalTime = readTime(record); if (finalTime) { retire(record); return fail(finalTime); }
        if (!upstreamCurrent || record.upstreamGone || !record.active) { retire(record); return fail('presentation_unavailable'); }
        const finalCurrent = presentationCurrent(record.token, record.presentationRegistration)
            && (!requiresDependent || dependentFor(record, registration) === dependent);
        if (!finalCurrent) { retire(record); return fail('presentation_unavailable'); } return true;
    };
    const runBinding = async (candidate: unknown, registration: unknown,
        callback: (lineage: HeadlessSoapAuthorizationLineageV1, sealBundle: ClinicianSoapEntrySealV1) => void,
        singleUse: boolean): Promise<boolean> => {
        const record = proofFor(candidate); if (!record || rejectReentry(record) || record.state !== 'minted') return false;
        const dependent = dependentFor(record, registration); if (!dependent) return false;
        if (!sources.presentationBinding || !synchronous(callback)) { retire(record); return false; }
        const currentOperation: Operation = { record, poisoned: false, callbackActive: false, timeFailure: null };
        operation = currentOperation; let invoked = false, accepted = false, upstreamCurrent = false;
        try {
            upstreamCurrent = await sources.presentationBinding.withCurrentDependentBinding(
                record.token,
                record.presentationRegistration,
                (binding, sealBundle) => {
                    if (operation !== currentOperation || invoked || currentOperation.callbackActive
                        || !record.active || record.state !== 'minted'
                        || dependentFor(record, registration) !== dependent) {
                        currentOperation.poisoned = true; retire(record); return;
                    }
                    currentOperation.timeFailure = readTime(record); if (currentOperation.timeFailure) return;
                    const lineage = materializeLineage(record, binding);
                    if (!lineage || operation !== currentOperation || currentOperation.poisoned
                        || !record.active || record.state !== 'minted'
                        || dependentFor(record, registration) !== dependent) {
                        currentOperation.poisoned = true; retire(record); return;
                    }
                    if (singleUse) record.state = 'in_flight';
                    currentOperation.callbackActive = true; invoked = true;
                    accepted = callbackSucceeded(callback as (...args: never[]) => void, [lineage, sealBundle]);
                    currentOperation.callbackActive = false;
                    const after = readTime(record); if (after) currentOperation.timeFailure = after;
                    if (singleUse) retire(record);
                },
            );
        } catch { upstreamCurrent = false; }
        finally { currentOperation.callbackActive = false; operation = null; }
        if (singleUse) {
            const finalTime = readTime(record), finalCurrent = upstreamCurrent && !record.upstreamGone;
            retire(record); cleanup(record);
            if (currentOperation.timeFailure) return fail(currentOperation.timeFailure);
            if (finalCurrent && finalTime) return fail(finalTime);
            return !currentOperation.poisoned && invoked && accepted && finalCurrent;
        }
        if (currentOperation.poisoned) { retire(record); return false; }
        if (currentOperation.timeFailure) { retire(record); return fail(currentOperation.timeFailure); }
        if (!invoked || !accepted) { retire(record); return false; }
        const finalTime = readTime(record); if (finalTime) { retire(record); return fail(finalTime); }
        if (!upstreamCurrent || record.upstreamGone || !record.active) { retire(record); return fail('presentation_unavailable'); }
        const finalCurrent = presentationCurrent(record.token, record.presentationRegistration)
            && dependentFor(record, registration) === dependent;
        if (!finalCurrent) { retire(record); return fail('presentation_unavailable'); }
        return true;
    };
    const service: HeadlessSoapAuthorizationProofLifecycleServiceV1 = objectFreeze({ issue,
        wipe(candidate: unknown): boolean { const record = proofFor(candidate); if (!record || rejectReentry(record)) return false; return retire(record); } });
    const lifecycleController: HeadlessSoapAuthorizationProofLifecycleControllerV1 = objectFreeze({
        withCurrentProof(candidate: unknown, callback: () => void) { return run(candidate, null, callback, false, false); },
        registerDependent(candidate: unknown, dispose: () => void) { const record = proofFor(candidate);
            if (!record || rejectReentry(record) || record.state !== 'minted' || record.dependentClaimed || !synchronous(dispose)) return null;
            if (!presentationCurrent(record.token, record.presentationRegistration) || readTime(record)) { retire(record); return null; }
            const registration = opaque() as HeadlessSoapAuthorizationProofDependentRegistrationV1;
            const dependent: DependentRecord = { active: true, owner: record, registration, dispose };
            record.dependentClaimed = true; record.dependent = dependent; apply(weakMapSet, registrations, [registration, dependent]); return registration; },
        confirmDependent(candidate: unknown, registration: unknown): boolean { const record = proofFor(candidate);
            if (!record || rejectReentry(record) || record.state !== 'minted') return false; const dependent = dependentFor(record, registration);
            if (!dependent || !presentationCurrent(record.token, record.presentationRegistration) || readTime(record)) { if (dependent) retire(record); return false; } return true; },
        unregisterDependent(candidate: unknown, registration: unknown): boolean { const record = proofFor(candidate);
            if (!record || rejectReentry(record) || record.state !== 'minted') return false; const dependent = dependentFor(record, registration); if (!dependent) return false;
            dependent.active = false; record.dependent = null; apply(weakMapDelete, registrations, [dependent.registration]); return true; },
        withCurrentDependent(candidate: unknown, registration: unknown, callback: () => void) { return run(candidate, registration, callback, true, false); },
        withSingleUseProof(candidate: unknown, callback: () => void) { return run(candidate, null, callback, false, true); },
    });
    const bindingController: HeadlessSoapAuthorizationProofBindingControllerV1 = objectFreeze({
        withCurrentDependentBinding(candidate: unknown, registration: unknown,
            callback: (lineage: HeadlessSoapAuthorizationLineageV1, sealBundle: ClinicianSoapEntrySealV1) => void) {
            return runBinding(candidate, registration, callback, false);
        },
        withSingleUseDependentBinding(candidate: unknown, registration: unknown,
            callback: (lineage: HeadlessSoapAuthorizationLineageV1, sealBundle: ClinicianSoapEntrySealV1) => void) {
            return runBinding(candidate, registration, callback, true);
        },
    });
    return objectFreeze({ service, lifecycleController, bindingController });
}
