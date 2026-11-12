import assert from 'node:assert/strict';
import test from 'node:test';
import type { SmartImportProjection } from '../../smart-import-projection';
import { localProviderRegistry, type LocalProviderResolution } from '../../ai-providers/registry';
import { routeHostResolvedCandidateCapability } from '../../ai-providers/fabric/candidate-router';
import type { ProviderLifecycleRead } from '../../ai-providers/fabric/provider-lifecycle-service';
import { createPatientSmartImportHostCapability } from './patient-smart-import-host-capability';
import {
    buildPatientSmartImportCapabilityPrompt,
    parsePatientSmartImportCapabilityProposal,
    PatientSmartImportCapabilityError,
    SMART_IMPORT_RESPONSE_TOKENS_FLOOR,
    smartImportResponseTokenLimit,
} from './patient-smart-import-capability-contract';
import { validateGenerativeJson } from '../../ai-providers/generative-json-validation';
import { buildOllamaChatPayload } from '../../ai-providers/ollama';
import type { AIChatOptions } from '../../ai-providers/provider';
import { fromJSONSchema } from 'zod';
import MEASURED from './fixtures/smart-import-measured-persona000002.json' with { type: 'json' };
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
    data: { diagnoses: [], therapies: [], servicePrescriptions: [] },
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
type Stop = 'valid' | 'kill' | 'kill_unavailable' | 'broker' | 'lifecycle' | 'lifecycle_corrupt'
    | 'lifecycle_unavailable' | 'binding' | 'readiness' | 'model' | 'router' | 'chat' | 'parse' | 'source';
function stoppedCapability(stop: Stop, calls: string[], response = RESPONSE) {
    const binding = resolution(async () => {
        calls.push('chat');
        if (stop === 'chat') throw new Error('synthetic provider marker');
        return { content: stop === 'parse' ? 'synthetic invalid response' : response,
            stats: { latency: 1, tokensIn: 2, tokensOut: 3 } };
    });
    const record = stop === 'router' ? { ...lifecycleRecord,
        lifecycle: { ...lifecycleRecord.lifecycle, provider: 'other_provider' } } : lifecycleRecord;
    return createPatientSmartImportHostCapability({
        killSwitch: { read: async () => { calls.push('kill'); return stop === 'kill' || stop === 'kill_unavailable'
            ? { status: 'denied', code: stop === 'kill' ? 'disabled' : 'unavailable' } : { status: 'enabled' }; } },
        broker: { consume: () => { calls.push('broker'); if (stop === 'broker') throw new Error('synthetic'); return projection; } },
        lifecycle: { read: () => { calls.push('lifecycle'); return stop.startsWith('lifecycle')
            ? { status: 'denied', reason: stop === 'lifecycle_corrupt' ? 'corrupt'
                : stop === 'lifecycle_unavailable' ? 'unavailable' : 'missing' } : { status: 'available', record }; } },
        binding: { readClinical: async () => { calls.push('binding'); return stop === 'binding'
            ? { status: 'denied', code: 'settings_unavailable', resolution: null } : { status: 'available', resolution: binding }; } },
        readiness: { observeClinical: async () => { calls.push('readiness'); return stop === 'readiness' || stop === 'model'
            ? { status: 'denied', code: stop === 'model' ? 'model_unavailable' : 'provider_unready', observation: stop === 'model'
                ? { venue: 'local_process', state: 'degraded', reason: null }
                : { venue: 'local_process', state: 'offline', reason: 'daemon_unreachable' } }
            : { status: 'available', code: null, observation: { venue: 'local_process', state: 'available', reason: null } }; } },
        route: (input, lifecycle) => { calls.push('router'); return routeHostResolvedCandidateCapability(input, lifecycle); },
        sources: { clock: () => { calls.push('clock'); return '2026-08-22T16:00:01.000Z'; },
            entropy: () => { calls.push('entropy'); return stop === 'source' ? new Uint8Array(0) : new Uint8Array(16).fill(7); } },
    });
}

test('returns one frozen review-only proposal after the fixed host pipeline', async () => {
    const calls = { kill: 0, broker: 0, lifecycle: 0, binding: 0, readiness: 0, router: 0, chat: 0, clock: 0, entropy: 0 };
    const binding = resolution(async (_messages, _signal, maxTokens, options) => {
        calls.chat += 1;
        // Prompt corto: vale il minimo (ADR 0012).
        assert.equal(maxTokens, SMART_IMPORT_RESPONSE_TOKENS_FLOOR);
        assert.deepEqual(options, { responseFormat: 'smart_import', sourceIds: ['source.synthetic.0001'] });
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
    assert.deepEqual(calls, { kill: 2, broker: 1, lifecycle: 1, binding: 1, readiness: 1, router: 1, chat: 1, clock: 1, entropy: 1 });
    assert.equal(result.writesPerformed, 0);
    assert.equal(result.apply, 'denied');
    assert.equal(Object.isFrozen(result), true);
    const serialized = JSON.stringify(result);
    for (const forbidden of [HANDLE, projection.patientRef, 'synthetic projection marker', 'raw-provider-marker', 'tokensIn', 'actor_']) {
        assert.equal(serialized.includes(forbidden), false);
    }
});

test('fails closed at every pre-invoke gate and rejects non-exact caller input', async () => {
    const stages = [['kill', 'kill_switch_disabled', 'kill'], ['kill_unavailable', 'kill_switch_unavailable', 'kill'],
        ['broker', 'projection_unavailable', 'broker'], ['lifecycle', 'lifecycle_missing', 'lifecycle'],
        ['lifecycle_corrupt', 'lifecycle_corrupt', 'lifecycle'], ['lifecycle_unavailable', 'lifecycle_unavailable', 'lifecycle'],
        ['binding', 'provider_binding_denied', 'binding'], ['readiness', 'provider_unready', 'readiness'],
        ['model', 'model_unavailable', 'readiness'], ['router', 'fabric_denied', 'router'], ['source', 'source_invalid', 'entropy']] as const;
    const order = ['kill', 'broker', 'lifecycle', 'binding', 'readiness', 'router', 'clock', 'entropy'];
    for (const [stage, code, gate] of stages) {
        const calls: string[] = [];
        const result = await stoppedCapability(stage, calls).preview({ handle: HANDLE, requestId: REQUEST_ID });
        assert.deepEqual(result, { writesPerformed: 0, apply: 'denied', status: 'denied', code,
            proposal: null, receipt: null, provenance: null, reviewRef: null });
        assert.deepEqual(calls, order.slice(0, order.indexOf(gate) + 1));
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
    for (const [stage, code] of [['chat', 'provider_failed'], ['parse', 'proposal_invalid']] as const) {
        const calls: string[] = [];
        const result = await stoppedCapability(stage, calls).preview({ handle: HANDLE, requestId: REQUEST_ID });
        assert.equal(result.status, 'failed'); assert.equal(result.code, code); assert.equal(calls.at(-1), 'chat');
        assert.equal(result.proposal, null); assert.equal(result.reviewRef, null);
        assert.notEqual(result.receipt, null); assert.notEqual(result.provenance, null);
        assert.equal(JSON.stringify(result).includes('synthetic provider marker'), false);
    }
});

test('rejects wrong-task and ambiguous envelopes through the current host preview without an apply', async () => {
    for (const content of [
        RESPONSE.replace('"task":"smart_import"', '"task":"document_synthesis"'),
        RESPONSE + RESPONSE.replace('"task":"smart_import"', '"task":"patient_insight"'),
    ]) {
        const calls: string[] = [];
        const result = await stoppedCapability('valid', calls, content).preview({ handle: HANDLE, requestId: REQUEST_ID });
        assert.equal(result.code, 'proposal_invalid');
        assert.equal(calls.at(-1), 'chat');
        assert.equal(result.writesPerformed, 0);
        assert.equal(result.apply, 'denied');
        assert.equal(result.proposal, null);
    }
});

// Secondo tentativo sul modello locale, come il Quadro paziente (#891): stesso prompt,
// al massimo due chiamate, mai con un fornitore in rete, mai dopo il ritiro del consenso.
type Answer = string | Readonly<{ content: string; truncated: true }> | Error;
function retrying(answers: readonly Answer[], options: Readonly<{ enabled?: (read: number) => boolean; venue?: 'home_base' }> = {}) {
    const prompts: string[] = [];
    let kills = 0;
    const binding = resolution(async (messages) => {
        prompts.push(String(messages[0]!.content));
        const answer = answers[Math.min(prompts.length - 1, answers.length - 1)]!;
        if (answer instanceof Error) throw answer;
        if (typeof answer !== 'string') return { content: answer.content, stats: { latency: 1, tokensIn: 2, tokensOut: 1_100, truncated: true } };
        return { content: answer, stats: { latency: 1, tokensIn: 2, tokensOut: 3 } };
    });
    const capability = createPatientSmartImportHostCapability({
        killSwitch: { read: async () => { kills += 1; return options.enabled?.(kills) === false ? { status: 'denied', code: 'disabled' } : { status: 'enabled' }; } },
        broker: { consume: () => projection },
        lifecycle: { read: () => ({ status: 'available', record: lifecycleRecord }) },
        binding: { readClinical: async () => ({ status: 'available', resolution: binding }) },
        readiness: { observeClinical: async () => ({ status: 'available', code: null, observation: { venue: 'local_process', state: 'available', reason: null } }) },
        route: (input, lifecycle) => {
            const routed = routeHostResolvedCandidateCapability(input, lifecycle);
            if (!options.venue || !routed.resolution || !routed.decision.receipt) return routed;
            // Una ricevuta con un luogo di esecuzione in rete: il secondo tentativo non deve partire.
            const receipt = Object.freeze({ ...routed.decision.receipt, venue: options.venue });
            return { ...routed, decision: Object.freeze({ ...routed.decision, receipt }), resolution: Object.freeze({ ...routed.resolution, receipt }) };
        },
        sources: { clock: () => '2026-08-22T16:00:01.000Z', entropy: () => new Uint8Array(16).fill(7) },
    });
    return { capability, prompts, kills: () => kills };
}
const MALFORMED = '{"schemaVersion":"mediflow.ai.extract.v1","task":"smart_import","summary":';
const CUT = Object.freeze({ content: RESPONSE, truncated: true as const });

test('local: an invalid first answer is retried once with the same prompt and the valid second answer is published', async () => {
    const fixture = retrying([MALFORMED, RESPONSE]);
    const result = await fixture.capability.preview({ handle: HANDLE, requestId: REQUEST_ID });
    assert.equal(result.status, 'available'); assert.equal(result.writesPerformed, 0);
    assert.equal(fixture.prompts.length, 2); assert.equal(fixture.prompts[0], fixture.prompts[1]);
    if (result.status === 'available') {
        assert.equal(result.proposal.summary, 'Proposta sintetica');
        assert.equal(result.receipt.venue, 'local_process');
        assert.deepEqual(Object.keys(result).sort(), ['apply', 'code', 'proposal', 'provenance', 'receipt', 'reviewRef', 'status', 'writesPerformed']);
    }
});

test('local: an answer cut at the token ceiling is not published even when it parses, and is retried once', async () => {
    const fixture = retrying([CUT, RESPONSE]);
    const result = await fixture.capability.preview({ handle: HANDLE, requestId: REQUEST_ID });
    assert.equal(result.status, 'available'); assert.equal(fixture.prompts.length, 2);
});

test('local: two invalid answers keep proposal_invalid after two calls, never three', async () => {
    const fixture = retrying([CUT, MALFORMED, RESPONSE]);
    const result = await fixture.capability.preview({ handle: HANDLE, requestId: REQUEST_ID });
    assert.equal(result.status, 'failed'); assert.equal(result.code, 'proposal_invalid'); assert.equal(result.proposal, null);
    assert.notEqual(result.receipt, null); assert.notEqual(result.provenance, null);
    assert.equal(fixture.prompts.length, 2);
});

test('local: a provider failure is not retried', async () => {
    const fixture = retrying([new Error('synthetic provider marker'), RESPONSE]);
    const result = await fixture.capability.preview({ handle: HANDLE, requestId: REQUEST_ID });
    assert.equal(result.code, 'provider_failed'); assert.equal(fixture.prompts.length, 1);
});

test('local: withdrawing consent between the attempts stops before the second call and publishes nothing', async () => {
    // Lettura 1: ammissione; lettura 2: fra i due tentativi.
    const fixture = retrying([MALFORMED, RESPONSE], { enabled: (read) => read < 2 });
    const result = await fixture.capability.preview({ handle: HANDLE, requestId: REQUEST_ID });
    assert.equal(result.status, 'denied'); assert.equal(result.code, 'kill_switch_disabled'); assert.equal(result.proposal, null);
    assert.equal(fixture.prompts.length, 1); assert.equal(fixture.kills(), 2);
});

test('network venue: an invalid answer is not retried (no second egress)', async () => {
    const fixture = retrying([MALFORMED, RESPONSE], { venue: 'home_base' });
    const result = await fixture.capability.preview({ handle: HANDLE, requestId: REQUEST_ID });
    assert.equal(result.status, 'failed'); assert.equal(result.code, 'proposal_invalid');
    assert.equal(result.receipt?.venue, 'home_base'); assert.equal(fixture.prompts.length, 1);
});

test('local: an answer still cut at the token ceiling on the last attempt fails with response_truncated, not proposal_invalid', async () => {
    for (const answers of [[CUT, CUT, RESPONSE], [MALFORMED, CUT, RESPONSE]]) {
        const fixture = retrying(answers);
        const result = await fixture.capability.preview({ handle: HANDLE, requestId: REQUEST_ID });
        assert.equal(result.status, 'failed'); assert.equal(result.code, 'response_truncated'); assert.equal(result.proposal, null);
        assert.notEqual(result.receipt, null); assert.equal(fixture.prompts.length, 2);
    }
});

// ADR 0012, misura dell'11/11/2026: proiezione e risposte reali di Persona000002 (archivio sintetico).
const measuredProjection = MEASURED.projection as unknown as SmartImportProjection;
const MEASURED_AT = '2026-11-11T03:00:00.000Z';
function rejectsSource(response: string) {
    assert.throws(() => parsePatientSmartImportCapabilityProposal(response, measuredProjection, MEASURED_AT),
        (error) => error instanceof PatientSmartImportCapabilityError && error.code === 'source_binding_invalid');
}

test('a real answer whose items carry no sourceId is still refused by the host check', () => {
    const answer = MEASURED.itemsWithoutSource.content;
    const items = JSON.parse(answer).data.servicePrescriptions.flatMap((service: { items?: object[] }) => service.items ?? []);
    assert.ok(items.length > 0 && items.every((item: object) => !('sourceId' in item)));
    rejectsSource(answer);
    // Lo schema trasmesso al modello ora la pretende anche lui.
    assert.throws(() => validateGenerativeJson('smart_import', answer));
});

/*
 * P1 (ADR 0012, «Fonti reali nello schema»): risposta reale scartata nella misura dopo #936. Le due
 * diagnosi gia' in scheda (E11.9, I10) citano come fonte la sezione del contesto, che non e' una fonte.
 */
test('a real answer citing the record section as source for a coded diagnosis is still refused by the host check', () => {
    const answer = MEASURED.inventedSource.content;
    const ids = new Set(measuredProjection.sources.map(({ id }) => id));
    const diagnoses: Array<{ sourceId: string }> = JSON.parse(answer).data.diagnoses;
    assert.deepEqual(diagnoses.map(({ sourceId }) => sourceId), ['currentDiagnoses.system.E11.9', 'currentDiagnoses.system.I10']);
    assert.ok(diagnoses.every(({ sourceId }) => !ids.has(sourceId)));
    assert.deepEqual(measuredProjection.currentDiagnoses.map(({ code }) => code), ['E11.9', 'I10']);
    rejectsSource(answer);
});

function sourceIdSchemas(node: unknown, found: unknown[] = []): unknown[] {
    if (Array.isArray(node)) { for (const value of node) sourceIdSchemas(value, found); return found; }
    if (!node || typeof node !== 'object') return found;
    for (const [key, value] of Object.entries(node)) {
        if (key === 'properties' && value && typeof value === 'object' && 'sourceId' in value) found.push((value as Record<string, unknown>).sourceId);
        sourceIdSchemas(value, found);
    }
    return found;
}

/*
 * P2 (ADR 0012): lo schema che l'host manda a Ollama per questa richiesta ammette come sourceId solo
 * gli id delle fonti del prompt, su diagnosi, terapie, prestazioni e items. Con Ollama lo schema vincola
 * la generazione: la risposta reale con la fonte inventata non e' piu' generabile, la risposta valida
 * piu' lunga si'. Il prompt dice che le diagnosi e le terapie in scheda non sono fonti.
 */
test('the schema sent to the model for a request admits only the ids of the sources in that prompt', async () => {
    const sent: Array<Readonly<{ maxTokens: number | undefined; options: AIChatOptions | undefined }>> = [];
    const binding = resolution(async (_messages, _signal, maxTokens, options) => {
        sent.push({ maxTokens, options });
        return { content: MEASURED.longestAccepted.content, stats: { latency: 1, tokensIn: 2, tokensOut: MEASURED.longestAccepted.evalCount } };
    });
    const capability = createPatientSmartImportHostCapability({
        killSwitch: { read: async () => ({ status: 'enabled' }) },
        broker: { consume: () => measuredProjection },
        lifecycle: { read: () => ({ status: 'available', record: lifecycleRecord }) },
        binding: { readClinical: async () => ({ status: 'available', resolution: binding }) },
        readiness: { observeClinical: async () => ({ status: 'available', code: null, observation: { venue: 'local_process', state: 'available', reason: null } }) },
        route: routeHostResolvedCandidateCapability,
        sources: { clock: () => MEASURED_AT, entropy: () => new Uint8Array(16).fill(7) },
    });
    const result = await capability.preview({ handle: HANDLE, requestId: REQUEST_ID });
    assert.equal(result.status, 'available');
    assert.equal(sent.length, 1);
    const format = buildOllamaChatPayload('synthetic', [], sent[0]!.maxTokens, sent[0]!.options).format;
    const ids = measuredProjection.sources.map(({ id }) => id);
    const schemas = sourceIdSchemas(format);
    assert.equal(schemas.length, 4, 'diagnosi, terapie, prestazioni, items');
    for (const schema of schemas) assert.deepEqual(schema, { type: 'string', enum: ids }, 'sourceId e\' un enum delle fonti del prompt');
    const validator = fromJSONSchema(format as Parameters<typeof fromJSONSchema>[0]);
    assert.equal(validator.safeParse(JSON.parse(MEASURED.inventedSource.content)).success, false);
    assert.equal(validator.safeParse(JSON.parse(MEASURED.longestAccepted.content)).success, true);
    assert.match(buildPatientSmartImportCapabilityPrompt(measuredProjection),
        /- currentDiagnoses e currentActiveTherapies sono gia nella scheda: non sono fonti, non citarli come sourceId e non riproporli\n/u);
});

/* L'esempio di risposta che il prompt mostra al modello, con i segnaposto resi valori ammessi. */
function promptExample(prompt: string, sourceId: string) {
    const envelope = prompt.split('Usa esattamente questo envelope:\n')[1]!.split('\n\nRegole comuni:')[0]!;
    return JSON.parse(envelope, (key, value) => key === 'sourceId' ? sourceId
        : typeof value === 'string' && value.includes('|') ? value.split('|')[0] : value);
}

test('prompt, schema and host check ask for the same sourceId on every element, items included', () => {
    const prompt = buildPatientSmartImportCapabilityPrompt(measuredProjection);
    const sourceId = measuredProjection.sources[1]!.id;
    const example = promptExample(prompt, sourceId);
    const service = example.data.servicePrescriptions[0];
    assert.equal(service.items[0].sourceId, sourceId, 'il prompt mostra sourceId sugli items');
    // Chi segue l'esempio del prompt supera schema e controllo dell'host.
    validateGenerativeJson('smart_import', JSON.stringify(example));
    const proposal = parsePatientSmartImportCapabilityProposal(JSON.stringify(example), measuredProjection, MEASURED_AT);
    assert.equal(proposal.servicePrescriptions[0]!.items?.[0]?.sourceId, sourceId);
    // Senza sourceId su un qualunque elemento lo schema rifiuta, come il controllo dell'host.
    const elements: Array<[string, (value: typeof example) => Record<string, unknown>]> = [
        ['diagnoses', (value) => value.data.diagnoses[0]], ['therapies', (value) => value.data.therapies[0]],
        ['servicePrescriptions', (value) => value.data.servicePrescriptions[0]],
        ['servicePrescriptions.items', (value) => value.data.servicePrescriptions[0].items[0]],
    ];
    for (const [name, element] of elements) {
        const withoutSource = structuredClone(example);
        delete element(withoutSource).sourceId;
        assert.throws(() => validateGenerativeJson('smart_import', JSON.stringify(withoutSource)), `schema: ${name}`);
        rejectsSource(JSON.stringify(withoutSource));
    }
});

/*
 * P2 (ADR 0012): la risposta completa piu' lunga misurata col modello reale dopo la correzione, su
 * Persona000002. Il modello finto la taglia se il tetto e' sotto i token che ha davvero usato, come
 * fa Ollama con done_reason length. Con il tetto fisso di 1100 sarebbe stata troncata due volte.
 */
test('the response ceiling covers the longest complete answer measured with the real model', async () => {
    const longest = MEASURED.longestAccepted;
    const ceilings: number[] = [];
    const binding = resolution(async (messages, _signal, maxTokens) => {
        ceilings.push(maxTokens ?? 0);
        const truncated = (maxTokens ?? 0) < longest.evalCount;
        return { content: truncated ? longest.content.slice(0, Math.floor(longest.content.length * (maxTokens ?? 0) / longest.evalCount)) : longest.content,
            stats: { latency: 1, tokensIn: String(messages[0]!.content).length, tokensOut: truncated ? maxTokens ?? 0 : longest.evalCount, ...(truncated ? { truncated: true } : {}) } };
    });
    const capability = createPatientSmartImportHostCapability({
        killSwitch: { read: async () => ({ status: 'enabled' }) },
        broker: { consume: () => measuredProjection },
        lifecycle: { read: () => ({ status: 'available', record: lifecycleRecord }) },
        binding: { readClinical: async () => ({ status: 'available', resolution: binding }) },
        readiness: { observeClinical: async () => ({ status: 'available', code: null, observation: { venue: 'local_process', state: 'available', reason: null } }) },
        route: routeHostResolvedCandidateCapability,
        sources: { clock: () => MEASURED_AT, entropy: () => new Uint8Array(16).fill(7) },
    });
    const result = await capability.preview({ handle: HANDLE, requestId: REQUEST_ID });
    assert.equal(result.status, 'available', `tetto ${ceilings.join(', ')} per una risposta da ${longest.evalCount} token`);
    assert.equal(ceilings.length, 1);
    assert.equal(ceilings[0], smartImportResponseTokenLimit(buildPatientSmartImportCapabilityPrompt(measuredProjection)));
    assert.ok(ceilings[0]! >= longest.evalCount);
    if (result.status === 'available') assert.ok(result.proposal.servicePrescriptions.some((service) => (service.items?.length ?? 0) > 0));
});
