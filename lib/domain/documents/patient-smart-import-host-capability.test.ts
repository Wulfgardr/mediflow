/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { SmartImportProjection } from '../../smart-import-projection';
import { localProviderRegistry, type LocalProviderResolution } from '../../ai-providers/registry';
import { routeHostResolvedCandidateCapability } from '../../ai-providers/fabric/candidate-router';
import type { ProviderLifecycleRead } from '../../ai-providers/fabric/provider-lifecycle-service';
import { createPatientSmartImportHostCapability } from './patient-smart-import-host-capability';
const HANDLE = `prj_${'1'.repeat(32)}`;
const REQUEST_ID = 'request.synthetic.0001';
const projection: SmartImportProjection = Object.freeze({
    schemaVersion: 'mediflow.smart-import.projection.v1', capability: 'smart_import',
    patientRef: 'patient.synthetic.0001', selectionEpoch: 2, patientRevision: 3, sourceRevision: 4,
    capturedAt: '2026-08-22T16:00:00.000Z', currentDiagnoses: Object.freeze([]),
    currentActiveTherapies: Object.freeze([]), therapyCandidateHints: Object.freeze([]),
    sources: Object.freeze([{ id: 'source.synthetic.0001', kind: 'clinical-entry' as const, label: 'Fonte sintetica',
        date: null, content: 'synthetic projection marker' }]),
});
const lifecycleRecord: Extract<ProviderLifecycleRead, { status: 'available' }>['record'] = Object.freeze({
    schemaVersion: 'mediflow.ai.provider-lifecycle-record.v1',
    lifecycle: Object.freeze({ schemaVersion: 'mediflow.ai.provider-lifecycle.v1', provider: 'ollama',
        credentialClass: 'local_model', status: 'available_unqualified' }),
    actorClass: 'host_service', actorRef: `actor_${'a'.repeat(32)}`, version: 1,
    hostTimestamp: '2026-08-22T15:59:00.000Z', receiptRef: `receipt_${'b'.repeat(32)}`,
});
const RESPONSE = JSON.stringify({
    schemaVersion: 'mediflow.ai.extract.v1', task: 'smart_import', summary: 'Proposta sintetica',
    ignoredRaw: 'raw-provider-marker', data: { diagnoses: [], therapies: [], servicePrescriptions: [] },
});
function resolution(chat: LocalProviderResolution['adapter']['chat']): LocalProviderResolution {
    const base = localProviderRegistry.resolve({ task: 'clinical', models: { clinical: 'synthetic-local-model' },
        endpoint: 'http://127.0.0.1:11434', chatTimeoutMs: 1_000 });
    return { ...base, adapter: Object.freeze({
        id: base.adapter.id, kind: base.adapter.kind, capabilities: base.adapter.capabilities,
        getBaseUrl: () => base.adapter.getBaseUrl(), getModel: () => base.adapter.getModel(), chat,
        listModels: async () => [],
    }) };
}
type Stop = 'kill' | 'broker' | 'lifecycle' | 'binding' | 'readiness' | 'router' | 'chat' | 'parse' | 'source';
function stoppedCapability(stop: Stop, calls: string[]) {
    const binding = resolution(async () => {
        calls.push('chat');
        if (stop === 'chat') throw new Error('synthetic provider marker');
        return { content: stop === 'parse' ? 'synthetic invalid response' : RESPONSE,
            stats: { latency: 1, tokensIn: 2, tokensOut: 3 } };
    });
    const record = stop === 'router' ? { ...lifecycleRecord,
        lifecycle: { ...lifecycleRecord.lifecycle, provider: 'other_provider' } } : lifecycleRecord;
    return createPatientSmartImportHostCapability({
        killSwitch: { read: async () => { calls.push('kill'); return stop === 'kill'
            ? { status: 'denied', code: 'disabled' } : { status: 'enabled' }; } },
        broker: { consume: () => { calls.push('broker'); if (stop === 'broker') throw new Error('synthetic'); return projection; } },
        lifecycle: { read: () => { calls.push('lifecycle'); return stop === 'lifecycle'
            ? { status: 'denied', reason: 'missing' } : { status: 'available', record }; } },
        binding: { readClinical: async () => { calls.push('binding'); return stop === 'binding'
            ? { status: 'denied', code: 'settings_unavailable', resolution: null } : { status: 'available', resolution: binding }; } },
        readiness: { observeClinical: async () => { calls.push('readiness'); return stop === 'readiness'
            ? { status: 'denied', code: 'provider_unready', observation: { venue: 'local_process', state: 'offline', reason: 'daemon_unreachable' } }
            : { status: 'available', code: null, observation: { venue: 'local_process', state: 'available', reason: null } }; } },
        route: (input, lifecycle) => { calls.push('router'); return routeHostResolvedCandidateCapability(input, lifecycle); },
        sources: { clock: () => '2026-08-22T16:00:01.000Z',
            entropy: () => stop === 'source' ? new Uint8Array(0) : new Uint8Array(16).fill(7) },
    });
}

test('returns one frozen review-only proposal after the fixed host pipeline', async () => {
    const calls = { kill: 0, broker: 0, lifecycle: 0, binding: 0, readiness: 0, router: 0, chat: 0, clock: 0, entropy: 0 };
    const binding = resolution(async (_messages, _signal, _maxTokens, options) => {
        calls.chat += 1;
        assert.deepEqual(options, { responseFormat: 'json' });
        return { content: RESPONSE, stats: { latency: 1, tokensIn: 2, tokensOut: 3 } };
    });
    const capability = createPatientSmartImportHostCapability({
        killSwitch: { read: async () => { calls.kill += 1; return { status: 'enabled' }; } },
        broker: { consume: () => { calls.broker += 1; return projection; } },
        lifecycle: { read: () => { calls.lifecycle += 1; return { status: 'available', record: lifecycleRecord }; } },
        binding: { readClinical: async () => { calls.binding += 1; return { status: 'available', resolution: binding }; } },
        readiness: { observeClinical: async () => { calls.readiness += 1; return { status: 'available', code: null,
            observation: Object.freeze({ venue: 'local_process', state: 'available', reason: null }) }; } },
        route: (input, lifecycle) => { calls.router += 1; return routeHostResolvedCandidateCapability(input, lifecycle); },
        sources: {
            clock: () => { calls.clock += 1; return '2026-08-22T16:00:01.000Z'; },
            entropy: () => { calls.entropy += 1; return new Uint8Array(16).fill(7); },
        },
    });
    const result = await capability.preview({ handle: HANDLE, requestId: REQUEST_ID });
    assert.equal(result.status, 'available');
    assert.equal(result.proposal?.summary, 'Proposta sintetica');
    assert.match(result.reviewRef ?? '', /^review_[0-9a-f]{32}$/u);
    assert.deepEqual(calls, { kill: 1, broker: 1, lifecycle: 1, binding: 1, readiness: 1, router: 1, chat: 1, clock: 1, entropy: 1 });
    assert.equal(result.writesPerformed, 0);
    assert.equal(result.apply, 'denied');
    assert.equal(Object.isFrozen(result), true);
    const serialized = JSON.stringify(result);
    for (const forbidden of [HANDLE, projection.patientRef, 'synthetic projection marker', 'raw-provider-marker', 'tokensIn', 'actor_']) {
        assert.equal(serialized.includes(forbidden), false);
    }
});

test('fails closed at every pre-invoke gate and rejects non-exact caller input', async () => {
    const stages = [['kill', 'kill_switch_disabled'], ['broker', 'projection_unavailable'],
        ['lifecycle', 'lifecycle_missing'], ['binding', 'provider_binding_denied'],
        ['readiness', 'provider_unready'], ['router', 'fabric_denied']] as const;
    const order = ['kill', 'broker', 'lifecycle', 'binding', 'readiness', 'router'];
    for (const [stage, code] of stages) {
        const calls: string[] = [];
        const result = await stoppedCapability(stage, calls).preview({ handle: HANDLE, requestId: REQUEST_ID });
        assert.deepEqual(result, { writesPerformed: 0, apply: 'denied', status: 'denied', code,
            proposal: null, receipt: null, provenance: null, reviewRef: null });
        assert.deepEqual(calls, order.slice(0, order.indexOf(stage) + 1));
    }
    const accessor = Object.defineProperty({ handle: HANDLE }, 'requestId', {
        enumerable: true, get: () => { throw new Error('synthetic accessor marker'); },
    });
    const inherited = Object.assign(Object.create({ inherited: true }), { handle: HANDLE, requestId: REQUEST_ID });
    for (const caller of [{ handle: HANDLE, requestId: REQUEST_ID, model: 'caller-model' }, accessor, inherited]) {
        const calls: string[] = [];
        const result = await stoppedCapability('kill', calls).preview(caller as never);
        assert.equal(result.code, 'input_invalid'); assert.deepEqual(calls, []);
    }
});

test('uses failed only after chat and retains only PHI-safe routing evidence', async () => {
    for (const [stage, code] of [['chat', 'provider_failed'], ['parse', 'proposal_invalid'], ['source', 'source_invalid']] as const) {
        const calls: string[] = [];
        const result = await stoppedCapability(stage, calls).preview({ handle: HANDLE, requestId: REQUEST_ID });
        assert.equal(result.status, 'failed'); assert.equal(result.code, code); assert.equal(calls.at(-1), 'chat');
        assert.equal(result.proposal, null); assert.equal(result.reviewRef, null);
        assert.notEqual(result.receipt, null); assert.notEqual(result.provenance, null);
        assert.equal(JSON.stringify(result).includes('synthetic provider marker'), false);
    }
});
