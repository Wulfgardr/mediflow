/* Quadro paziente in GPUI (G-5a): il corpo che GPUI costruisce passa per l'handler reale,
 * il servizio autenticato reale e la capacità host reale (broker, lease, proiezione,
 * validazione della proposta e delle citazioni [Sx]). Sessione, revisione del paziente e
 * Ollama sono doppioni dichiarati. Le risposte prodotte qui sono i file che il client Rust legge. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { buildPatientInsightPreviewRequest, parsePatientInsightPreviewRequest, parsePatientInsightPreviewWireRoot } from './ai-providers/fabric/patient-insight-preview-contract.ts';
import { createAuthenticatedPatientInsightPreviewService, createPatientInsightPreviewHttpHandler } from './ai-providers/fabric/patient-insight-authenticated-preview.ts';
import { createPatientInsightHostCapability } from './ai-providers/fabric/patient-insight-host-capability.ts';
import { routeHostResolvedCandidateCapability } from './ai-providers/fabric/candidate-router.ts';
import { createFunctionModelDispatch } from './ai-providers/fabric/function-model-dispatch.ts';
import { FUNCTION_SWITCH_KEYS, type FunctionModelSources } from './ai-providers/fabric/function-model-preferences.ts';
import type { ProviderLifecycleRead } from './ai-providers/fabric/provider-lifecycle-service.ts';
import { localProviderRegistry } from './ai-providers/registry.ts';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FIXTURES = path.join(ROOT_DIR, 'experiments/gpui-patient-pilot/transport/tests/fixtures/patient_insight');
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'));
const WRITE = process.env.MEDIFLOW_WRITE_FIXTURES !== undefined;
const MODEL = 'synthetic-patient-insight:1';
const ENDPOINT = 'http://127.0.0.1:11434';
const VERIFIED_AT = '2026-11-09T10:00:01.000Z';
const SYNTHETIC_USER = 'user.synthetic';

/* Risposta deterministica del modello finto: cita le fonti nell'ordine in cui l'host le numera. */
const MODEL_REPLY = JSON.stringify({
    schemaVersion: 'mediflow.ai.extract.v1', task: 'patient_insight',
    summary: 'Paziente con ipertensione e diabete in follow-up domiciliare. [S2, S3]',
    data: {
        currentState: ['Pressione stabile all\'ultima visita domiciliare. [S7]'],
        alerts: ['Metformina in corso: verificare la funzione renale. [S6]'],
        nextSteps: ['Ricontrollare gli esami ematici al prossimo accesso. [S9]'],
        gaps: ['Valori glicemici recenti non presenti. [DATI-INCOMPLETI]'],
    },
});

type Mode = 'valid' | 'malformed' | 'provider_failed' | 'kill_switch' | 'stale' | 'function_disabled';
const lifecycle: Extract<ProviderLifecycleRead, { status: 'available' }> = { status: 'available', record: {
    schemaVersion: 'mediflow.ai.provider-lifecycle-record.v1', lifecycle: { schemaVersion: 'mediflow.ai.provider-lifecycle.v1', provider: 'ollama', credentialClass: 'local_model', status: 'available_unqualified' },
    actorClass: 'host_service', actorRef: `actor_${'a'.repeat(32)}`, version: 1, hostTimestamp: VERIFIED_AT, receiptRef: `receipt_${'b'.repeat(32)}` } };

function route(t: TestContext, mode: Mode, revision = 3) {
    const previousFetch = globalThis.fetch;
    const descriptor = { name: MODEL, model: MODEL, size: 1234, digest: 'a'.repeat(64), details: { family: 'synthetic' } };
    const prompts: string[] = [];
    globalThis.fetch = async (input, init) => {
        const url = new URL(String(input)); assert.equal(url.origin, ENDPOINT);
        if (url.pathname === '/api/version') return Response.json({ version: '0.40.6' });
        if (url.pathname === '/api/tags' || url.pathname === '/api/ps') return Response.json({ models: [descriptor] });
        if (url.pathname === '/api/show') return Response.json({ details: descriptor.details });
        if (url.pathname === '/api/generate') return Response.json({ model: MODEL });
        assert.equal(url.pathname, '/api/chat');
        const payload = JSON.parse(String(init?.body)); prompts.push(String(payload.messages?.[0]?.content ?? ''));
        if (mode === 'provider_failed') throw new Error('Synthetic provider failure');
        return Response.json({ model: MODEL, message: { content: mode === 'malformed' ? '{"schemaVersion":"mediflow.ai.extract.v1"' : MODEL_REPLY }, prompt_eval_count: 3, eval_count: 4 });
    };
    t.after(() => { globalThis.fetch = previousFetch; });

    const settings: FunctionModelSources = { settings: { aiProvider: 'ollama', aiUrl: ENDPOINT, aiModel_clinical: MODEL,
        ...Object.fromEntries(Object.values(FUNCTION_SWITCH_KEYS).map(key => [key, mode === 'function_disabled' ? 'disabled' : 'enabled'])) },
    ollamaLifecycle: { status: 'available', record: { version: 1, lifecycle: { provider: 'ollama', credentialClass: 'local_model', status: 'available_unqualified' } } } };
    const lease = Object.freeze({ sessionRef: `ssr_${'1'.repeat(32)}`, selectionEpoch: 7, patientRef: `ptr_${'2'.repeat(32)}`,
        ambulatoryRef: `abr_${'3'.repeat(32)}`, leaseRef: `lsr_${'4'.repeat(32)}`, expiresAt: Date.parse('2026-11-09T11:00:00.000Z') });
    const session = Object.freeze({ id: '1'.repeat(64), userId: SYNTHETIC_USER, username: SYNTHETIC_USER, role: 'doctor', authChannel: 'web' as const,
        createdAt: Date.parse('2026-11-09T09:00:00.000Z'), expiresAt: lease.expiresAt });
    const request = read('request');
    const currentRef = Object.freeze({}); let stagedRef: object | null = null; let generation = 0; let terminal = false;
    const port = Object.freeze({
        snapshot: () => Object.freeze({ currentRef, stagedRef, generation, terminal }),
        prepare: () => { const replacement = Object.freeze({}); stagedRef = replacement; return replacement; },
        commit: () => { stagedRef = null; generation += 1; terminal = true; return true; },
        abort: () => { stagedRef = null; terminal = true; return true; },
        dispose: () => { terminal = true; },
    });
    const owner = Object.freeze({ snapshotSelectionEpoch: () => 6, issueSelection: () => lease,
        dereferenceSelection: () => Object.freeze({ patientId: request.patientId, ambulatoryId: request.ambulatoryId }),
        mintPatientInsightLeaseCommitPort: () => port });
    let generated = 0;
    const service = createAuthenticatedPatientInsightPreviewService({
        acquireContext: async () => Object.freeze({ session, owner }) as never,
        readPatientRevision: () => (mode === 'stale' && generated > 0 ? revision + 1 : revision),
        createCapability: (currentness) => createPatientInsightHostCapability({
            killSwitch: { read: async () => (mode === 'kill_switch' && generated > 0 ? { status: 'denied' as const, code: 'disabled' as const } : { status: 'enabled' as const }) },
            currentness, lifecycle: { read: () => lifecycle },
            binding: { async readClinical() {
                const resolution = localProviderRegistry.resolve({ task: 'clinical', provider: 'ollama', models: { clinical: MODEL }, endpoint: ENDPOINT, chatTimeoutMs: 10_000, disableThinking: true });
                return { status: 'available' as const, resolution: Object.freeze({ ...resolution, adapter: Object.freeze({ ...resolution.adapter,
                    getModel: () => resolution.adapter.getModel(), getBaseUrl: () => resolution.adapter.getBaseUrl(), listModels: () => resolution.adapter.listModels(),
                    chat: async (...args: Parameters<typeof resolution.adapter.chat>) => { try { return await resolution.adapter.chat(...args); } finally { generated += 1; } } }) }) };
            } },
            readiness: { observeClinical: async () => ({ status: 'available' as const, code: null, observation: { venue: 'local_process' as const, state: 'available' as const, reason: null } }) },
            route: routeHostResolvedCandidateCapability,
            sources: { clock: () => VERIFIED_AT, entropy: () => new Uint8Array(16).fill(0xab) },
        }),
        clock: () => VERIFIED_AT,
        entropy: () => new Uint8Array(32).fill(0xcd),
    });
    const handler = createFunctionModelDispatch({ readSources: () => settings, authenticate: async () => 'synthetic-session' })('patient_insight',
        createPatientInsightPreviewHttpHandler({ acquirePreview: service.acquire }));
    const send = (body: unknown) => handler(new Request('http://localhost/api/ai/patient-insight/preview', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    return { send, prompts };
}

async function record(name: string, response: Response) {
    const value = { status: response.status, body: await response.json() };
    const file = path.join(FIXTURES, `${name}.json`);
    if (WRITE) fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
    assert.deepEqual(value, read(name), `${name}: la risposta reale non è quella che legge il client Rust`);
    return value;
}

test('GPUI costruisce la stessa richiesta del Web dallo stesso materiale della scheda', () => {
    const capture = read('capture');
    const request = read('request');
    assert.deepEqual(JSON.parse(JSON.stringify(buildPatientInsightPreviewRequest(capture))), request);
    assert.ok(parsePatientInsightPreviewRequest(request), 'il parser della route accetta il corpo di GPUI');
});

test('il corpo di GPUI passa per handler, servizio e capacità reali e torna una proposta con fonti', async (t) => {
    const fixture = route(t, 'valid');
    const response = await fixture.send(read('request'));
    assert.equal(response.status, 200);
    const value = await record('response-available', response);
    assert.equal(value.body.preview.status, 'available');
    assert.equal(value.body.preview.writesPerformed, 0);
    assert.ok(parsePatientInsightPreviewWireRoot(value.body), 'il Web legge la stessa risposta');
    // Le righe [Sx] del prompt sono quelle che GPUI numera: S1 motivo, poi condizioni, terapie, eventi.
    const prompt = fixture.prompts[0];
    assert.match(prompt, /\[S1\] Valutazione manuale del follow-up clinico attuale/u);
    assert.match(prompt, /\[S6\] Terapia corrente: Metformina/u);
    assert.match(prompt, /\[S9\] Evento clinico recente: Esami ematici/u);
    // La voce di diario in testo ricco arriva al modello come testo semplice, senza tag né entità.
    assert.match(prompt, /\[S10\] Evento clinico recente: Controllo pressorio: PA 150\/90 & FC 88, edemi <2\+> - Saturazione 96% in aria - Dolore 🩺 riferito Rivalutare fra 7 giorni\n?$/u);
    assert.doesNotMatch(prompt, /<\/?(?:p|strong|ul|li)>|&(?:amp|lt|gt|nbsp);/u);
    assert.doesNotMatch(prompt, /\[S11\]/u);
});

test('dinieghi e fallimenti reali arrivano a GPUI come codici senza proposta', async (t) => {
    for (const [mode, name, status] of [
        ['malformed', 'response-proposal-invalid', 200],
        ['provider_failed', 'response-provider-failed', 200],
        ['kill_switch', 'response-kill-switch', 200],
        ['stale', 'response-stale', 200],
        ['function_disabled', 'response-function-disabled', 403],
    ] as const) {
        const response = await route(t, mode).send(read('request'));
        assert.equal(response.status, status, mode);
        const value = await record(name, response);
        if (status === 200) {
            assert.equal(value.body.preview.proposal, null, mode);
            assert.equal(value.body.preview.writesPerformed, 0, mode);
        }
    }
});

test('controprova: un corpo alterato è rifiutato dalla route', async (t) => {
    const request = read('request');
    for (const altered of [
        { ...request, extra: true },
        { ...request, patientRevision: 0 },
        { ...request, sources: { ...request.sources, focus: { summary: '' } } },
        { ...request, capturedAt: '2026-11-09T10:00:00Z' },
    ]) {
        const response = await route(t, 'valid').send(altered);
        assert.equal(response.status, 400);
    }
    // Revisione diversa da quella dell'archivio: nessuna generazione.
    const stale = await route(t, 'valid', 4).send(request);
    assert.equal((await stale.json()).preview.code, 'source_stale');
});
