/* @Codex */
import {
    revalidateAgentCapabilityGrant,
    type AgentDelegableStage as ManifestDelegableStage,
    type ManifestResolvedCapabilityGrant,
} from './capability-grant';
import { hasUnsafeAgentInterfaceProperty } from './manifest';

export type AgentDelegableStage = ManifestDelegableStage;

const DELEGABLE_STAGES = new Set<AgentDelegableStage>([
    'observe', 'read', 'compute', 'propose', 'preview',
]);
const STAGE_RANK: Readonly<Record<AgentDelegableStage, number>> = Object.freeze({
    observe: 0, read: 1, compute: 2, propose: 3, preview: 4,
});

export type AgentCapabilityGrant = Readonly<{
    capabilityId: string;
    grantRef: string; sessionRef: string; leaseRef: string;
    selectionEpoch: number; scope: string; action: AgentDelegableStage;
    manifestGrant: ManifestResolvedCapabilityGrant;
    issuedAt: number; expiresAt: number; revocationState: 'active' | 'revoked';
}>;

export type AgentSession = Readonly<{
    schemaVersion: 'mediflow.agent.session.v1';
    sessionRef: string;
    credentialClass: 'agent_session';
    authorityPlane: 'agent_interface';
    physicianSessionRef: string;
    ambulatoryId: string;
    selectionEpoch: number;
    capabilityGrants: readonly AgentCapabilityGrant[];
    issuedAt: number;
    expiresAt: number;
    revocationState: 'active' | 'revoked';
}>;

export type AgentContextLease = Readonly<{
    schemaVersion: 'mediflow.agent.context-lease.v1';
    leaseRef: string;
    sessionRef: string;
    selectionEpoch: number;
    patientId: string;
    purpose: string;
    scopes: readonly string[];
    issuedAt: number;
    expiresAt: number;
    revocationState: 'active' | 'revoked';
}>;

export type AgentAuthorityBrokerSnapshot = Readonly<{
    schemaVersion: 'mediflow.agent.authority-snapshot.v1';
    physicianSessionRef: string; ambulatoryId: string; selectionEpoch: number;
    agentSessionRef: string; contextLeaseRef: string; evaluatedAt: number;
    revocationState: 'active' | 'revoked';
}>;

export type AgentContextAccessRequest = Readonly<{
    accessMode: 'single_patient' | 'bulk';
    physicianSessionRef: string;
    sessionRef: string;
    leaseRef: string;
    ambulatoryId: string;
    selectionEpoch: number;
    patientId: string;
    purpose: string;
    scope: string;
    capabilityId: string;
    stage: AgentDelegableStage;
    grantRef: string;
}>;

export type AgentAuthorityDenialReason =
    | 'BROKER_SNAPSHOT_INVALID'
    | 'BROKER_SNAPSHOT_REVOKED'
    | 'SESSION_INVALID'
    | 'AGENT_CREDENTIAL_REQUIRED'
    | 'AUTHORITY_PROFILE_FORBIDDEN'
    | 'SESSION_NOT_YET_VALID'
    | 'SESSION_EXPIRED'
    | 'SESSION_REVOKED'
    | 'LEASE_INVALID'
    | 'LEASE_NOT_YET_VALID'
    | 'LEASE_EXPIRED'
    | 'LEASE_REVOKED'
    | 'GRANT_NOT_YET_VALID'
    | 'GRANT_EXPIRED'
    | 'GRANT_REVOKED'
    | 'SESSION_LEASE_MISMATCH'
    | 'PHYSICIAN_SESSION_MISMATCH'
    | 'AGENT_SESSION_MISMATCH'
    | 'CONTEXT_LEASE_MISMATCH'
    | 'SELECTION_EPOCH_MISMATCH'
    | 'REQUEST_INVALID'
    | 'BULK_ACCESS_DENIED'
    | 'PATIENT_MISMATCH'
    | 'AMBULATORY_MISMATCH'
    | 'PURPOSE_MISMATCH'
    | 'SCOPE_MISMATCH'
    | 'CAPABILITY_NOT_GRANTED'
    | 'ACTION_MISMATCH'
    | 'STAGE_NOT_DELEGABLE'
    | 'STAGE_EXCEEDS_GRANT'
    | 'MANIFEST_INVALID'
    | 'GRANT_STALE';

export type AgentContextAccessDecision =
    | Readonly<{ allowed: true }>
    | Readonly<{ allowed: false; reason: AgentAuthorityDenialReason }>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneSafe(value: unknown): unknown {
    try {
        return hasUnsafeAgentInterfaceProperty(value) ? null : structuredClone(value);
    } catch {
        return null;
    }
}

function isText(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isTime(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value);
}

function isEpoch(value: unknown): value is number {
    return isTime(value) && value >= 0;
}

function isDenseArray(value: unknown): value is unknown[] {
    return Array.isArray(value) && Object.keys(value).length === value.length
        && Object.keys(value).every((key, index) => key === String(index));
}

function isCapabilityGrants(value: unknown): value is readonly AgentCapabilityGrant[] {
    if (!isDenseArray(value)) return false;
    const ids = new Set<string>();
    const refs = new Set<string>();
    return value.every((grant) => {
        if (!isRecord(grant) || Object.keys(grant).length !== 11
            || !isText(grant.capabilityId) || !isText(grant.grantRef)
            || !isText(grant.sessionRef) || !isText(grant.leaseRef)
            || !isEpoch(grant.selectionEpoch) || !isText(grant.scope)
            || !DELEGABLE_STAGES.has(grant.action as AgentDelegableStage)
            || !isRecord(grant.manifestGrant)
            || grant.manifestGrant.capabilityId !== grant.capabilityId
            || !isTime(grant.issuedAt) || !isTime(grant.expiresAt)
            || grant.issuedAt >= grant.expiresAt
            || (grant.revocationState !== 'active' && grant.revocationState !== 'revoked')
            || ids.has(grant.capabilityId) || refs.has(grant.grantRef)) return false;
        ids.add(grant.capabilityId);
        refs.add(grant.grantRef);
        return true;
    });
}

function deny(reason: AgentAuthorityDenialReason): AgentContextAccessDecision {
    return Object.freeze({ allowed: false, reason });
}

export function validateAgentSession(value: unknown, now: number): AgentAuthorityDenialReason | null {
    value = cloneSafe(value);
    if (!isRecord(value) || !isTime(now)) return 'SESSION_INVALID';
    if (value.credentialClass !== 'agent_session') return 'AGENT_CREDENTIAL_REQUIRED';
    if (value.authorityPlane !== 'agent_interface') return 'AUTHORITY_PROFILE_FORBIDDEN';
    if (Object.keys(value).length !== 11 || value.schemaVersion !== 'mediflow.agent.session.v1'
        || !isText(value.sessionRef) || !isText(value.physicianSessionRef)
        || !isText(value.ambulatoryId) || !isEpoch(value.selectionEpoch)
        || !isCapabilityGrants(value.capabilityGrants)
        || !isTime(value.issuedAt) || !isTime(value.expiresAt)
        || value.issuedAt >= value.expiresAt
        || (value.revocationState !== 'active' && value.revocationState !== 'revoked')) {
        return 'SESSION_INVALID';
    }
    if (value.revocationState === 'revoked') return 'SESSION_REVOKED';
    if (now < value.issuedAt) return 'SESSION_NOT_YET_VALID';
    if (now >= value.expiresAt) return 'SESSION_EXPIRED';
    return null;
}

function isScopes(value: unknown): value is readonly string[] {
    return isDenseArray(value) && value.length > 0
        && value.every(isText) && new Set(value).size === value.length;
}

export function validateAgentContextLease(value: unknown, now: number): AgentAuthorityDenialReason | null {
    value = cloneSafe(value);
    if (!isRecord(value) || Object.keys(value).length !== 10 || !isTime(now)
        || value.schemaVersion !== 'mediflow.agent.context-lease.v1'
        || !isText(value.leaseRef) || !isText(value.sessionRef) || !isEpoch(value.selectionEpoch)
        || !isText(value.patientId) || !isText(value.purpose) || !isScopes(value.scopes)
        || !isTime(value.issuedAt) || !isTime(value.expiresAt)
        || value.issuedAt >= value.expiresAt
        || (value.revocationState !== 'active' && value.revocationState !== 'revoked')) {
        return 'LEASE_INVALID';
    }
    if (value.revocationState === 'revoked') return 'LEASE_REVOKED';
    if (now < value.issuedAt) return 'LEASE_NOT_YET_VALID';
    if (now >= value.expiresAt) return 'LEASE_EXPIRED';
    return null;
}

function isBrokerSnapshot(value: unknown): value is AgentAuthorityBrokerSnapshot {
    return isRecord(value) && Object.keys(value).length === 8
        && value.schemaVersion === 'mediflow.agent.authority-snapshot.v1'
        && isText(value.physicianSessionRef) && isText(value.ambulatoryId)
        && isEpoch(value.selectionEpoch) && isText(value.agentSessionRef)
        && isText(value.contextLeaseRef) && isTime(value.evaluatedAt)
        && (value.revocationState === 'active' || value.revocationState === 'revoked');
}

function isAccessRequest(value: unknown): value is AgentContextAccessRequest {
    return isRecord(value) && Object.keys(value).length === 12
        && (value.accessMode === 'single_patient' || value.accessMode === 'bulk')
        && isText(value.physicianSessionRef) && isText(value.sessionRef)
        && isText(value.leaseRef) && isText(value.ambulatoryId) && isEpoch(value.selectionEpoch)
        && isText(value.patientId) && isText(value.purpose) && isText(value.scope)
        && isText(value.capabilityId) && isText(value.stage) && isText(value.grantRef);
}

// @Codex: one caller-detached broker snapshot governs the complete access decision.
export function evaluateAgentContextAccess(value: unknown): AgentContextAccessDecision {
    const input = cloneSafe(value);
    if (!isRecord(input) || Object.keys(input).length !== 5) return deny('REQUEST_INVALID');
    if (!isBrokerSnapshot(input.brokerSnapshot)) return deny('BROKER_SNAPSHOT_INVALID');
    const broker = Object.freeze(input.brokerSnapshot);
    if (broker.revocationState === 'revoked') return deny('BROKER_SNAPSHOT_REVOKED');
    const sessionDenial = validateAgentSession(input.session, broker.evaluatedAt);
    if (sessionDenial) return deny(sessionDenial);
    const leaseDenial = validateAgentContextLease(input.lease, broker.evaluatedAt);
    if (leaseDenial) return deny(leaseDenial);
    if (!isAccessRequest(input.request)) return deny('REQUEST_INVALID');
    const session = input.session as AgentSession;
    const lease = input.lease as AgentContextLease;
    const request = input.request;
    if (lease.sessionRef !== session.sessionRef) return deny('SESSION_LEASE_MISMATCH');
    if (!DELEGABLE_STAGES.has(request.stage)) return deny('STAGE_NOT_DELEGABLE');
    const grant = session.capabilityGrants.find((item) => item.grantRef === request.grantRef);
    if (!grant || grant.capabilityId !== request.capabilityId) return deny('CAPABILITY_NOT_GRANTED');
    if (grant.revocationState === 'revoked') return deny('GRANT_REVOKED');
    if (broker.evaluatedAt < grant.issuedAt) return deny('GRANT_NOT_YET_VALID');
    if (broker.evaluatedAt >= grant.expiresAt) return deny('GRANT_EXPIRED');
    if (session.physicianSessionRef !== broker.physicianSessionRef
        || request.physicianSessionRef !== broker.physicianSessionRef) {
        return deny('PHYSICIAN_SESSION_MISMATCH');
    }
    if (session.sessionRef !== broker.agentSessionRef || request.sessionRef !== broker.agentSessionRef
        || grant.sessionRef !== broker.agentSessionRef) return deny('AGENT_SESSION_MISMATCH');
    if (lease.leaseRef !== broker.contextLeaseRef || request.leaseRef !== broker.contextLeaseRef
        || grant.leaseRef !== broker.contextLeaseRef) return deny('CONTEXT_LEASE_MISMATCH');
    if (session.ambulatoryId !== broker.ambulatoryId
        || request.ambulatoryId !== broker.ambulatoryId) return deny('AMBULATORY_MISMATCH');
    if (session.selectionEpoch !== broker.selectionEpoch || lease.selectionEpoch !== broker.selectionEpoch
        || request.selectionEpoch !== broker.selectionEpoch
        || grant.selectionEpoch !== broker.selectionEpoch) return deny('SELECTION_EPOCH_MISMATCH');
    if (request.accessMode === 'bulk') return deny('BULK_ACCESS_DENIED');
    if (request.patientId !== lease.patientId) return deny('PATIENT_MISMATCH');
    if (request.purpose !== lease.purpose) return deny('PURPOSE_MISMATCH');
    if (!lease.scopes.includes(request.scope) || grant.scope !== request.scope) {
        return deny('SCOPE_MISMATCH');
    }
    if (grant.action !== request.stage) return deny('ACTION_MISMATCH');
    const currentGrant = revalidateAgentCapabilityGrant(input.manifest, grant.manifestGrant);
    if (!currentGrant.ok) {
        return deny(currentGrant.reason === 'MANIFEST_INVALID' ? 'MANIFEST_INVALID' : 'GRANT_STALE');
    }
    if (STAGE_RANK[request.stage] > STAGE_RANK[currentGrant.grant.maximumStage]) {
        return deny('STAGE_EXCEEDS_GRANT');
    }
    return Object.freeze({ allowed: true });
}
