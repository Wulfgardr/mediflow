/* @Codex */
import { types } from 'node:util';
export const AIP_AUDIT_SCHEMA_V1 = 'mediflow.aip.audit.v1' as const;
const SOURCE_KEYS = ['now', 'nextRef', 'hashRef', 'writeAudit'] as const;
const BINDING_KEYS = ['peerRef', 'runtimeRef', 'parentRef', 'purposeCode', 'operation', 'capabilityId',
    'scopeDigest', 'maxStage', 'budget', 'expiresAt', 'generation', 'revocationGeneration', 'selectionEpoch',
    'parentGeneration', 'policyGeneration', 'venue', 'egressAllowed'] as const;
const CURRENT_KEYS = ['peerRef', 'runtimeRef', 'generation', 'revocationGeneration', 'selectionEpoch',
    'parentGeneration', 'policyGeneration'] as const;
const CLAIM_KEYS = ['operation', 'capabilityId'] as const;
const REF = /^[a-z][a-z0-9._-]{15,127}$/u;
const TOKEN = /^[a-z][a-z0-9._-]{0,127}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
declare const OWNER_BRAND: unique symbol;
declare const LEASE_BRAND: unique symbol;
declare const PERMIT_BRAND: unique symbol;
export type AipOwnerHandleV1 = Readonly<{ [OWNER_BRAND]: true }>;
export type AipLeaseHandleV1 = Readonly<{ [LEASE_BRAND]: true }>;
export type AipAuthorizationPermitV1 = Readonly<{ [PERMIT_BRAND]: true }>;
export type AipOwnerBrokerV1ErrorCode = 'input_invalid' | 'owner_invalid' | 'lease_invalid' | 'permit_invalid'
    | 'permit_replay' | 'permit_revoked' | 'currentness_invalid' | 'claim_invalid' | 'reference_invalid'
    | 'clock_invalid' | 'audit_failed' | 'peer_mismatch' | 'runtime_mismatch' | 'lease_replay' | 'lease_revoked'
    | 'generation_changed' | 'revoked' | 'selection_changed' | 'parent_disposed' | 'policy_changed'
    | 'claim_mismatch' | 'expired' | 'budget_exhausted' | 'restart_changed';
export class AipOwnerBrokerV1Error extends Error {
    constructor(public readonly code: AipOwnerBrokerV1ErrorCode) {
        super(`AIP owner broker rejected: ${code}`);
        this.name = 'AipOwnerBrokerV1Error';
    }
}
type OwnerRecord = {
    agentRef: string; peerRef: string; runtimeRef: string; parentRef: string; purposeCode: string;
    operation: string; capabilityId: string; scopeDigest: string; maxStage: 'read_only' | 'proposal_only';
    budget: number; used: number; expiresAt: number; generation: number; revocationGeneration: number;
    selectionEpoch: number; parentGeneration: number; policyGeneration: number;
    venue: 'local_intelligent_host'; egressAllowed: boolean; brokerRevocationEpoch: number;
    restartEpoch: number; revoked: boolean; turn: Promise<void>;
};
type LeaseRecord = { owner: OwnerRecord; leaseRef: string; state: 'available' | 'pending' | 'consumed' | 'revoked' };
type PermitRecord = { owner: OwnerRecord; lease: LeaseRecord; current: readonly unknown[]; claim: readonly unknown[];
    state: 'available' | 'pending' | 'consumed' | 'revoked' };
function exactValues(value: unknown, keys: readonly string[], code: AipOwnerBrokerV1ErrorCode): unknown[] {
    if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)) throw new AipOwnerBrokerV1Error(code);
    let prototype: object | null;
    let ownKeys: (string | symbol)[];
    let descriptors: Record<string, PropertyDescriptor>;
    try {
        prototype = Object.getPrototypeOf(value);
        ownKeys = Reflect.ownKeys(value);
        descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
    } catch { throw new AipOwnerBrokerV1Error(code); }
    if ((prototype !== Object.prototype && prototype !== null) || ownKeys.length !== keys.length
        || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) throw new AipOwnerBrokerV1Error(code);
    return keys.map((key) => {
        const descriptor = descriptors[key];
        if (!descriptor || !('value' in descriptor)) throw new AipOwnerBrokerV1Error(code);
        return descriptor.value;
    });
}
function integer(value: unknown, minimum = 0): value is number { return Number.isSafeInteger(value) && (value as number) >= minimum; }
function handle<T>(): T { return Object.freeze(Object.create(null)) as T; }
export function createAipOwnerBrokerV1(sourcesValue: unknown) {
    let observation: AipOwnerBrokerV1ErrorCode | null = null;
    let reentered = false;
    const enter = (): void => {
        if (observation !== null) {
            reentered = true;
            throw new AipOwnerBrokerV1Error('input_invalid');
        }
    };
    const observe = <T>(code: AipOwnerBrokerV1ErrorCode, action: () => T): T => {
        enter();
        observation = code;
        reentered = false;
        try {
            let result: T;
            try { result = action(); } catch { throw new AipOwnerBrokerV1Error(code); }
            if (reentered) throw new AipOwnerBrokerV1Error(code);
            return result;
        } finally {
            observation = null;
            reentered = false;
        }
    };
    const [nowValue, nextRefValue, hashRefValue, writeAuditValue] = observe('input_invalid',
        () => exactValues(sourcesValue, SOURCE_KEYS, 'input_invalid'));
    if (typeof nowValue !== 'function' || typeof nextRefValue !== 'function'
        || typeof hashRefValue !== 'function' || typeof writeAuditValue !== 'function') {
        throw new AipOwnerBrokerV1Error('input_invalid');
    }
    const nowSource = nowValue as () => unknown;
    const nextRefSource = nextRefValue as () => unknown;
    const hashRefSource = hashRefValue as (value: string) => unknown;
    const writeAudit = writeAuditValue as (record: unknown) => unknown;
    let lastNow = -1;
    const owners = new WeakMap<object, OwnerRecord>();
    const leases = new WeakMap<object, LeaseRecord>();
    const permits = new WeakMap<object, PermitRecord>();
    const disposedParents = new Set<string>();
    const issuedRefs = new Set<string>();
    let brokerRevocationEpoch = 0;
    let restartEpoch = 0;
    const now = (): number => {
        const value = observe('clock_invalid', nowSource);
        if (!integer(value) || value < lastNow) throw new AipOwnerBrokerV1Error('clock_invalid');
        lastNow = value;
        return value;
    };
    const nextRef = (): string => {
        const value = observe('reference_invalid', nextRefSource);
        if (typeof value !== 'string' || !REF.test(value) || issuedRefs.has(value)) {
            throw new AipOwnerBrokerV1Error('reference_invalid');
        }
        issuedRefs.add(value);
        return value;
    };
    const hashRef = (value: string): string => {
        const digest = observe('audit_failed', () => hashRefSource(value));
        if (typeof digest !== 'string' || !DIGEST.test(digest)) throw new AipOwnerBrokerV1Error('audit_failed');
        return digest;
    };
    const persistAudit = async (record: unknown): Promise<void> => {
        let result: Promise<unknown>;
        try { result = observe('audit_failed', () => Promise.resolve(writeAudit(record))); } catch { throw new AipOwnerBrokerV1Error('audit_failed'); }
        try { await result; } catch { throw new AipOwnerBrokerV1Error('audit_failed'); }
    };
    const deny = async (lease: LeaseRecord, code: AipOwnerBrokerV1ErrorCode, timestamp: number): Promise<never> => {
        lease.state = 'revoked';
        const owner = lease.owner;
        const record = Object.freeze({ schemaVersion: AIP_AUDIT_SCHEMA_V1, eventType: 'authorization', outcome: 'denied',
            operation: owner.operation, capabilityId: owner.capabilityId, agentRefHash: hashRef(owner.agentRef),
            leaseRefHash: hashRef(lease.leaseRef), purposeCode: owner.purposeCode, maxStage: owner.maxStage,
            generation: owner.generation, selectionEpoch: owner.selectionEpoch, timestamp, denialCode: code,
            budgetUsed: owner.used });
        await persistAudit(record);
        throw new AipOwnerBrokerV1Error(code);
    };
    const reserveTurn = (owner: OwnerRecord): { previous: Promise<void>; release: () => void } => {
        const previous = owner.turn;
        let release = (): void => undefined;
        owner.turn = new Promise<void>((resolve) => { release = resolve; });
        return { previous, release };
    };
    const ownerDenial = (owner: OwnerRecord, current: readonly unknown[], claim: readonly unknown[], timestamp: number)
    : AipOwnerBrokerV1ErrorCode | null => {
        if (owner.revoked || owner.brokerRevocationEpoch !== brokerRevocationEpoch) return 'revoked';
        if (owner.restartEpoch !== restartEpoch) return 'restart_changed';
        if (disposedParents.has(owner.parentRef)) return 'parent_disposed';
        const [peerRef, runtimeRef, generation, revocationGeneration, selectionEpoch, parentGeneration,
            policyGeneration] = current;
        const [operation, capabilityId] = claim;
        if (peerRef !== owner.peerRef) return 'peer_mismatch';
        if (runtimeRef !== owner.runtimeRef) return 'runtime_mismatch';
        if (generation !== owner.generation) return 'generation_changed';
        if (revocationGeneration !== owner.revocationGeneration) return 'revoked';
        if (selectionEpoch !== owner.selectionEpoch) return 'selection_changed';
        if (parentGeneration !== owner.parentGeneration) return 'parent_disposed';
        if (policyGeneration !== owner.policyGeneration) return 'policy_changed';
        if (operation !== owner.operation || capabilityId !== owner.capabilityId) return 'claim_mismatch';
        if (timestamp >= owner.expiresAt) return 'expired';
        return null;
    };
    const issueOwner = (bindingValue: unknown): AipOwnerHandleV1 => {
        enter();
        const [peerRef, runtimeRef, parentRef, purposeCode, operation, capabilityId, scopeDigest, maxStage,
            budget, expiresAt, generation, revocationGeneration, selectionEpoch, parentGeneration, policyGeneration,
            venue, egressAllowed] = observe('input_invalid', () => exactValues(bindingValue, BINDING_KEYS, 'input_invalid'));
        const issuedAt = now();
        if (![peerRef, runtimeRef, parentRef].every((value) => typeof value === 'string' && REF.test(value))
            || ![purposeCode, operation, capabilityId].every((value) => typeof value === 'string' && TOKEN.test(value))
            || typeof scopeDigest !== 'string' || !DIGEST.test(scopeDigest)
            || (maxStage !== 'read_only' && maxStage !== 'proposal_only') || !integer(budget, 1)
            || !integer(expiresAt, issuedAt + 1) || !integer(generation, 1) || !integer(revocationGeneration)
            || !integer(selectionEpoch) || !integer(parentGeneration, 1) || !integer(policyGeneration, 1)
            || venue !== 'local_intelligent_host' || typeof egressAllowed !== 'boolean') {
            throw new AipOwnerBrokerV1Error('input_invalid');
        }
        const owner = handle<AipOwnerHandleV1>();
        owners.set(owner, { agentRef: nextRef(), peerRef: peerRef as string, runtimeRef: runtimeRef as string,
            parentRef: parentRef as string, purposeCode: purposeCode as string, operation: operation as string,
            capabilityId: capabilityId as string, scopeDigest, maxStage, budget, used: 0, expiresAt, generation,
            revocationGeneration, selectionEpoch, parentGeneration, policyGeneration, venue, egressAllowed,
            brokerRevocationEpoch, restartEpoch, revoked: false, turn: Promise.resolve() });
        return owner;
    };
    const issueLease = (ownerValue: unknown): AipLeaseHandleV1 => {
        enter();
        if (!ownerValue || typeof ownerValue !== 'object') throw new AipOwnerBrokerV1Error('owner_invalid');
        const owner = owners.get(ownerValue as object);
        if (!owner) throw new AipOwnerBrokerV1Error('owner_invalid');
        const lease = handle<AipLeaseHandleV1>();
        leases.set(lease, { owner, leaseRef: nextRef(), state: 'available' });
        return lease;
    };
    const authorize = async (leaseValue: unknown, currentValue: unknown, claimValue: unknown)
    : Promise<AipAuthorizationPermitV1> => {
        enter();
        if (!leaseValue || typeof leaseValue !== 'object') throw new AipOwnerBrokerV1Error('lease_invalid');
        const lease = leases.get(leaseValue as object);
        if (!lease) throw new AipOwnerBrokerV1Error('lease_invalid');
        const owner = lease.owner;
        const { previous, release } = reserveTurn(owner);
        const replayCode = lease.state === 'available' ? null
            : lease.state === 'revoked' ? 'lease_revoked' as const : 'lease_replay' as const;
        if (!replayCode) lease.state = 'pending';
        let current: readonly unknown[] = [];
        let claim: readonly unknown[] = [];
        let inputCode: AipOwnerBrokerV1ErrorCode | null = null;
        if (!replayCode) {
            try { current = Object.freeze(observe('currentness_invalid',
                () => exactValues(currentValue, CURRENT_KEYS, 'currentness_invalid'))); } catch { inputCode = 'currentness_invalid'; }
            if (!inputCode) {
                try { claim = Object.freeze(observe('claim_invalid',
                    () => exactValues(claimValue, CLAIM_KEYS, 'claim_invalid'))); } catch { inputCode = 'claim_invalid'; }
            }
        }
        await previous;
        try {
            let timestamp: number;
            try { timestamp = now(); } catch { lease.state = 'revoked'; throw new AipOwnerBrokerV1Error('clock_invalid'); }
            if (replayCode) return await deny(lease, replayCode, timestamp);
            if (inputCode) return await deny(lease, inputCode, timestamp);
            const initialDenial = ownerDenial(owner, current, claim, timestamp);
            if (initialDenial) return await deny(lease, initialDenial, timestamp);
            if (owner.used >= owner.budget) return await deny(lease, 'budget_exhausted', timestamp);
            try {
                const record = Object.freeze({ schemaVersion: AIP_AUDIT_SCHEMA_V1, eventType: 'authorization', outcome: 'allowed',
                    operation: owner.operation, capabilityId: owner.capabilityId, agentRefHash: hashRef(owner.agentRef),
                    leaseRefHash: hashRef(lease.leaseRef), purposeCode: owner.purposeCode, maxStage: owner.maxStage,
                    generation: owner.generation, selectionEpoch: owner.selectionEpoch, timestamp, denialCode: null,
                    budgetUsed: owner.used + 1 });
                await persistAudit(record);
            } catch { lease.state = 'revoked'; throw new AipOwnerBrokerV1Error('audit_failed'); }
            try { timestamp = now(); } catch { lease.state = 'revoked'; throw new AipOwnerBrokerV1Error('clock_invalid'); }
            const commitDenial = ownerDenial(owner, current, claim, timestamp);
            if (commitDenial) return await deny(lease, commitDenial, timestamp);
            if (owner.used >= owner.budget) return await deny(lease, 'budget_exhausted', timestamp);
            owner.used += 1;
            lease.state = 'consumed';
            const permit = handle<AipAuthorizationPermitV1>();
            permits.set(permit, { owner, lease, current, claim, state: 'available' });
            return permit;
        } finally {
            release();
        }
    };
    const consumePermit = (permitValue: unknown, currentValue: unknown, claimValue: unknown): true => {
        enter();
        if (!permitValue || typeof permitValue !== 'object') throw new AipOwnerBrokerV1Error('permit_invalid');
        const permit = permits.get(permitValue as object);
        if (!permit) throw new AipOwnerBrokerV1Error('permit_invalid');
        if (permit.state !== 'available') throw new AipOwnerBrokerV1Error(
            permit.state === 'revoked' ? 'permit_revoked' : 'permit_replay');
        permit.state = 'pending';
        let current: readonly unknown[];
        let claim: readonly unknown[];
        try { current = observe('currentness_invalid',
            () => exactValues(currentValue, CURRENT_KEYS, 'currentness_invalid')); } catch {
            permit.state = 'revoked'; throw new AipOwnerBrokerV1Error('currentness_invalid');
        }
        try { claim = observe('claim_invalid', () => exactValues(claimValue, CLAIM_KEYS, 'claim_invalid')); } catch {
            permit.state = 'revoked'; throw new AipOwnerBrokerV1Error('claim_invalid');
        }
        let timestamp: number;
        try { timestamp = now(); } catch { permit.state = 'revoked'; throw new AipOwnerBrokerV1Error('clock_invalid'); }
        const denial = permit.lease.state === 'consumed' ? ownerDenial(permit.owner, current, claim, timestamp) : 'permit_revoked';
        if (denial || current.some((value, index) => value !== permit.current[index])
            || claim.some((value, index) => value !== permit.claim[index])) {
            permit.state = 'revoked';
            throw new AipOwnerBrokerV1Error(denial || 'permit_revoked');
        }
        permit.state = 'consumed';
        return true;
    };
    const revokeOwner = (ownerValue: unknown): boolean => {
        enter();
        if (!ownerValue || typeof ownerValue !== 'object') throw new AipOwnerBrokerV1Error('owner_invalid');
        const owner = owners.get(ownerValue as object);
        if (!owner) throw new AipOwnerBrokerV1Error('owner_invalid');
        if (owner.revoked) return false;
        owner.revoked = true;
        return true;
    };
    const revokeAll = (): void => {
        enter();
        if (brokerRevocationEpoch >= Number.MAX_SAFE_INTEGER) throw new AipOwnerBrokerV1Error('input_invalid');
        brokerRevocationEpoch += 1;
    };
    const restart = (): void => {
        enter();
        if (restartEpoch >= Number.MAX_SAFE_INTEGER) throw new AipOwnerBrokerV1Error('input_invalid');
        restartEpoch += 1;
    };
    const disposeParent = (parentRef: unknown): void => {
        enter();
        if (typeof parentRef !== 'string' || !REF.test(parentRef)) throw new AipOwnerBrokerV1Error('input_invalid');
        disposedParents.add(parentRef);
    };
    return Object.freeze({ issueOwner, issueLease, authorize, consumePermit, revokeOwner, revokeAll, restart, disposeParent });
}
