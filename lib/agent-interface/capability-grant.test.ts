/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { revalidateAgentCapabilityGrant, resolveAgentCapabilityGrant } from './capability-grant.ts';
import { AGENT_INTERFACE_MANIFEST, type AgentInterfaceCapability } from './manifest.ts';
const [SOURCE] = AGENT_INTERFACE_MANIFEST;
assert.ok(SOURCE);
const AVAILABLE: AgentInterfaceCapability = Object.freeze({
    ...SOURCE, id: 'agent.synthetic.context-describe.v1', maximumStage: 'read',
    headlessDisposition: 'available', authorityProfile: 'agent_session_context_lease',
    requiredContext: Object.freeze(['selected_patient']), reason: null,
    sources: Object.freeze({ fabric: Object.freeze(['synthetic_context_describe']) }),
});
const MANIFEST = Object.freeze([AVAILABLE]);
// @Codex: the only positive entry is synthetic, test-local, and read-only.
test('resolves one immutable available-entry snapshot', () => {
    const result = resolveAgentCapabilityGrant(MANIFEST, { capabilityId: AVAILABLE.id, maximumStage: 'read' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.grant.headlessDisposition, 'available');
    assert.deepEqual(result.grant.sources, { fabric: ['synthetic_context_describe'] });
    assert.ok(Object.isFrozen(result.grant) && Object.isFrozen(result.grant.requiredContext)
        && Object.isFrozen(result.grant.sources) && Object.isFrozen(result.grant.sources.fabric));
});
test('keeps every frozen entry and proposal_only non-grantable', () => {
    for (const capability of AGENT_INTERFACE_MANIFEST) assert.deepEqual(resolveAgentCapabilityGrant(
        AGENT_INTERFACE_MANIFEST, { capabilityId: capability.id, maximumStage: 'observe' },
    ), { ok: false, reason: 'CAPABILITY_NOT_GRANTABLE' });
    const proposal = { ...AVAILABLE, headlessDisposition: 'proposal_only', authorityProfile: 'not_grantable', reason: 'authority semantics unratified' };
    assert.deepEqual(resolveAgentCapabilityGrant([proposal], { capabilityId: proposal.id, maximumStage: 'read' }),
        { ok: false, reason: 'CAPABILITY_NOT_GRANTABLE' });
});
test('malformed security fields fail closed without throwing', () => {
    const cases = [
        { requiredContext: null }, { requiredContext: Object.assign(new Array(1), { extra: 'x' }) }, { venue: [null] }, { egress: 'cloud' }, { fallback: 'allow' },
        { reason: 7 }, { sources: { fabric: [null] } }, { sources: { fabric: Object.assign(new Array(1), { extra: 'x' }) } }, { admin: true },
    ];
    for (const override of cases) assert.deepEqual(resolveAgentCapabilityGrant([{ ...AVAILABLE, ...override }],
        { capabilityId: AVAILABLE.id, maximumStage: 'read' }), { ok: false, reason: 'MANIFEST_INVALID' });
    let egressReads = 0; const stateful = { ...AVAILABLE, get egress() { return egressReads++ === 0 ? 'none' : 'cloud'; } };
    assert.deepEqual(resolveAgentCapabilityGrant([stateful], { capabilityId: AVAILABLE.id, maximumStage: 'read' }), { ok: false, reason: 'MANIFEST_INVALID' }); assert.equal(egressReads, 0);
});
test('rejects malformed requests, apply, unknown ids, and stage escalation', () => {
    const cases: Array<[unknown, string]> = [
        [null, 'GRANT_REQUEST_INVALID'],
        [{ capabilityId: 'agent.synthetic.unknown.v1', maximumStage: 'read' }, 'CAPABILITY_NOT_FOUND'],
        [{ capabilityId: AVAILABLE.id, maximumStage: 'apply' }, 'STAGE_NOT_DELEGABLE'],
        [{ capabilityId: AVAILABLE.id, maximumStage: 'compute' }, 'STAGE_EXCEEDS_MANIFEST'], [{ capabilityId: AVAILABLE.id, get maximumStage() { return 'read'; } }, 'GRANT_REQUEST_INVALID'],
    ];
    for (const [request, reason] of cases) assert.deepEqual(resolveAgentCapabilityGrant(MANIFEST, request), { ok: false, reason });
});
test('revalidation discards caller ownership and returns a fresh snapshot', () => {
    const issued = resolveAgentCapabilityGrant(MANIFEST, { capabilityId: AVAILABLE.id, maximumStage: 'read' });
    assert.equal(issued.ok, true);
    if (!issued.ok) return;
    const candidate = JSON.parse(JSON.stringify(issued.grant));
    const current = revalidateAgentCapabilityGrant(MANIFEST, candidate);
    assert.equal(current.ok, true);
    if (!current.ok) return;
    assert.notEqual(current.grant, candidate);
    candidate.requiredContext.push('all_records'); assert.deepEqual(revalidateAgentCapabilityGrant(MANIFEST, candidate), { ok: false, reason: 'GRANT_SNAPSHOT_MISMATCH' });
    candidate.requiredContext = Object.assign(new Array(1), { extra: 'x' }); assert.deepEqual(revalidateAgentCapabilityGrant(MANIFEST, candidate), { ok: false, reason: 'GRANT_SNAPSHOT_INVALID' }); candidate.requiredContext = ['selected_patient']; Object.defineProperty(candidate, 'egress', { enumerable: true, get() { return 'none'; } }); assert.deepEqual(revalidateAgentCapabilityGrant(MANIFEST, candidate), { ok: false, reason: 'GRANT_SNAPSHOT_INVALID' });
});
