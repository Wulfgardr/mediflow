/* @Codex */
import 'server-only';

import { parseSeal, type ParsedSeal } from '../headless/clinician-soap-entry-seal-codec-internal';
import { digestHeadlessSoapAuthorizationProof } from './headless-soap-authorization-proof-token';
import {
    createHeadlessSoapAuthorizationLineage,
    type HeadlessSoapAuthorizationLineageV1,
} from './headless-soap-authorization-lineage';
import {
    createHeadlessSoapCommandBindingIdentifiers,
} from './headless-soap-command-binding-identifiers';

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
type ProofLifecyclePort = Readonly<{
    registerDependent(candidate: unknown, dispose: () => void): unknown | null;
    confirmDependent(candidate: unknown, registration: unknown): boolean;
    unregisterDependent(candidate: unknown, registration: unknown): boolean;
}>;
type ProofBindingPort = Readonly<{
    withCurrentDependentBinding(candidate: unknown, registration: unknown,
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
type BindingRecord = {
    active: boolean;
    state: 'bound' | 'spent';
    proofDigest: string;
    registration: unknown;
    commandId: string;
    approvalRef: string;
    idempotencyKey: string;
    lineage: HeadlessSoapAuthorizationLineageV1 | null;
    upstreamGone: boolean;
};

const APPROVAL_REF = /^hsaa_[0-9a-f]{64}$/u;
const objectAssign = Object.assign;
const objectCreate = Object.create;
const objectFreeze = Object.freeze;
const regexpTest = RegExp.prototype.test;
const reflectApply = Reflect.apply;
const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;
const mapDelete = Map.prototype.delete;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;

function fail(code: HeadlessSoapCommandBindingErrorCode): never {
    throw new HeadlessSoapCommandBindingError(code);
}
function result(approvalRef: string, idempotencyKey: string): HeadlessSoapCommandBindingResultV1 {
    return objectFreeze(objectAssign(objectCreate(null), { status: 'approval_bound' as const, approvalRef, idempotencyKey }));
}
function sameBinding(lineage: HeadlessSoapAuthorizationLineageV1, seal: ParsedSeal): boolean {
    return lineage.payloadDigest.sha256.hex === seal.payloadDigest.sha256.hex
        && lineage.sealDigest.sha256.hex === seal.sealDigest.sha256.hex;
}

/** Owns the process-local H6 command binding without write authority. */
export function createHeadlessSoapCommandBindingOwner(sources: HeadlessSoapCommandBindingSources): Readonly<{
    service: HeadlessSoapCommandBindingServiceV1;
}> {
    const approvals = new Map<string, BindingRecord>();
    const identifierTombstones = new Set<string>();
    const recordFor = (candidate: unknown): BindingRecord | null => {
        if (typeof candidate !== 'string' || !reflectApply(regexpTest, APPROVAL_REF, [candidate])) return null;
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
        let current = false;
        try {
            current = await sources.proofBinding.withCurrentDependentBinding(proof, registration, (candidate, sealCandidate) => {
                if (invoked || upstreamGone) { poisoned = true; return; }
                invoked = true;
                const lineage = createHeadlessSoapAuthorizationLineage(candidate);
                const seal = parseSeal(sealCandidate);
                if (!lineage || !seal || !sameBinding(lineage, seal)) { poisoned = true; return; }
                captured = lineage;
            });
        } catch { current = false; }
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
            const record = recordFor(approvalRef), digest = digestHeadlessSoapAuthorizationProof(proof);
            if (!record || !digest || digest !== record.proofDigest || record.state !== 'bound') return false;
            remove(record, false);
            try { sources.proofLifecycle.unregisterDependent(proof, record.registration); } catch { /* proof wipe remains */ }
            try { sources.proofService.wipe(proof); } catch { /* local terminal state won */ }
            record.registration = null; return true;
        },
    });
    return objectFreeze({ service });
}
