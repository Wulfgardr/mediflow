/* @Codex */
export type AgentDelegableStage = 'observe' | 'read' | 'compute' | 'propose' | 'preview';

const DELEGABLE_STAGES = new Set<AgentDelegableStage>([
    'observe', 'read', 'compute', 'propose', 'preview',
]);
const STAGE_RANK: Readonly<Record<AgentDelegableStage, number>> = Object.freeze({
    observe: 0, read: 1, compute: 2, propose: 3, preview: 4,
});

export type AgentCapabilityGrant = Readonly<{
    capabilityId: string;
    maximumStage: AgentDelegableStage;
}>;

export type AgentSession = Readonly<{
    schemaVersion: 'mediflow.agent.session.v1';
    sessionRef: string;
    credentialClass: 'agent_session';
    authorityPlane: 'agent_interface';
    physicianSessionRef: string;
    ambulatoryId: string;
    capabilityGrants: readonly AgentCapabilityGrant[];
    issuedAt: number;
    expiresAt: number;
    revocationState: 'active' | 'revoked';
}>;

export type AgentContextLease = Readonly<{
    schemaVersion: 'mediflow.agent.context-lease.v1';
    leaseRef: string;
    sessionRef: string;
    patientId: string;
    purpose: string;
    scopes: readonly string[];
    issuedAt: number;
    expiresAt: number;
    revocationState: 'active' | 'revoked';
}>;

export type AgentContextAccessRequest = Readonly<{
    accessMode: 'single_patient' | 'bulk';
    ambulatoryId: string;
    patientId: string;
    purpose: string;
    scope: string;
    capabilityId: string;
    stage: AgentDelegableStage;
}>;

export type AgentAuthorityDenialReason =
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
    | 'SESSION_LEASE_MISMATCH'
    | 'REQUEST_INVALID'
    | 'BULK_ACCESS_DENIED'
    | 'PATIENT_MISMATCH'
    | 'AMBULATORY_MISMATCH'
    | 'PURPOSE_MISMATCH'
    | 'SCOPE_MISMATCH'
    | 'CAPABILITY_NOT_GRANTED'
    | 'STAGE_NOT_DELEGABLE'
    | 'STAGE_EXCEEDS_GRANT';

export type AgentContextAccessDecision =
    | Readonly<{ allowed: true }>
    | Readonly<{ allowed: false; reason: AgentAuthorityDenialReason }>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isTime(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value);
}

function isCapabilityGrants(value: unknown): value is readonly AgentCapabilityGrant[] {
    if (!Array.isArray(value)) return false;
    const ids = new Set<string>();
    return value.every((grant) => {
        if (!isRecord(grant) || !isText(grant.capabilityId)
            || !DELEGABLE_STAGES.has(grant.maximumStage as AgentDelegableStage)
            || ids.has(grant.capabilityId)) return false;
        ids.add(grant.capabilityId);
        return true;
    });
}

function deny(reason: AgentAuthorityDenialReason): AgentContextAccessDecision {
    return Object.freeze({ allowed: false, reason });
}

export function validateAgentSession(value: unknown, now: number): AgentAuthorityDenialReason | null {
    if (!isRecord(value) || !isTime(now)) return 'SESSION_INVALID';
    if (value.credentialClass !== 'agent_session') return 'AGENT_CREDENTIAL_REQUIRED';
    if (value.authorityPlane !== 'agent_interface') return 'AUTHORITY_PROFILE_FORBIDDEN';
    if (value.schemaVersion !== 'mediflow.agent.session.v1'
        || !isText(value.sessionRef) || !isText(value.physicianSessionRef)
        || !isText(value.ambulatoryId) || !isCapabilityGrants(value.capabilityGrants)
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
    return Array.isArray(value) && value.length > 0
        && value.every(isText) && new Set(value).size === value.length;
}

export function validateAgentContextLease(value: unknown, now: number): AgentAuthorityDenialReason | null {
    if (!isRecord(value) || !isTime(now)
        || value.schemaVersion !== 'mediflow.agent.context-lease.v1'
        || !isText(value.leaseRef) || !isText(value.sessionRef) || !isText(value.patientId)
        || !isText(value.purpose) || !isScopes(value.scopes)
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

function isAccessRequest(value: unknown): value is AgentContextAccessRequest {
    return isRecord(value)
        && (value.accessMode === 'single_patient' || value.accessMode === 'bulk')
        && isText(value.ambulatoryId) && isText(value.patientId) && isText(value.purpose)
        && isText(value.scope) && isText(value.capabilityId) && isText(value.stage);
}

export function evaluateAgentContextAccess(input: unknown): AgentContextAccessDecision {
    if (!isRecord(input) || !isTime(input.now)) return deny('REQUEST_INVALID');
    const sessionDenial = validateAgentSession(input.session, input.now);
    if (sessionDenial) return deny(sessionDenial);
    const leaseDenial = validateAgentContextLease(input.lease, input.now);
    if (leaseDenial) return deny(leaseDenial);
    if (!isAccessRequest(input.request)) return deny('REQUEST_INVALID');
    const session = input.session as AgentSession;
    const lease = input.lease as AgentContextLease;
    const request = input.request;
    if (lease.sessionRef !== session.sessionRef) return deny('SESSION_LEASE_MISMATCH');
    if (request.accessMode === 'bulk') return deny('BULK_ACCESS_DENIED');
    if (request.patientId !== lease.patientId) return deny('PATIENT_MISMATCH');
    if (request.ambulatoryId !== session.ambulatoryId) return deny('AMBULATORY_MISMATCH');
    if (request.purpose !== lease.purpose) return deny('PURPOSE_MISMATCH');
    if (!lease.scopes.includes(request.scope)) return deny('SCOPE_MISMATCH');
    if (!DELEGABLE_STAGES.has(request.stage)) return deny('STAGE_NOT_DELEGABLE');
    const grant = session.capabilityGrants.find(
        (item) => item.capabilityId === request.capabilityId,
    );
    if (!grant) return deny('CAPABILITY_NOT_GRANTED');
    if (STAGE_RANK[request.stage] > STAGE_RANK[grant.maximumStage]) {
        return deny('STAGE_EXCEEDS_GRANT');
    }
    return Object.freeze({ allowed: true });
}
