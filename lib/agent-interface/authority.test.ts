/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    evaluateAgentContextAccess,
    type AgentAuthorityBrokerSnapshot,
    type AgentCapabilityGrant,
    type AgentContextAccessRequest,
    type AgentContextLease,
    type AgentSession,
} from './authority.ts';
import { resolveAgentCapabilityGrant } from './capability-grant.ts';
import { AGENT_INTERFACE_MANIFEST, type AgentInterfaceCapability } from './manifest.ts';

const NOW = Date.parse('2026-08-19T10:00:00.000Z');
const [SOURCE] = AGENT_INTERFACE_MANIFEST;
assert.ok(SOURCE);
const AVAILABLE: AgentInterfaceCapability = Object.freeze({
    ...SOURCE, id: 'agent.synthetic.context-describe.v1', maximumStage: 'read',
    headlessDisposition: 'available', authorityProfile: 'agent_session_context_lease',
    requiredContext: Object.freeze(['selected_patient']), reason: null,
    sources: Object.freeze({ fabric: Object.freeze(['synthetic_context_describe']) }),
});
const MANIFEST = Object.freeze([AVAILABLE]);
const RESOLVED = resolveAgentCapabilityGrant(MANIFEST, { capabilityId: AVAILABLE.id, maximumStage: 'read' });
assert.equal(RESOLVED.ok, true);
if (!RESOLVED.ok) throw new Error('synthetic grant fixture did not resolve');
// @Codex: this is the only positive grant and remains synthetic and test-local.
const GRANT: AgentCapabilityGrant = {
    capabilityId: RESOLVED.grant.capabilityId, grantRef: 'grant-synthetic-1',
    sessionRef: 'agent-session-synthetic-1', leaseRef: 'context-lease-synthetic-1',
    selectionEpoch: 7, scope: 'patient.summary', action: 'read', manifestGrant: RESOLVED.grant,
    issuedAt: NOW - 20_000, expiresAt: NOW + 20_000, revocationState: 'active',
};

const SESSION: AgentSession = {
    schemaVersion: 'mediflow.agent.session.v1',
    sessionRef: GRANT.sessionRef,
    credentialClass: 'agent_session',
    authorityPlane: 'agent_interface',
    physicianSessionRef: 'physician-session-synthetic-1',
    ambulatoryId: 'ambulatory-synthetic-1',
    selectionEpoch: GRANT.selectionEpoch,
    capabilityGrants: [GRANT],
    issuedAt: NOW - 60_000,
    expiresAt: NOW + 60_000,
    revocationState: 'active',
};

const LEASE: AgentContextLease = {
    schemaVersion: 'mediflow.agent.context-lease.v1',
    leaseRef: GRANT.leaseRef,
    sessionRef: SESSION.sessionRef,
    selectionEpoch: SESSION.selectionEpoch,
    patientId: 'patient-synthetic-1',
    purpose: 'describe-selected-context',
    scopes: [GRANT.scope],
    issuedAt: NOW - 30_000,
    expiresAt: NOW + 30_000,
    revocationState: 'active',
};

const BROKER: AgentAuthorityBrokerSnapshot = {
    schemaVersion: 'mediflow.agent.authority-snapshot.v1',
    physicianSessionRef: SESSION.physicianSessionRef, ambulatoryId: SESSION.ambulatoryId,
    selectionEpoch: SESSION.selectionEpoch, agentSessionRef: SESSION.sessionRef,
    contextLeaseRef: LEASE.leaseRef, evaluatedAt: NOW, revocationState: 'active',
};

const REQUEST: AgentContextAccessRequest = {
    accessMode: 'single_patient', physicianSessionRef: BROKER.physicianSessionRef,
    sessionRef: BROKER.agentSessionRef, leaseRef: BROKER.contextLeaseRef,
    ambulatoryId: SESSION.ambulatoryId, selectionEpoch: BROKER.selectionEpoch,
    patientId: LEASE.patientId, purpose: LEASE.purpose, scope: GRANT.scope,
    capabilityId: GRANT.capabilityId, stage: GRANT.action, grantRef: GRANT.grantRef,
};

const INPUT = { manifest: MANIFEST, brokerSnapshot: BROKER, session: SESSION, lease: LEASE, request: REQUEST };
function decide(input: Partial<typeof INPUT> = {}) {
    return evaluateAgentContextAccess({ ...INPUT, ...input });
}
function withGrant(override: Record<string, unknown>): AgentSession {
    return { ...SESSION, capabilityGrants: [{ ...GRANT, ...override } as AgentCapabilityGrant] };
}

test('allows a bounded synthetic grant and keeps production not grantable', () => {
    assert.equal(AGENT_INTERFACE_MANIFEST.every((item) => item.authorityProfile === 'not_grantable'), true);
    assert.deepEqual(decide(), { allowed: true });
    assert.deepEqual(decide({ manifest: AGENT_INTERFACE_MANIFEST }), { allowed: false, reason: 'GRANT_STALE' });
    assert.deepEqual(evaluateAgentContextAccess(null), { allowed: false, reason: 'REQUEST_INVALID' });
});

test('denies expired, revoked, broad-credential, and foreign-authority sessions', () => {
    const cases: Array<[Partial<AgentSession>, string]> = [
        [{ expiresAt: NOW }, 'SESSION_EXPIRED'],
        [{ revocationState: 'revoked' }, 'SESSION_REVOKED'],
        [{ credentialClass: 'local_api_token' as 'agent_session' }, 'AGENT_CREDENTIAL_REQUIRED'],
        [{ credentialClass: 'paired_credential' as 'agent_session' }, 'AGENT_CREDENTIAL_REQUIRED'],
        [{ credentialClass: 'broad_credential' as 'agent_session' }, 'AGENT_CREDENTIAL_REQUIRED'],
        [{ authorityPlane: 'clinical_application' as 'agent_interface' }, 'AUTHORITY_PROFILE_FORBIDDEN'],
        [{ authorityPlane: 'engineering_operator' as 'agent_interface' }, 'AUTHORITY_PROFILE_FORBIDDEN'],
        [{ authorityPlane: 'admin' as 'agent_interface' }, 'AUTHORITY_PROFILE_FORBIDDEN'],
    ];
    for (const [override, reason] of cases) assert.deepEqual(
        decide({ session: { ...SESSION, ...override } }), { allowed: false, reason },
    );
    assert.deepEqual(decide({ brokerSnapshot: { ...BROKER, revocationState: 'revoked' } }), {
        allowed: false, reason: 'BROKER_SNAPSHOT_REVOKED',
    });
});

test('denies expired, revoked, or foreign-session leases and grants', () => {
    const cases: Array<[Partial<AgentContextLease>, string]> = [
        [{ expiresAt: NOW }, 'LEASE_EXPIRED'],
        [{ revocationState: 'revoked' }, 'LEASE_REVOKED'],
        [{ sessionRef: 'agent-session-synthetic-other' }, 'SESSION_LEASE_MISMATCH'],
    ];
    for (const [override, reason] of cases) assert.deepEqual(
        decide({ lease: { ...LEASE, ...override } }), { allowed: false, reason },
    );
    assert.deepEqual(decide({ session: withGrant({ issuedAt: NOW + 1 }) }), { allowed: false, reason: 'GRANT_NOT_YET_VALID' });
    assert.deepEqual(decide({ session: withGrant({ expiresAt: NOW }) }), { allowed: false, reason: 'GRANT_EXPIRED' });
    assert.deepEqual(decide({ session: withGrant({ revocationState: 'revoked' }) }), { allowed: false, reason: 'GRANT_REVOKED' });
});

test('binds access to one physician, session, lease, context, patient, and scope', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
        [{ accessMode: 'bulk' }, 'BULK_ACCESS_DENIED'],
        [{ physicianSessionRef: 'physician-session-synthetic-other' }, 'PHYSICIAN_SESSION_MISMATCH'],
        [{ sessionRef: 'agent-session-synthetic-other' }, 'AGENT_SESSION_MISMATCH'],
        [{ leaseRef: 'context-lease-synthetic-other' }, 'CONTEXT_LEASE_MISMATCH'],
        [{ ambulatoryId: 'ambulatory-synthetic-other' }, 'AMBULATORY_MISMATCH'],
        [{ selectionEpoch: 6 }, 'SELECTION_EPOCH_MISMATCH'],
        [{ patientId: 'patient-synthetic-other' }, 'PATIENT_MISMATCH'],
        [{ purpose: 'unrelated-purpose' }, 'PURPOSE_MISMATCH'],
        [{ scope: 'patient.all-records' }, 'SCOPE_MISMATCH'],
    ];
    for (const [override, reason] of cases) assert.deepEqual(decide({
        request: { ...REQUEST, ...override } as AgentContextAccessRequest,
    }), { allowed: false, reason });
    assert.deepEqual(decide({ session: withGrant({ scope: 'patient.all-records' }) }), { allowed: false, reason: 'SCOPE_MISMATCH' });
    assert.deepEqual(decide({ session: withGrant({ selectionEpoch: 6 }) }), { allowed: false, reason: 'SELECTION_EPOCH_MISMATCH' });
});

test('revalidates the manifest and denies capability or privilege escalation', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
        [{ capabilityId: 'agent.synthetic.patient-bulk.v1' }, 'CAPABILITY_NOT_GRANTED'],
        [{ stage: 'compute' }, 'ACTION_MISMATCH'],
        [{ stage: 'authorize' }, 'STAGE_NOT_DELEGABLE'],
        [{ stage: 'apply' }, 'STAGE_NOT_DELEGABLE'],
        [{ stage: 'stage' }, 'STAGE_NOT_DELEGABLE'],
    ];
    for (const [override, reason] of cases) assert.deepEqual(decide({
        request: { ...REQUEST, ...override } as AgentContextAccessRequest,
    }), { allowed: false, reason });
    assert.deepEqual(decide({ manifest: [{ ...AVAILABLE, maximumStage: 'observe' }] }), { allowed: false, reason: 'GRANT_STALE' });
    assert.deepEqual(decide({ session: withGrant({ manifestGrant: { ...RESOLVED.grant, requiredContext: ['stale_context'] } }) }), { allowed: false, reason: 'GRANT_STALE' });
    assert.deepEqual(decide({ manifest: null as unknown as typeof MANIFEST }), { allowed: false, reason: 'MANIFEST_INVALID' });
});

test('rejects accessors, proxies, sparse arrays, and extra privilege fields', () => {
    let reads = 0;
    const accessor = { ...REQUEST } as Record<string, unknown>;
    Object.defineProperty(accessor, 'stage', { enumerable: true, get() { reads += 1; return 'read'; } });
    assert.deepEqual(decide({ request: accessor as AgentContextAccessRequest }), { allowed: false, reason: 'REQUEST_INVALID' });
    assert.equal(reads, 0);
    const proxy = new Proxy({ ...BROKER }, { ownKeys() { throw new Error('hostile proxy'); } });
    assert.deepEqual(decide({ brokerSnapshot: proxy as AgentAuthorityBrokerSnapshot }), { allowed: false, reason: 'REQUEST_INVALID' });
    assert.deepEqual(decide({ lease: { ...LEASE, scopes: new Array(1) } }), { allowed: false, reason: 'LEASE_INVALID' });
    assert.deepEqual(decide({ session: { ...SESSION, capabilityGrants: new Array(1) } }), { allowed: false, reason: 'SESSION_INVALID' });
    assert.deepEqual(decide({ session: { ...SESSION, admin: true } as AgentSession }), { allowed: false, reason: 'SESSION_INVALID' });
});
