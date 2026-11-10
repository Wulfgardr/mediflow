/* Replay delle risposte grezze scartate nella seduta del 10/11/2026 (contesto inventato).
 * Prova che il validatore del Quadro paziente non si e' allentato: ogni risposta resta
 * scartata anche ripresentata due volte, e anche senza il segnale di troncamento. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { validateGenerativeJson } from '../generative-json-validation';
import { localProviderRegistry, type LocalProviderResolution } from '../registry';
import { routeHostResolvedCandidateCapability } from './candidate-router';
import type { ProviderLifecycleRead } from './provider-lifecycle-service';
import { createPatientInsightHostCapability } from './patient-insight-host-capability';

type Rejected = Readonly<{ source: string; cause: 'overlong' | 'truncated'; done_reason: string; content: string }>;
const fixture = JSON.parse(readFileSync(new URL('./fixtures/patient-insight-rejected-answers.json', import.meta.url), 'utf8')) as
    Readonly<{ context: string; rejected: readonly Rejected[] }>;

const lines = fixture.context.trim().split('\n').map((line) => line.replace(/^\[S\d+\] /u, ''));
const projection = Object.freeze({
    schemaVersion: 'mediflow.patient-insight.projection.v1' as const,
    clinicalFocus: lines[0],
    activeConditions: Object.freeze(lines.filter((line) => line.startsWith('Condizione attiva: ')).map((line) => line.slice('Condizione attiva: '.length))),
    currentTherapies: Object.freeze([] as string[]),
    recentClinicalEvents: Object.freeze(lines.filter((line) => line.startsWith('Evento clinico recente: ')).map((line) => line.slice('Evento clinico recente: '.length))),
});
const at = '2026-11-10T10:00:00.000Z';
const currentness = Object.freeze({ selectionEpoch: 1, patientRevision: 1, projectionDigest: `sha256_${'c'.repeat(64)}`, capturedAt: at, verifiedAt: at });
const lifecycle: Extract<ProviderLifecycleRead, { status: 'available' }>['record'] = Object.freeze({
    schemaVersion: 'mediflow.ai.provider-lifecycle-record.v1',
    lifecycle: Object.freeze({ schemaVersion: 'mediflow.ai.provider-lifecycle.v1', provider: 'ollama', credentialClass: 'local_model', status: 'available_unqualified' }),
    actorClass: 'host_service', actorRef: `actor_${'a'.repeat(32)}`, version: 1, hostTimestamp: at, receiptRef: `receipt_${'b'.repeat(32)}`,
});

function replay(content: string) {
    const prompts: string[] = [];
    const base = localProviderRegistry.resolve({ task: 'clinical', models: { clinical: 'synthetic-local-model' }, endpoint: 'http://127.0.0.1:11434', chatTimeoutMs: 1_000 });
    const binding: LocalProviderResolution = { ...base, adapter: Object.freeze({
        id: base.adapter.id, kind: base.adapter.kind, capabilities: base.adapter.capabilities,
        getBaseUrl: () => base.adapter.getBaseUrl(), getModel: () => base.adapter.getModel(), listModels: async () => [],
        chat: async (messages: Parameters<LocalProviderResolution['adapter']['chat']>[0]) => {
            prompts.push(String(messages[0].content));
            return { content, stats: { latency: 1, tokensIn: 1, tokensOut: 1 } };
        },
    }) };
    const value = createPatientInsightHostCapability({
        killSwitch: { read: async () => ({ status: 'enabled' as const }) }, currentness: { verify: () => true },
        lifecycle: { read: () => ({ status: 'available' as const, record: lifecycle }) },
        binding: { readClinical: async () => ({ status: 'available' as const, resolution: binding }) },
        readiness: { observeClinical: async () => ({ status: 'available' as const, code: null, observation: Object.freeze({ venue: 'local_process' as const, state: 'available' as const, reason: null }) }) },
        route: routeHostResolvedCandidateCapability, sources: { clock: () => at, entropy: () => new Uint8Array(16).fill(9) },
    });
    return { prompts, value };
}

test('the fixture holds the seven rejected answers of the session: five overlong, two truncated', () => {
    assert.equal(fixture.rejected.length, 7);
    assert.equal(fixture.rejected.filter((item) => item.cause === 'overlong').length, 5);
    assert.equal(fixture.rejected.filter((item) => item.cause === 'truncated').length, 2);
    assert.equal(projection.activeConditions.length + projection.recentClinicalEvents.length + 1, 10);
});

for (const item of fixture.rejected) {
    test(`replay ${item.source} (${item.cause}): the schema validator still rejects it`, () => {
        assert.throws(() => validateGenerativeJson('patient_insight', item.content));
    });
    test(`replay ${item.source} (${item.cause}): presented twice, the host still answers proposal_invalid after two calls`, async () => {
        const run = replay(item.content);
        const result = await run.value.preview({ requestId: 'request.patient-insight.replay.0001', projection, currentness });
        assert.equal(result.status, 'failed'); assert.equal(result.code, 'proposal_invalid'); assert.equal(result.proposal, null);
        assert.equal(run.prompts.length, 2);
        // Same context as the measured session: the prompt ends with the recorded source lines.
        assert.ok(run.prompts[0].endsWith(fixture.context), 'prompt context matches the recorded session');
        assert.match(run.prompts[0], /ogni stringa, summary compreso, al massimo 220 caratteri/u);
    });
}
