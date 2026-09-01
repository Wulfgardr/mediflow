/* @Codex */
import 'server-only';

import { types } from 'node:util';

import { parseSeal, type ParsedSeal } from '../headless/clinician-soap-entry-seal-codec-internal';
import { digestHeadlessSoapAuthorizationProof } from './headless-soap-authorization-proof-token';
import {
    createHeadlessSoapAuthorizationLineage,
    sameHeadlessSoapAuthorizationLineage,
    type HeadlessSoapAuthorizationLineageV1,
} from './headless-soap-authorization-lineage';
import {
    createHeadlessSoapCommandBindingIdentifiers,
} from './headless-soap-command-binding-identifiers';
import {
    parseHeadlessSoapCommandEnvelope,
} from './headless-soap-command-envelope';

export type { HeadlessSoapCommandEnvelopeV1 } from './headless-soap-command-envelope';

export type HeadlessSoapCommandBindingErrorCode = 'proof_unavailable' | 'proof_expired' | 'binding_unavailable'
    | 'approval_unavailable' | 'binding_changed' | 'lifecycle_unavailable';
export class HeadlessSoapCommandBindingError extends Error {
    constructor(readonly code: HeadlessSoapCommandBindingErrorCode) {
        super(`Headless SOAP command binding rejected: ${code}`);
        this.name = 'HeadlessSoapCommandBindingError';
    }
}
export type HeadlessSoapCommandBindingResultV1 = Readonly<{
    status: 'approval_bound';
    approvalRef: string;
    idempotencyKey: string;
}>;
export type HeadlessSoapBoundCommandV1 = Readonly<{
    schema: 'mediflow.headless.soap-bound-command.v1';
    commandId: string;
    approvalRef: string;
    idempotencyKey: string;
    authorizationProofDigest: string;
    lineage: HeadlessSoapAuthorizationLineageV1;
    sealBundle: ParsedSeal;
}>;
type ProofLifecyclePort = Readonly<{
    registerDependent(candidate: unknown, dispose: () => void): unknown | null;
    confirmDependent(candidate: unknown, registration: unknown): boolean;
    unregisterDependent(candidate: unknown, registration: unknown): boolean;
}>;
type ProofBindingPort = Readonly<{
    withCurrentDependentBinding(candidate: unknown, registration: unknown,
        operation: (lineage: unknown, sealBundle: unknown) => void): Promise<boolean>;
    withSingleUseDependentBinding(candidate: unknown, registration: unknown,
        operation: (lineage: unknown, sealBundle: unknown) => void): Promise<boolean>;
}>;
export type HeadlessSoapCommandBindingSources = Readonly<{
    proofLifecycle: ProofLifecyclePort;
    proofBinding: ProofBindingPort;
    proofService: Readonly<{ wipe(candidate: unknown): boolean }>;
    entropy(): unknown;
}>;
export type HeadlessSoapCommandBindingServiceV1 = Readonly<{
    bind(authorizationProof: unknown): Promise<HeadlessSoapCommandBindingResultV1>;
    wipe(approvalRef: unknown, authorizationProof: unknown): boolean;
}>;
export type HeadlessSoapApprovalControllerV1 = Readonly<{
    withSingleUseApproval(envelope: unknown, operation: (command: HeadlessSoapBoundCommandV1) => void): Promise<boolean>;
}>;
type BindingRecord = {
    active: boolean;
    state: 'bound' | 'in_flight' | 'spent';
    proofDigest: string;
    registration: unknown;
    commandId: string;
    approvalRef: string;
    idempotencyKey: string;
    lineage: HeadlessSoapAuthorizationLineageV1 | null;
    upstreamGone: boolean;
};

const objectAssign = Object.assign;
const objectCreate = Object.create;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const reflectApply = Reflect.apply;
const functionPrototype = Function.prototype;
const promiseThen = Promise.prototype.then;
const isAsyncFunction = types.isAsyncFunction;
const isGeneratorFunction = types.isGeneratorFunction;
const isPromise = types.isPromise;
const isProxy = types.isProxy;
const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;
const mapDelete = Map.prototype.delete;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;

function fail(code: HeadlessSoapCommandBindingErrorCode): never {
    throw new HeadlessSoapCommandBindingError(code);
}
function bindingDenial(error: unknown): HeadlessSoapCommandBindingErrorCode {
    try {
        if (typeof error !== 'object' || error === null || isProxy(error)) return 'binding_unavailable';
        const descriptor = objectGetOwnPropertyDescriptor(error, 'code');
        if (!descriptor || !('value' in descriptor)) return 'binding_unavailable';
        if (descriptor.value === 'proof_expired' || descriptor.value === 'lifecycle_unavailable') return descriptor.value;
    } catch { /* fixed fallback below */ }
    return 'binding_unavailable';
}
function result(approvalRef: string, idempotencyKey: string): HeadlessSoapCommandBindingResultV1 {
    return objectFreeze(objectAssign(objectCreate(null), { status: 'approval_bound' as const, approvalRef, idempotencyKey }));
}
function synchronous(value: unknown): value is (command: HeadlessSoapBoundCommandV1) => void {
    return typeof value === 'function' && !isProxy(value) && !isAsyncFunction(value) && !isGeneratorFunction(value)
        && objectGetPrototypeOf(value) === functionPrototype;
}
function invoke(operation: (command: HeadlessSoapBoundCommandV1) => void, command: HeadlessSoapBoundCommandV1): boolean {
    try {
        const value = reflectApply(operation, undefined, [command]);
        if (value === undefined) return true;
        if (isPromise(value)) try { reflectApply(promiseThen, value, [undefined, () => undefined]); } catch { /* denial */ }
    } catch { /* fixed false below */ }
    return false;
}
function sameBinding(lineage: HeadlessSoapAuthorizationLineageV1, seal: ParsedSeal): boolean {
    return lineage.payloadDigest.sha256.hex === seal.payloadDigest.sha256.hex
        && lineage.sealDigest.sha256.hex === seal.sealDigest.sha256.hex;
}

/** Owns the process-local H6 command binding without write authority. */
export function createHeadlessSoapCommandBindingOwner(sources: HeadlessSoapCommandBindingSources): Readonly<{
    service: HeadlessSoapCommandBindingServiceV1;
    approvalController: HeadlessSoapApprovalControllerV1;
}> {
    const approvals = new Map<string, BindingRecord>();
    const identifierTombstones = new Set<string>();
    let currentOperation: { record: BindingRecord; poisoned: boolean } | null = null;
    const recordFor = (candidate: unknown): BindingRecord | null => {
        if (typeof candidate !== 'string') return null;
        const record = reflectApply(mapGet, approvals, [candidate]) as BindingRecord | undefined;
        return record?.active && record.approvalRef === candidate ? record : null;
    };
    const remove = (record: BindingRecord, upstreamGone: boolean): boolean => {
        if (!record.active) return false;
        record.active = false; record.state = 'spent'; record.upstreamGone ||= upstreamGone;
        if ((reflectApply(mapGet, approvals, [record.approvalRef]) as BindingRecord | undefined) === record) {
            reflectApply(mapDelete, approvals, [record.approvalRef]);
        }
        record.lineage = null; return true;
    };
    const abortAttached = (proof: unknown, registration: unknown, code: HeadlessSoapCommandBindingErrorCode): never => {
        try { sources.proofLifecycle.unregisterDependent(proof, registration); } catch { /* proof wipe remains */ }
        try { sources.proofService.wipe(proof); } catch { /* denial remains PHI-safe */ }
        return fail(code);
    };
    const bind = async (proof: unknown): Promise<HeadlessSoapCommandBindingResultV1> => {
        if (currentOperation) { currentOperation.poisoned = true; return fail('lifecycle_unavailable'); }
        const proofDigest = digestHeadlessSoapAuthorizationProof(proof);
        if (!proofDigest) return fail('proof_unavailable');
        let record: BindingRecord | null = null, upstreamGone = false;
        let registration: unknown = null;
        try {
            registration = sources.proofLifecycle.registerDependent(proof, () => {
                upstreamGone = true;
                if (record) remove(record, true);
            });
        } catch { registration = null; }
        if (registration === null) return fail('proof_unavailable');
        let attached = false;
        try { attached = sources.proofLifecycle.confirmDependent(proof, registration) === true; } catch { attached = false; }
        if (!attached || upstreamGone) return abortAttached(proof, registration, 'proof_unavailable');
        let captured: HeadlessSoapAuthorizationLineageV1 | null = null, invoked = false, poisoned = false;
        let current = false, upstreamDenial: HeadlessSoapCommandBindingErrorCode | null = null;
        try {
            current = await sources.proofBinding.withCurrentDependentBinding(proof, registration, (candidate, sealCandidate) => {
                if (invoked || upstreamGone) { poisoned = true; return; }
                invoked = true;
                const lineage = createHeadlessSoapAuthorizationLineage(candidate);
                const seal = parseSeal(sealCandidate);
                if (!lineage || !seal || !sameBinding(lineage, seal)) { poisoned = true; return; }
                captured = lineage;
            });
        } catch (error) { current = false; upstreamDenial = bindingDenial(error); }
        if (upstreamDenial) return abortAttached(proof, registration, upstreamDenial);
        if (!current || !invoked || poisoned || !captured || upstreamGone) {
            return abortAttached(proof, registration, 'binding_unavailable');
        }
        const identifiers = createHeadlessSoapCommandBindingIdentifiers(sources.entropy);
        if (!identifiers) return abortAttached(proof, registration, 'lifecycle_unavailable');
        const identifierValues = [identifiers.commandId, identifiers.approvalRef, identifiers.idempotencyKey];
        if (identifierValues.some((value) => reflectApply(setHas, identifierTombstones, [value]))) {
            return abortAttached(proof, registration, 'lifecycle_unavailable');
        }
        for (const value of identifierValues) reflectApply(setAdd, identifierTombstones, [value]);
        try { attached = sources.proofLifecycle.confirmDependent(proof, registration) === true; } catch { attached = false; }
        if (!attached || upstreamGone) return abortAttached(proof, registration, 'binding_unavailable');
        record = { active: true, state: 'bound', proofDigest, registration, commandId: identifiers.commandId,
            approvalRef: identifiers.approvalRef, idempotencyKey: identifiers.idempotencyKey,
            lineage: captured, upstreamGone: false };
        reflectApply(mapSet, approvals, [record.approvalRef, record]);
        if (upstreamGone || !record.active) {
            remove(record, upstreamGone); return abortAttached(proof, registration, 'binding_unavailable');
        }
        return result(record.approvalRef, record.idempotencyKey);
    };
    const service: HeadlessSoapCommandBindingServiceV1 = objectFreeze({ bind,
        wipe(approvalRef: unknown, proof: unknown): boolean {
            if (currentOperation) { currentOperation.poisoned = true; return false; }
            const record = recordFor(approvalRef), digest = digestHeadlessSoapAuthorizationProof(proof);
            if (!record || !digest || digest !== record.proofDigest || record.state !== 'bound') return false;
            remove(record, false);
            try { sources.proofLifecycle.unregisterDependent(proof, record.registration); } catch { /* proof wipe remains */ }
            try { sources.proofService.wipe(proof); } catch { /* local terminal state won */ }
            record.registration = null; return true;
        },
    });
    const approvalController: HeadlessSoapApprovalControllerV1 = objectFreeze({
        async withSingleUseApproval(candidate: unknown, operation: (command: HeadlessSoapBoundCommandV1) => void): Promise<boolean> {
            if (currentOperation) { currentOperation.poisoned = true; return false; }
            const parsed = parseHeadlessSoapCommandEnvelope(candidate);
            if (!parsed) return false;
            const { envelope: presented, authorizationProofDigest: proofDigest } = parsed;
            const record = recordFor(presented.approvalRef);
            if (!record || record.state !== 'bound' || proofDigest !== record.proofDigest
                || presented.idempotencyKey !== record.idempotencyKey) return false;
            const retire = (): void => {
                if (!remove(record, false)) return;
                try { sources.proofLifecycle.unregisterDependent(presented.authorizationProof, record.registration); }
                catch { /* proof wipe remains */ }
                try { sources.proofService.wipe(presented.authorizationProof); } catch { /* local spent state won */ }
                record.registration = null;
            };
            if (!synchronous(operation)) { retire(); return false; }
            const activeOperation = { record, poisoned: false };
            currentOperation = activeOperation;
            let invoked = false, accepted = false, changed = false, singleUse = false;
            try {
                singleUse = await sources.proofBinding.withSingleUseDependentBinding(
                    presented.authorizationProof,
                    record.registration,
                    (lineageCandidate, sealCandidate) => {
                        if (invoked || activeOperation.poisoned || record.state !== 'bound') {
                            activeOperation.poisoned = true; return;
                        }
                        invoked = true;
                        const lineage = createHeadlessSoapAuthorizationLineage(lineageCandidate);
                        const seal = parseSeal(sealCandidate);
                        if (!lineage || !seal || !record.lineage || !sameBinding(lineage, seal)
                            || !sameHeadlessSoapAuthorizationLineage(record.lineage, lineage)) {
                            changed = true; return;
                        }
                        record.state = 'in_flight';
                        const command = objectFreeze(objectAssign(objectCreate(null), {
                            schema: 'mediflow.headless.soap-bound-command.v1' as const,
                            commandId: record.commandId,
                            approvalRef: record.approvalRef,
                            idempotencyKey: record.idempotencyKey,
                            authorizationProofDigest: record.proofDigest,
                            lineage,
                            sealBundle: seal,
                        })) as HeadlessSoapBoundCommandV1;
                        accepted = invoke(operation, command);
                    },
                );
            } catch { singleUse = false; }
            finally { if (currentOperation === activeOperation) currentOperation = null; }
            const outcome = singleUse && invoked && accepted && !changed && !activeOperation.poisoned;
            if (record.active) retire();
            return outcome;
        },
    });
    return objectFreeze({ service, approvalController });
}
