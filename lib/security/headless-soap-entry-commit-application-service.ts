/* @Codex */
import 'server-only';

import { types } from 'node:util';

import {
    parseHeadlessSoapCommandEnvelope,
    type HeadlessSoapCommandEnvelopeV1,
} from './headless-soap-command-envelope';
import type {
    HeadlessSoapApprovalControllerV1,
    HeadlessSoapBoundCommandV1,
} from './headless-soap-command-binding-lifecycle';
import type {
    ServerSessionSelectionCommitBindingControllerV1,
    ServerSessionSelectionCommitBindingV1,
    ServerSessionSelectionCommitExpectedV1,
} from './server-session-projection-owner';

export type HeadlessSoapEntryCommitErrorCode = 'envelope_unavailable' | 'approval_unavailable'
    | 'binding_unavailable' | 'idempotency_conflict' | 'receipt_unavailable'
    | 'storage_unavailable' | 'lifecycle_unavailable';
export class HeadlessSoapEntryCommitError extends Error {
    constructor(readonly code: HeadlessSoapEntryCommitErrorCode) {
        super(`Headless SOAP entry commit rejected: ${code}`);
        this.name = 'HeadlessSoapEntryCommitError';
    }
}
export type HeadlessSoapEntryCommitOwnerErrorCode = 'receipt_unavailable' | 'storage_unavailable';
export class HeadlessSoapEntryCommitOwnerError extends Error {
    constructor(readonly code: HeadlessSoapEntryCommitOwnerErrorCode) {
        super(`Headless SOAP entry commit owner rejected: ${code}`);
        this.name = 'HeadlessSoapEntryCommitOwnerError';
    }
}

export type HeadlessSoapEntryReplayKeyV1 = Readonly<{
    approvalRef: string;
    idempotencyKey: string;
    authorizationProofDigest: string;
}>;
export type HeadlessSoapSelectionCommitExpectedV1 = ServerSessionSelectionCommitExpectedV1;
export type HeadlessSoapSelectionCommitBindingV1 = ServerSessionSelectionCommitBindingV1;
export type HeadlessSoapEntryCommitResultV1<Receipt extends object> = Readonly<{
    status: 'entry_committed';
    receipt: Receipt;
}>;

export type HeadlessSoapEntryCommitPortDenialCode = 'binding_unavailable' | 'idempotency_conflict'
    | 'receipt_unavailable' | 'storage_unavailable' | 'lifecycle_unavailable';
export type HeadlessSoapEntryCommitLookupResultV1<Receipt extends object> = Readonly<{ status: 'missing' }>
    | Readonly<{ status: 'conflict' }> | Readonly<{ status: 'exact'; receipt: Receipt }>;
export type HeadlessSoapEntryCommitPortResultV1<Receipt extends object> = Readonly<{
    status: 'committed'; receipt: Receipt;
}> | Readonly<{ status: 'denied'; code: HeadlessSoapEntryCommitPortDenialCode }>;
export type HeadlessSoapEntryCommitOwnerV1<Receipt extends object> = Readonly<{
    snapshotReceipt(candidate: unknown): Receipt | null;
    lookup(key: HeadlessSoapEntryReplayKeyV1): HeadlessSoapEntryCommitLookupResultV1<Receipt>;
    commit(command: HeadlessSoapBoundCommandV1,
        binding: ServerSessionSelectionCommitBindingV1): HeadlessSoapEntryCommitPortResultV1<Receipt>;
}>;
export type HeadlessSoapEntryCommitApplicationSources<Receipt extends object> = Readonly<{
    approvalController: HeadlessSoapApprovalControllerV1;
    selectionController: ServerSessionSelectionCommitBindingControllerV1;
    commitOwner: HeadlessSoapEntryCommitOwnerV1<Receipt>;
}>;
export type HeadlessSoapEntryCommitApplicationServiceV1<Receipt extends object> = Readonly<{
    execute(envelope: unknown): Promise<HeadlessSoapEntryCommitResultV1<Receipt>>;
}>;

type ReplayOutcome<Receipt extends object> = Readonly<{ status: 'missing' | 'conflict'; receipt: null }>
    | Readonly<{ status: 'exact'; receipt: Receipt }>;
type CommitOutcome<Receipt extends object> = Readonly<{ receipt: Receipt | null;
    denial: HeadlessSoapEntryCommitErrorCode | null }>;

const COMMAND_KEYS = ['schema', 'commandId', 'approvalRef', 'idempotencyKey', 'authorizationProofDigest',
    'lineage', 'sealBundle'] as const;
const LOOKUP_STATUS_KEYS = ['status'] as const;
const LOOKUP_EXACT_KEYS = ['status', 'receipt'] as const;
const COMMIT_DENIED_KEYS = ['status', 'code'] as const;
const COMMAND_ID = /^hsac_[0-9a-f]{64}$/u;
const SESSION_ID = /^[0-9a-f]{64}$/u;
const SESSION_REF = /^ssr_[0-9a-f]{32}$/u;
const PATIENT_REF = /^ptr_[0-9a-f]{32}$/u;
const AMBULATORY_REF = /^abr_[0-9a-f]{32}$/u;
const LEASE_REF = /^lsr_[0-9a-f]{32}$/u;
const H7B_DENIALS = new Set<HeadlessSoapEntryCommitErrorCode>([
    'binding_unavailable', 'idempotency_conflict', 'receipt_unavailable',
    'storage_unavailable', 'lifecycle_unavailable',
]);
const objectAssign = Object.assign;
const objectCreate = Object.create;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectIsFrozen = Object.isFrozen;
const objectPrototype = Object.prototype;
const reflectOwnKeys = Reflect.ownKeys;
const reflectApply = Reflect.apply;
const regexpTest = RegExp.prototype.test;
const numberIsSafeInteger = Number.isSafeInteger;
const stringTrim = String.prototype.trim;
const promisePrototype = Promise.prototype;
const promiseThen = Promise.prototype.then;
const promiseConstructor = Promise;
const promiseConstructorDescriptor = objectGetOwnPropertyDescriptor(promisePrototype, 'constructor');
const promiseThenDescriptor = objectGetOwnPropertyDescriptor(promisePrototype, 'then');
const setHas = Set.prototype.has;
const isPromise = types.isPromise;
const isProxy = types.isProxy;

function fail(code: HeadlessSoapEntryCommitErrorCode): never {
    throw new HeadlessSoapEntryCommitError(code);
}

function record<T extends object>(value: T): Readonly<T> {
    return objectFreeze(objectAssign(objectCreate(null), value)) as Readonly<T>;
}

function exact(value: unknown, keys: readonly PropertyKey[]): Record<PropertyKey, unknown> | null {
    try {
        if (typeof value !== 'object' || value === null || isProxy(value)
            || objectGetPrototypeOf(value) !== null || !objectIsFrozen(value)) return null;
        const actual = reflectOwnKeys(value);
        if (actual.length !== keys.length) return null;
        const output = objectCreate(null) as Record<PropertyKey, unknown>;
        for (let index = 0; index < keys.length; index += 1) {
            const key = keys[index]!;
            if (actual[index] !== key) return null;
            const descriptor = objectGetOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)
                || descriptor.configurable || descriptor.writable) return null;
            output[key] = descriptor.value;
        }
        return output;
    } catch { return null; }
}

function canonicalRecord(value: unknown): value is object {
    try {
        if (typeof value !== 'object' || value === null || isProxy(value)
            || objectGetPrototypeOf(value) !== null || !objectIsFrozen(value)) return false;
        const keys = reflectOwnKeys(value);
        if (keys.length === 0) return false;
        for (let index = 0; index < keys.length; index += 1) {
            const descriptor = objectGetOwnPropertyDescriptor(value, keys[index]!);
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)
                || descriptor.configurable || descriptor.writable) return false;
        }
        return true;
    } catch { return false; }
}

function ambientThenSafe(): boolean {
    try {
        const constructor = objectGetOwnPropertyDescriptor(promisePrototype, 'constructor');
        const then = objectGetOwnPropertyDescriptor(promisePrototype, 'then');
        return objectGetOwnPropertyDescriptor(objectPrototype, 'then') === undefined
            && !!constructor && !!promiseConstructorDescriptor && 'value' in constructor
            && 'value' in promiseConstructorDescriptor && constructor.value === promiseConstructor
            && constructor.enumerable === promiseConstructorDescriptor.enumerable
            && constructor.configurable === promiseConstructorDescriptor.configurable
            && constructor.writable === promiseConstructorDescriptor.writable
            && !!then && !!promiseThenDescriptor && 'value' in then && 'value' in promiseThenDescriptor
            && then.value === promiseThen && then.enumerable === promiseThenDescriptor.enumerable
            && then.configurable === promiseThenDescriptor.configurable
            && then.writable === promiseThenDescriptor.writable;
    } catch { return false; }
}

function authenticPromise(value: unknown): value is Promise<unknown> {
    try {
        return typeof value === 'object' && value !== null && !isProxy(value) && isPromise(value);
    } catch { return false; }
}

function exactNativePromise(value: unknown): value is Promise<unknown> {
    if (!authenticPromise(value)) return false;
    try {
        if (objectGetPrototypeOf(value) !== promisePrototype) return false;
        const keys = reflectOwnKeys(value);
        for (let index = 0; index < keys.length; index += 1) if (typeof keys[index] === 'string') return false;
        return true;
    } catch { return false; }
}

function discardPromise(value: unknown): boolean {
    if (!authenticPromise(value)) return false;
    try { reflectApply(promiseThen, value, [() => undefined, () => undefined]); } catch { /* denial remains local */ }
    return true;
}

function receipt<Receipt extends object>(owner: HeadlessSoapEntryCommitOwnerV1<Receipt>, candidate: unknown): Receipt {
    let snapshot: Receipt | null = null;
    try { snapshot = owner.snapshotReceipt(candidate); } catch { return fail('receipt_unavailable'); }
    if (discardPromise(snapshot)) return fail('receipt_unavailable');
    return snapshot && canonicalRecord(snapshot) ? snapshot : fail('receipt_unavailable');
}

function replay<Receipt extends object>(owner: HeadlessSoapEntryCommitOwnerV1<Receipt>, key: HeadlessSoapEntryReplayKeyV1): ReplayOutcome<Receipt> {
    let candidate: unknown;
    try { candidate = owner.lookup(key); } catch (error) {
        if (error instanceof HeadlessSoapEntryCommitOwnerError
            && (error.code === 'receipt_unavailable' || error.code === 'storage_unavailable')) return fail(error.code);
        return fail('storage_unavailable');
    }
    if (discardPromise(candidate)) return fail('lifecycle_unavailable');
    const status = exact(candidate, LOOKUP_STATUS_KEYS);
    if (status?.status === 'missing' || status?.status === 'conflict') {
        return record({ status: status.status, receipt: null }) as ReplayOutcome<Receipt>;
    }
    const exactReplay = exact(candidate, LOOKUP_EXACT_KEYS);
    if (exactReplay?.status !== 'exact') return fail('lifecycle_unavailable');
    return record({ status: 'exact' as const, receipt: receipt(owner, exactReplay.receipt) });
}

function commitOutcome<Receipt extends object>(owner: HeadlessSoapEntryCommitOwnerV1<Receipt>, command: HeadlessSoapBoundCommandV1,
    binding: HeadlessSoapSelectionCommitBindingV1): CommitOutcome<Receipt> {
    let candidate: unknown;
    try { candidate = owner.commit(command, binding); } catch { return record({ receipt: null, denial: 'storage_unavailable' }); }
    if (discardPromise(candidate)) return record({ receipt: null, denial: 'lifecycle_unavailable' });
    const committed = exact(candidate, LOOKUP_EXACT_KEYS);
    if (committed?.status === 'committed') {
        try { return record({ receipt: receipt(owner, committed.receipt), denial: null }); }
        catch (error) { return record({ receipt: null, denial: error instanceof HeadlessSoapEntryCommitError
            ? error.code : 'receipt_unavailable' }); }
    }
    const denied = exact(candidate, COMMIT_DENIED_KEYS);
    if (denied?.status !== 'denied' || typeof denied.code !== 'string'
        || !reflectApply(setHas, H7B_DENIALS, [denied.code as HeadlessSoapEntryCommitErrorCode])) {
        return record({ receipt: null, denial: 'lifecycle_unavailable' });
    }
    return record({ receipt: null, denial: denied.code as HeadlessSoapEntryCommitErrorCode });
}

function commitBinding(value: unknown, expectedPatientVersion: number): HeadlessSoapSelectionCommitBindingV1 | null {
    const binding = exact(value, ['patientId', 'ambulatoryId', 'patientVersion']);
    if (!binding || typeof binding.patientId !== 'string' || binding.patientId.length === 0
        || binding.patientId.length > 256 || reflectApply(stringTrim, binding.patientId, []) !== binding.patientId
        || typeof binding.ambulatoryId !== 'string' || binding.ambulatoryId.length === 0
        || binding.ambulatoryId.length > 256 || reflectApply(stringTrim, binding.ambulatoryId, []) !== binding.ambulatoryId
        || binding.patientVersion !== expectedPatientVersion) return null;
    return value as HeadlessSoapSelectionCommitBindingV1;
}

function expected(command: unknown, envelope: HeadlessSoapCommandEnvelopeV1,
    proofDigest: string): Readonly<{ command: HeadlessSoapBoundCommandV1; scopeIdentity: unknown;
        expected: HeadlessSoapSelectionCommitExpectedV1 }> | null {
    const value = exact(command, COMMAND_KEYS);
    if (!value || value.schema !== 'mediflow.headless.soap-bound-command.v1'
        || typeof value.commandId !== 'string' || !reflectApply(regexpTest, COMMAND_ID, [value.commandId])
        || value.approvalRef !== envelope.approvalRef || value.idempotencyKey !== envelope.idempotencyKey
        || value.authorizationProofDigest !== proofDigest) return null;
    try {
        const typed = command as HeadlessSoapBoundCommandV1;
        const lineage = typed.lineage;
        const selection = lineage.selection;
        if (!lineage || typeof lineage !== 'object' || !selection || typeof selection !== 'object'
            || typeof lineage.webSession.id !== 'string' || !reflectApply(regexpTest, SESSION_ID, [lineage.webSession.id])
            || typeof selection.sessionRef !== 'string' || !reflectApply(regexpTest, SESSION_REF, [selection.sessionRef])
            || typeof selection.patientRef !== 'string' || !reflectApply(regexpTest, PATIENT_REF, [selection.patientRef])
            || typeof selection.ambulatoryRef !== 'string' || !reflectApply(regexpTest, AMBULATORY_REF, [selection.ambulatoryRef])
            || typeof selection.leaseRef !== 'string' || !reflectApply(regexpTest, LEASE_REF, [selection.leaseRef])
            || !numberIsSafeInteger(selection.selectionEpoch) || selection.selectionEpoch < 1
            || !numberIsSafeInteger(lineage.patientVersion) || lineage.patientVersion < 1
            || typeof selection.scopeIdentity !== 'object' || selection.scopeIdentity === null || isProxy(selection.scopeIdentity)) return null;
        return record({ command: typed, scopeIdentity: selection.scopeIdentity, expected: record({
            webSessionId: lineage.webSession.id,
            sessionRef: selection.sessionRef,
            patientRef: selection.patientRef,
            ambulatoryRef: selection.ambulatoryRef,
            leaseRef: selection.leaseRef,
            selectionEpoch: selection.selectionEpoch,
            patientVersion: lineage.patientVersion,
        }) });
    } catch { return null; }
}

function result<Receipt extends object>(value: Receipt): HeadlessSoapEntryCommitResultV1<Receipt> {
    return record({ status: 'entry_committed' as const, receipt: value });
}

/** Orchestrates exact replay, H6 single use, selection currentness and one synchronous H7b commit. */
export function createHeadlessSoapEntryCommitApplicationService<Receipt extends object>(
    sources: HeadlessSoapEntryCommitApplicationSources<Receipt>,
): HeadlessSoapEntryCommitApplicationServiceV1<Receipt> {
    return record({
        async execute(candidate: unknown): Promise<HeadlessSoapEntryCommitResultV1<Receipt>> {
            const parsed = parseHeadlessSoapCommandEnvelope(candidate);
            if (!parsed) return fail('envelope_unavailable');
            const key = record({ approvalRef: parsed.envelope.approvalRef,
                idempotencyKey: parsed.envelope.idempotencyKey,
                authorizationProofDigest: parsed.authorizationProofDigest });
            const before = replay(sources.commitOwner, key);
            if (before.status === 'exact') return result(before.receipt);
            if (before.status === 'conflict') return fail('idempotency_conflict');

            let approvalInvoked = false, approvalDuplicated = false, approvalClosed = false;
            let selectionInvoked = false, selectionDuplicated = false, selectionClosed = false;
            let selectionCurrent: unknown = null;
            let capturedReceipt: Receipt | null = null;
            let capturedDenial: HeadlessSoapEntryCommitErrorCode | null = null;
            let approvalCurrent: unknown = null;
            let approvalFailure = false;
            const capture = (code: HeadlessSoapEntryCommitErrorCode): void => {
                if (!capturedDenial) capturedDenial = code;
            };
            const approvalOperation = (candidateCommand: HeadlessSoapBoundCommandV1): void => {
                if (approvalClosed || approvalInvoked) { approvalDuplicated = true; capture('lifecycle_unavailable'); return; }
                approvalInvoked = true;
                const resolved = expected(candidateCommand, parsed.envelope, parsed.authorizationProofDigest);
                if (!resolved) { capture('lifecycle_unavailable'); return; }
                try {
                    selectionCurrent = sources.selectionController.withCurrentCommitBinding(
                        resolved.scopeIdentity,
                        resolved.expected,
                        (candidateBinding) => {
                            if (selectionClosed || selectionInvoked) {
                                selectionDuplicated = true; capture('lifecycle_unavailable'); return;
                            }
                            selectionInvoked = true;
                            const binding = commitBinding(candidateBinding, resolved.expected.patientVersion);
                            if (!binding) { capture('lifecycle_unavailable'); return; }
                            const committed = commitOutcome(sources.commitOwner, resolved.command, binding);
                            capturedReceipt = committed.receipt;
                            if (committed.denial) capture(committed.denial);
                        },
                    );
                } catch { selectionCurrent = null; capture('lifecycle_unavailable'); }
                finally { selectionClosed = true; }
                if (discardPromise(selectionCurrent)) { selectionCurrent = null; capture('lifecycle_unavailable'); }
                else if (selectionCurrent === false || (!selectionInvoked && selectionCurrent === true)) {
                    capture(selectionCurrent === false ? 'binding_unavailable' : 'lifecycle_unavailable');
                } else if (selectionCurrent !== true) capture('lifecycle_unavailable');
            };
            let approvalPending: unknown = null;
            try {
                approvalPending = sources.approvalController.withSingleUseApproval(parsed.envelope, approvalOperation);
            } catch { approvalFailure = true; capture('lifecycle_unavailable'); }
            if (!approvalFailure) {
                if (!ambientThenSafe() || !exactNativePromise(approvalPending)) {
                    discardPromise(approvalPending); approvalFailure = true; capture('lifecycle_unavailable');
                } else {
                    try { approvalCurrent = await approvalPending; }
                    catch { approvalFailure = true; capture('lifecycle_unavailable'); }
                }
            }
            approvalClosed = true;

            const confirmed = approvalCurrent === true && !approvalFailure && approvalInvoked && !approvalDuplicated
                && selectionCurrent === true && selectionInvoked && !selectionDuplicated
                && capturedReceipt !== null && capturedDenial === null;
            if (confirmed) return result(capturedReceipt!);

            const after = replay(sources.commitOwner, key);
            if (after.status === 'exact') return result(after.receipt);
            if (after.status === 'conflict') return fail('idempotency_conflict');
            if (capturedDenial) return fail(capturedDenial);
            if (approvalCurrent === false && !approvalInvoked) return fail('approval_unavailable');
            if (approvalCurrent === false) return fail('approval_unavailable');
            return fail('lifecycle_unavailable');
        },
    });
}
