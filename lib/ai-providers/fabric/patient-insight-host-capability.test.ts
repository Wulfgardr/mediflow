/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { localProviderRegistry, type LocalProviderResolution } from '../registry';
import { routeHostResolvedCandidateCapability } from './candidate-router';
import type { ProviderLifecycleRead } from './provider-lifecycle-service';
import { createPatientInsightHostCapability } from './patient-insight-host-capability.ts';

const requestId = 'request.patient-insight.synthetic.0001';
const generatedAt = '2026-09-01T10:00:01.000Z';
const projection = Object.freeze({
    schemaVersion: 'mediflow.patient-insight.projection.v1' as const,
    clinicalFocus: 'Synthetic follow-up',
    activeConditions: Object.freeze(['Synthetic condition']),
    currentTherapies: Object.freeze(['Synthetic therapy']),
    recentClinicalEvents: Object.freeze(['Synthetic review']),
});
const currentness = Object.freeze({
    selectionEpoch: 7, patientRevision: 4, projectionDigest: `sha256_${'a'.repeat(64)}`,
    capturedAt: '2026-09-01T10:00:00.000Z', verifiedAt: generatedAt,
});
const lifecycleRecord: Extract<ProviderLifecycleRead, { status: 'available' }>['record'] = Object.freeze({
    schemaVersion: 'mediflow.ai.provider-lifecycle-record.v1',
    lifecycle: Object.freeze({ schemaVersion: 'mediflow.ai.provider-lifecycle.v1', provider: 'ollama', credentialClass: 'local_model', status: 'available_unqualified' }),
    actorClass: 'host_service', actorRef: `actor_${'a'.repeat(32)}`, version: 1,
    hostTimestamp: '2026-09-01T09:59:00.000Z', receiptRef: `receipt_${'b'.repeat(32)}`,
});
const response = JSON.stringify({
    schemaVersion: 'mediflow.ai.extract.v1', task: 'patient_insight', summary: 'Synthetic summary [S1]',
    ignoredRaw: 'raw-provider-marker', data: { currentState: ['Synthetic state [S1]'], alerts: [], nextSteps: ['Synthetic review [S4]'], gaps: [] },
});

function resolution(chat: LocalProviderResolution['adapter']['chat']): LocalProviderResolution {
    const base = localProviderRegistry.resolve({ task: 'clinical', models: { clinical: 'synthetic-local-model' }, endpoint: 'http://127.0.0.1:11434', chatTimeoutMs: 1_000 });
    return { ...base, adapter: Object.freeze({
        id: base.adapter.id, kind: base.adapter.kind, capabilities: base.adapter.capabilities,
        getBaseUrl: () => base.adapter.getBaseUrl(), getModel: () => base.adapter.getModel(), chat, listModels: async () => [],
    }) };
}

function capability(overrides: Readonly<{ response?: string; verify?: () => boolean }> = {}) {
    const calls: string[] = [];
    const provider = { prompt: '', maxTokens: 0, options: undefined as unknown };
    const binding = resolution(async (messages, _signal, maxTokens, options) => {
        calls.push('chat');
        provider.prompt = typeof messages[0].content === 'string' ? messages[0].content : JSON.stringify(messages[0].content);
        provider.maxTokens = maxTokens ?? 0; provider.options = options;
        return { content: overrides.response ?? response, stats: { latency: 1, tokensIn: 2, tokensOut: 3 } };
    });
    let checks = 0;
    return {
        calls,
        provider,
        checks: () => checks,
        value: createPatientInsightHostCapability({
            killSwitch: { read: async () => { calls.push('kill'); return { status: 'enabled' as const }; } },
            currentness: { verify: () => { calls.push('currentness'); checks += 1; return overrides.verify?.() ?? true; } },
            lifecycle: { read: () => { calls.push('lifecycle'); return { status: 'available' as const, record: lifecycleRecord }; } },
            binding: { readClinical: async () => { calls.push('binding'); return { status: 'available' as const, resolution: binding }; } },
            readiness: { observeClinical: async () => { calls.push('readiness'); return { status: 'available' as const, code: null, observation: Object.freeze({ venue: 'local_process' as const, state: 'available' as const, reason: null }) }; } },
            route: (input, lifecycle) => { calls.push('router'); return routeHostResolvedCandidateCapability(input, lifecycle); },
            sources: { clock: () => { calls.push('clock'); return generatedAt; }, entropy: () => { calls.push('entropy'); return new Uint8Array(16).fill(7); } },
        }),
    };
}

test('returns a typed review-only proposal after the fixed Fabric pipeline and two currentness checks', async () => {
    const fixture = capability();
    const result = await fixture.value.preview({ requestId, projection, currentness });
    assert.equal(result.status, 'available');
    if (result.status !== 'available') return;
    assert.equal(fixture.provider.maxTokens, 900); assert.deepEqual(fixture.provider.options, { responseFormat: 'json' });
    assert.match(fixture.provider.prompt, /\[S1\] Synthetic follow-up/u);
    assert.match(fixture.provider.prompt, /\[S4\] Evento clinico recente: Synthetic review/u);
    assert.doesNotMatch(fixture.provider.prompt, /patient\.synthetic|ambulatory\.synthetic/u);
    assert.deepEqual(result.proposal, {
        schemaVersion: 'mediflow.patient-insight.review-proposal.v2', reviewOnly: true,
        summary: 'Synthetic summary [S1]', currentState: ['Synthetic state [S1]'], alerts: [], nextSteps: ['Synthetic review [S4]'], gaps: [],
        generatedAt, currentness,
    });
    assert.equal(fixture.checks(), 2);
    assert.deepEqual(fixture.calls, ['kill', 'currentness', 'lifecycle', 'binding', 'readiness', 'router', 'clock', 'entropy', 'chat', 'currentness']);
    assert.equal(result.writesPerformed, 0); assert.equal(result.apply, 'denied');
    assert.match(result.reviewRef, /^review_[0-9a-f]{32}$/u);
    const serialized = JSON.stringify(result);
    for (const forbidden of ['raw-provider-marker', 'tokensIn', 'actor_', 'Synthetic condition', 'Synthetic therapy']) assert.doesNotMatch(serialized, new RegExp(forbidden, 'u'));
});

test('fails closed before Fabric for stale or non-exact input and after Fabric for stale or invalid output', async () => {
    let current = false;
    const staleBefore = capability({ verify: () => current });
    assert.deepEqual(await staleBefore.value.preview({ requestId, projection, currentness }), {
        writesPerformed: 0, apply: 'denied', status: 'denied', code: 'source_stale', proposal: null, receipt: null, provenance: null, reviewRef: null,
    });
    assert.deepEqual(staleBefore.calls, ['kill', 'currentness']);

    const staleAfter = capability({ verify: () => { current = !current; return current; } });
    const staleResult = await staleAfter.value.preview({ requestId, projection, currentness });
    assert.equal(staleResult.status, 'failed'); assert.equal(staleResult.code, 'source_stale');
    assert.notEqual(staleResult.receipt, null); assert.notEqual(staleResult.provenance, null);

    const invalidOutput = capability({ response: '{"task":"wrong"}' });
    const invalidResult = await invalidOutput.value.preview({ requestId, projection, currentness });
    assert.equal(invalidResult.status, 'failed'); assert.equal(invalidResult.code, 'proposal_invalid');

    const inventedSource = capability({ response: JSON.stringify({
        schemaVersion: 'mediflow.ai.extract.v1', task: 'patient_insight', summary: 'Unsupported [S99]',
        data: { currentState: ['Unsupported [S99]'], alerts: [], nextSteps: [], gaps: [] },
    }) });
    const inventedResult = await inventedSource.value.preview({ requestId, projection, currentness });
    assert.equal(inventedResult.status, 'failed'); assert.equal(inventedResult.code, 'proposal_invalid');

    for (const invalid of [
        { requestId, projection, currentness, prompt: 'caller prompt' },
        { requestId, projection: { ...projection, patientId: 'patient.synthetic.01' }, currentness },
        { requestId, projection, currentness: { ...currentness, patientRevision: 0 } },
    ]) {
        const fixture = capability(); const result = await fixture.value.preview(invalid);
        assert.equal(result.status, 'denied'); assert.equal(result.code, 'input_invalid'); assert.deepEqual(fixture.calls, []);
    }
});
