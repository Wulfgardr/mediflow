/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    evaluateAgentContextAccess,
    type AgentContextAccessRequest,
    type AgentContextLease,
    type AgentSession,
} from './authority.ts';

const NOW = Date.parse('2026-08-19T10:00:00.000Z');

const SESSION: AgentSession = {
    schemaVersion: 'mediflow.agent.session.v1',
    sessionRef: 'agent-session-synthetic-1',
    credentialClass: 'agent_session',
    authorityPlane: 'agent_interface',
    physicianSessionRef: 'physician-session-synthetic-1',
    ambulatoryId: 'ambulatory-synthetic-1',
    capabilityGrants: [{ capabilityId: 'agent.context.describe', maximumStage: 'read' }],
    issuedAt: NOW - 60_000,
    expiresAt: NOW + 60_000,
    revocationState: 'active',
};

const LEASE: AgentContextLease = {
    schemaVersion: 'mediflow.agent.context-lease.v1',
    leaseRef: 'context-lease-synthetic-1',
    sessionRef: SESSION.sessionRef,
    patientId: 'patient-synthetic-1',
    purpose: 'describe-selected-context',
    scopes: ['patient.summary'],
    issuedAt: NOW - 30_000,
    expiresAt: NOW + 30_000,
    revocationState: 'active',
};

const REQUEST: AgentContextAccessRequest = {
    accessMode: 'single_patient', ambulatoryId: SESSION.ambulatoryId,
    patientId: LEASE.patientId, purpose: LEASE.purpose, scope: 'patient.summary',
    capabilityId: 'agent.context.describe', stage: 'read',
};

function decide(input: {
    session?: AgentSession; lease?: AgentContextLease;
    request?: AgentContextAccessRequest; now?: number;
} = {}) {
    return evaluateAgentContextAccess({
        session: input.session ?? SESSION, lease: input.lease ?? LEASE,
        request: input.request ?? REQUEST, now: input.now ?? NOW,
    });
}

test('allows a bounded agent session and matching single-patient lease', () => {
    assert.deepEqual(decide(), { allowed: true });
    assert.deepEqual(evaluateAgentContextAccess(null), { allowed: false, reason: 'REQUEST_INVALID' });
});

test('denies expired, revoked, broad-credential, and foreign-authority sessions', () => {
    const cases: Array<[Partial<AgentSession>, string]> = [
        [{ expiresAt: NOW }, 'SESSION_EXPIRED'],
        [{ revocationState: 'revoked' }, 'SESSION_REVOKED'],
        [{ credentialClass: 'local_api_token' as 'agent_session' }, 'AGENT_CREDENTIAL_REQUIRED'],
        [{ credentialClass: 'paired_credential' as 'agent_session' }, 'AGENT_CREDENTIAL_REQUIRED'],
        [{ authorityPlane: 'clinical_application' as 'agent_interface' }, 'AUTHORITY_PROFILE_FORBIDDEN'],
        [{ authorityPlane: 'engineering_operator' as 'agent_interface' }, 'AUTHORITY_PROFILE_FORBIDDEN'],
        [{ authorityPlane: 'admin' as 'agent_interface' }, 'AUTHORITY_PROFILE_FORBIDDEN'],
    ];

    for (const [override, reason] of cases) {
        assert.deepEqual(decide({ session: { ...SESSION, ...override } }), {
            allowed: false, reason,
        });
    }
});

test('denies expired, revoked, or foreign-session context leases', () => {
    const cases: Array<[Partial<AgentContextLease>, string]> = [
        [{ expiresAt: NOW }, 'LEASE_EXPIRED'],
        [{ revocationState: 'revoked' }, 'LEASE_REVOKED'],
        [{ sessionRef: 'agent-session-synthetic-other' }, 'SESSION_LEASE_MISMATCH'],
    ];

    for (const [override, reason] of cases) {
        assert.deepEqual(decide({ lease: { ...LEASE, ...override } }), {
            allowed: false, reason,
        });
    }
});

test('keeps lease access single-patient and bound to ambulatory, purpose, and scope', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
        [{ accessMode: 'bulk' }, 'BULK_ACCESS_DENIED'],
        [{ patientId: 'patient-synthetic-other' }, 'PATIENT_MISMATCH'],
        [{ ambulatoryId: 'ambulatory-synthetic-other' }, 'AMBULATORY_MISMATCH'],
        [{ purpose: 'unrelated-purpose' }, 'PURPOSE_MISMATCH'],
        [{ scope: 'patient.all-records' }, 'SCOPE_MISMATCH'],
    ];

    for (const [override, reason] of cases) {
        assert.deepEqual(decide({
            request: { ...REQUEST, ...override } as AgentContextAccessRequest,
        }), { allowed: false, reason });
    }
});

test('denies capability mismatch, stage escalation, authorize, and apply', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
        [{ capabilityId: 'agent.patient.bulk' }, 'CAPABILITY_NOT_GRANTED'],
        [{ stage: 'compute' }, 'STAGE_EXCEEDS_GRANT'],
        [{ stage: 'authorize' }, 'STAGE_NOT_DELEGABLE'],
        [{ stage: 'apply' }, 'STAGE_NOT_DELEGABLE'],
    ];

    for (const [override, reason] of cases) {
        assert.deepEqual(decide({
            request: { ...REQUEST, ...override } as AgentContextAccessRequest,
        }), { allowed: false, reason });
    }
});
