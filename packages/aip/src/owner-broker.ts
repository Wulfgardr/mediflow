/* @Codex */

import { types } from 'node:util';

export const AIP_AUDIT_SCHEMA_V1 = 'mediflow.aip.audit.v1' as const;

const SOURCE_KEYS = ['now', 'nextRef', 'hashRef', 'writeAudit'] as const;
const BINDING_KEYS = ['peerRef', 'runtimeRef', 'parentRef', 'purposeCode', 'operation', 'capabilityId',
    'scopeDigest', 'maxStage', 'budget', 'expiresAt', 'generation', 'revocationGeneration', 'selectionEpoch',
    'parentGeneration', 'policyGeneration', 'venue', 'egressAllowed'] as const;
const CURRENT_KEYS = ['peerRef', 'generation', 'revocationGeneration', 'selectionEpoch', 'parentGeneration', 'policyGeneration'] as const;
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

export type AipOwnerBrokerV1ErrorCode = 'input_invalid' | 'owner_invalid' | 'lease_invalid' | 'currentness_invalid'
    | 'claim_invalid' | 'reference_invalid' | 'clock_invalid' | 'audit_failed' | 'peer_mismatch'
    | 'lease_replay' | 'lease_revoked' | 'generation_changed' | 'revoked' | 'selection_changed'
    | 'parent_disposed' | 'policy_changed' | 'claim_mismatch' | 'expired' | 'budget_exhausted'
    | 'restart_changed';

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
    restartEpoch: number; revoked: boolean;
};
type LeaseRecord = { owner: OwnerRecord; leaseRef: string; state: 'available' | 'pending' | 'consumed' | 'revoked' };

function exact(value: unknown, keys: readonly string[], code: AipOwnerBrokerV1ErrorCode): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)) throw new AipOwnerBrokerV1Error(code);
    let prototype: object | null; let ownKeys: (string | symbol)[];
    try { prototype = Object.getPrototypeOf(value); ownKeys = Reflect.ownKeys(value); } catch { throw new AipOwnerBrokerV1Error(code); }
    if ((prototype !== Object.prototype && prototype !== null) || ownKeys.length !== keys.length
        || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) throw new AipOwnerBrokerV1Error(code);
    return value as Record<string, unknown>;
}

function read(source: Record<string, unknown>, keys: readonly string[], code: AipOwnerBrokerV1ErrorCode): unknown[] {
    try { return keys.map((key) => source[key]); } catch { throw new AipOwnerBrokerV1Error(code); }
}

function integer(value: unknown, minimum = 0): value is number {
    return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function handle<T>(): T {
    return Object.freeze(Object.create(null)) as T;
}

export function createAipOwnerBrokerV1(sourcesValue: unknown) {
    const sources = exact(sourcesValue, SOURCE_KEYS, 'input_invalid');
    const [nowValue, nextRefValue, hashRefValue, writeAuditValue] = read(sources, SOURCE_KEYS, 'input_invalid');
    if (typeof nowValue !== 'function' || typeof nextRefValue !== 'function'
        || typeof hashRefValue !== 'function' || typeof writeAuditValue !== 'function') throw new AipOwnerBrokerV1Error('input_invalid');
    const nowSource = nowValue as () => unknown;
    const nextRefSource = nextRefValue as () => unknown;
    const hashRefSource = hashRefValue as (value: string) => unknown;
    const writeAudit = writeAuditValue as (record: unknown) => unknown;
    let lastNow = -1;
    const owners = new WeakMap<object, OwnerRecord>();
    const leases = new WeakMap<object, LeaseRecord>();
    const disposedParents = new Set<string>();
    const issuedRefs = new Set<string>();
    let brokerRevocationEpoch = 0;
    let restartEpoch = 0;

    const now = (): number => {
        let value: unknown;
        try { value = nowSource(); } catch { throw new AipOwnerBrokerV1Error('clock_invalid'); }
        if (!integer(value) || value < lastNow) throw new AipOwnerBrokerV1Error('clock_invalid');
        lastNow = value;
        return value;
    };
    const nextRef = (): string => {
        let value: unknown;
        try { value = nextRefSource(); } catch { throw new AipOwnerBrokerV1Error('reference_invalid'); }
        if (typeof value !== 'string' || !REF.test(value) || issuedRefs.has(value)) throw new AipOwnerBrokerV1Error('reference_invalid');
        issuedRefs.add(value);
        return value;
    };
    const hashRef = (value: string): string => {
        let digest: unknown;
        try { digest = hashRefSource(value); } catch { throw new AipOwnerBrokerV1Error('audit_failed'); }
        if (typeof digest !== 'string' || !DIGEST.test(digest)) throw new AipOwnerBrokerV1Error('audit_failed');
        return digest;
    };
    const deny = async (lease: LeaseRecord, code: AipOwnerBrokerV1ErrorCode, timestamp: number): Promise<never> => {
        lease.state = 'revoked';
        const owner = lease.owner;
        const record = Object.freeze({ schemaVersion: AIP_AUDIT_SCHEMA_V1, eventType: 'authorization', outcome: 'denied',
            operation: owner.operation, capabilityId: owner.capabilityId, agentRefHash: hashRef(owner.agentRef),
            leaseRefHash: hashRef(lease.leaseRef), purposeCode: owner.purposeCode, maxStage: owner.maxStage,
            generation: owner.generation, selectionEpoch: owner.selectionEpoch, timestamp, denialCode: code,
            budgetUsed: owner.used });
        try { await writeAudit(record); } catch { throw new AipOwnerBrokerV1Error('audit_failed'); }
        throw new AipOwnerBrokerV1Error(code);
    };

    const issueOwner = (bindingValue: unknown): AipOwnerHandleV1 => {
        const binding = exact(bindingValue, BINDING_KEYS, 'input_invalid');
        const [peerRef, runtimeRef, parentRef, purposeCode, operation, capabilityId, scopeDigest, maxStage,
            budget, expiresAt, generation, revocationGeneration, selectionEpoch, parentGeneration, policyGeneration,
            venue, egressAllowed] = read(binding, BINDING_KEYS, 'input_invalid');
        const issuedAt = now();
        if (![peerRef, runtimeRef, parentRef].every((value) => typeof value === 'string' && REF.test(value))
            || ![purposeCode, operation, capabilityId].every((value) => typeof value === 'string' && TOKEN.test(value))
            || typeof scopeDigest !== 'string' || !DIGEST.test(scopeDigest)
            || (maxStage !== 'read_only' && maxStage !== 'proposal_only') || !integer(budget, 1)
            || !integer(expiresAt, issuedAt + 1) || !integer(generation, 1) || !integer(revocationGeneration)
            || !integer(selectionEpoch) || !integer(parentGeneration, 1) || !integer(policyGeneration, 1)
            || venue !== 'local_intelligent_host' || typeof egressAllowed !== 'boolean') throw new AipOwnerBrokerV1Error('input_invalid');
        const owner = handle<AipOwnerHandleV1>();
        owners.set(owner, { agentRef: nextRef(), peerRef: peerRef as string, runtimeRef: runtimeRef as string,
            parentRef: parentRef as string, purposeCode: purposeCode as string, operation: operation as string,
            capabilityId: capabilityId as string, scopeDigest, maxStage, budget, used: 0, expiresAt, generation,
            revocationGeneration, selectionEpoch, parentGeneration, policyGeneration, venue, egressAllowed,
            brokerRevocationEpoch, restartEpoch, revoked: false });
        return owner;
    };

    const issueLease = (ownerValue: unknown): AipLeaseHandleV1 => {
        if (!ownerValue || typeof ownerValue !== 'object') throw new AipOwnerBrokerV1Error('owner_invalid');
        const owner = owners.get(ownerValue as object);
        if (!owner) throw new AipOwnerBrokerV1Error('owner_invalid');
        const lease = handle<AipLeaseHandleV1>();
        leases.set(lease, { owner, leaseRef: nextRef(), state: 'available' });
        return lease;
    };

    const authorize = async (leaseValue: unknown, currentValue: unknown, claimValue: unknown): Promise<AipAuthorizationPermitV1> => {
        if (!leaseValue || typeof leaseValue !== 'object') throw new AipOwnerBrokerV1Error('lease_invalid');
        const lease = leases.get(leaseValue as object);
        if (!lease) throw new AipOwnerBrokerV1Error('lease_invalid');
        if (lease.state !== 'available') return await deny(lease,
            lease.state === 'revoked' ? 'lease_revoked' : 'lease_replay', now());
        const owner = lease.owner;
        let timestamp: number;
        try { timestamp = now(); } catch { lease.state = 'revoked'; throw new AipOwnerBrokerV1Error('clock_invalid'); }
        if (owner.revoked || owner.brokerRevocationEpoch !== brokerRevocationEpoch) return await deny(lease, 'revoked', timestamp);
        if (owner.restartEpoch !== restartEpoch) return await deny(lease, 'restart_changed', timestamp);
        if (disposedParents.has(owner.parentRef)) return await deny(lease, 'parent_disposed', timestamp);
        let currentValues: unknown[];
        try { currentValues = read(exact(currentValue, CURRENT_KEYS, 'currentness_invalid'), CURRENT_KEYS, 'currentness_invalid'); }
        catch { return await deny(lease, 'currentness_invalid', timestamp); }
        let claimValues: unknown[];
        try { claimValues = read(exact(claimValue, CLAIM_KEYS, 'claim_invalid'), CLAIM_KEYS, 'claim_invalid'); }
        catch { return await deny(lease, 'claim_invalid', timestamp); }
        const [peerRef, generation, revocationGeneration, selectionEpoch, parentGeneration, policyGeneration] = currentValues;
        const [operation, capabilityId] = claimValues;
        if (peerRef !== owner.peerRef) return await deny(lease, 'peer_mismatch', timestamp);
        if (generation !== owner.generation) return await deny(lease, 'generation_changed', timestamp);
        if (revocationGeneration !== owner.revocationGeneration) return await deny(lease, 'revoked', timestamp);
        if (selectionEpoch !== owner.selectionEpoch) return await deny(lease, 'selection_changed', timestamp);
        if (parentGeneration !== owner.parentGeneration) return await deny(lease, 'parent_disposed', timestamp);
        if (policyGeneration !== owner.policyGeneration) return await deny(lease, 'policy_changed', timestamp);
        if (operation !== owner.operation || capabilityId !== owner.capabilityId) return await deny(lease, 'claim_mismatch', timestamp);
        if (timestamp >= owner.expiresAt) return await deny(lease, 'expired', timestamp);
        if (owner.used >= owner.budget) return await deny(lease, 'budget_exhausted', timestamp);
        lease.state = 'pending';
        try {
            const record = Object.freeze({ schemaVersion: AIP_AUDIT_SCHEMA_V1, eventType: 'authorization', outcome: 'allowed',
                operation: owner.operation, capabilityId: owner.capabilityId, agentRefHash: hashRef(owner.agentRef),
                leaseRefHash: hashRef(lease.leaseRef), purposeCode: owner.purposeCode, maxStage: owner.maxStage,
                generation: owner.generation, selectionEpoch: owner.selectionEpoch, timestamp, denialCode: null,
                budgetUsed: owner.used + 1 });
            await writeAudit(record);
        } catch { lease.state = 'revoked'; throw new AipOwnerBrokerV1Error('audit_failed'); }
        owner.used += 1;
        lease.state = 'consumed';
        return handle<AipAuthorizationPermitV1>();
    };

    const revokeOwner = (ownerValue: unknown): boolean => {
        if (!ownerValue || typeof ownerValue !== 'object') throw new AipOwnerBrokerV1Error('owner_invalid');
        const owner = owners.get(ownerValue as object);
        if (!owner) throw new AipOwnerBrokerV1Error('owner_invalid');
        if (owner.revoked) return false;
        owner.revoked = true;
        return true;
    };
    const revokeAll = (): void => {
        if (brokerRevocationEpoch >= Number.MAX_SAFE_INTEGER) throw new AipOwnerBrokerV1Error('input_invalid');
        brokerRevocationEpoch += 1;
    };
    const restart = (): void => {
        if (restartEpoch >= Number.MAX_SAFE_INTEGER) throw new AipOwnerBrokerV1Error('input_invalid');
        restartEpoch += 1;
    };
    const disposeParent = (parentRef: unknown): void => {
        if (typeof parentRef !== 'string' || !REF.test(parentRef)) throw new AipOwnerBrokerV1Error('input_invalid');
        disposedParents.add(parentRef);
    };

    return Object.freeze({ issueOwner, issueLease, authorize, revokeOwner, revokeAll, restart, disposeParent });
}
