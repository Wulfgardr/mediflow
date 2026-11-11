/* Sintesi documenti in GPUI (G-5b): i corpi che GPUI invia passano per gli handler reali
 * di selezione, cattura, ingest e anteprima, per l'operazione reale (broker, lease,
 * currentness del documento), per l'estrazione AnyDoc reale sui byte inviati e per la
 * composizione Fabric di produzione (binding, ammissione, citazioni, ricevuta). Sessione
 * Web, archivio e Ollama sono sintetici e dichiarati. Le risposte prodotte qui sono i
 * file che il client Rust legge in `transport/tests/fixtures/document_synthesis/`. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, afterEach, type TestContext } from 'node:test';
import Database from 'better-sqlite3';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FIXTURES = path.join(ROOT_DIR, 'experiments/gpui-patient-pilot/transport/tests/fixtures/document_synthesis');
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'));
const WRITE = process.env.MEDIFLOW_WRITE_FIXTURES !== undefined;
const DOCUMENT = read('document');
const MODEL = 'synthetic-document-synthesis:1';
const ENDPOINT = 'http://127.0.0.1:11434';
const ORIGIN = 'http://127.0.0.1:43117';
const HOST = new URL(ORIGIN).host;

const DATA_DIRECTORY = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-ds-gpui-'));
process.env.MEDIFLOW_DATA_DIR = DATA_DIRECTORY;
const bootstrap = new Database(path.join(DATA_DIRECTORY, 'medical.db'));
for (const file of fs.readdirSync(path.join(ROOT_DIR, 'drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
    bootstrap.exec(fs.readFileSync(path.join(ROOT_DIR, 'drizzle', file), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
}
bootstrap.close();

(await import('./db-server.ts')).openDbServer();
// Le colonne di currentness nascono con l'apertura dell'archivio: i dati sintetici dopo.
const seed = new Database(path.join(DATA_DIRECTORY, 'medical.db'));
const settings = { aiProvider: 'ollama', aiUrl: ENDPOINT, aiModel_reasoning: MODEL };
seed.prepare('INSERT INTO ambulatories (id, name, type) VALUES (?, ?, ?)').run(DOCUMENT.ambulatoryId, 'Ambulatorio sintetico', 'test');
seed.prepare('INSERT INTO patients (id, first_name, last_name, tax_code, version) VALUES (?, ?, ?, ?, 1)')
    .run(DOCUMENT.patientId, 'Persona', 'Sintetica', 'SYNTHETICDSGPUI01');
seed.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES (?, ?)').run(DOCUMENT.patientId, DOCUMENT.ambulatoryId);
seed.prepare('INSERT INTO attachments (id, patient_id, name, type, size, path, data, document_source_ref, document_revision, document_freshness_epoch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(DOCUMENT.attachmentId, DOCUMENT.patientId, DOCUMENT.name, DOCUMENT.mimeType, Buffer.from(DOCUMENT.base64, 'base64').length, 'sintetico',
        `ENC:${DOCUMENT.base64}`, DOCUMENT.currentness.sourceRef, DOCUMENT.currentness.revision, DOCUMENT.currentness.freshnessEpoch);
for (const [key, value] of Object.entries(settings)) seed.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value);
seed.close();
const { dbServer } = await import('./db-server.ts');
const { sql } = await import('drizzle-orm');
const { clearAllSessions } = await import('./security/server-session.ts');
const { serverSessionProjectionOwnerRegistry } = await import('./security/server-session-projection-owner-production.ts');
const { createAuthenticatedWebSessionSelectionService } = await import('./security/server-session-authenticated-selection.ts');
const { createSmartImportSelectionHttpHandler, createSmartImportSelectionEpochHttpHandler } = await import('./security/server-session-smart-import-selection-http.ts');
const { createDocumentSynthesisProductionOperationForTest } = await import('./ai-providers/fabric/document-synthesis-production-operation.ts');
const { createDocumentSynthesisCaptureHttpHandler, createDocumentSynthesisIngestHttpHandler, createDocumentSynthesisPreviewHttpHandler, DOCUMENT_SYNTHESIS_CAPTURE_HEADER } = await import('./ai-providers/fabric/document-synthesis-production-http.ts');
const { createDocumentSynthesisFabricProductionComposition } = await import('./ai-providers/fabric/document-synthesis-fabric-production-composition.ts');
const { parseDocumentSynthesisPreviewWire } = await import('./ai-providers/fabric/document-synthesis-preview-wire.ts');
const { createFunctionModelDispatch } = await import('./ai-providers/fabric/function-model-dispatch.ts');
const { FUNCTION_SWITCH_KEYS } = await import('./ai-providers/fabric/function-model-preferences.ts');
const { composeAnyDocCurrentSelectionClientProjectionExtraction } = await import('./domain/documents/anydoc-current-source-composition.ts');
const { issueSyntheticWebSessionContext, retireSyntheticWebSession } = await import('./security/web-auth-lifecycle-owner-test-fixture.ts');
const { resolve } = await import('./security/web-auth-lifecycle-owner-adapter.ts');

const USER = Object.freeze({ id: 'user.synthetic.ds.gpui', username: ['clinician', 'synthetic', 'ds'].join('.'), role: 'clinician' as const });
const sessions: ReturnType<typeof issueSyntheticWebSessionContext>['session'][] = [];
afterEach(() => { for (const session of sessions.splice(0)) retireSyntheticWebSession(session); clearAllSessions(); });
after(() => fs.rmSync(DATA_DIRECTORY, { recursive: true, force: true }));

/* Risposta deterministica del modello finto: una citazione letterale del documento. */
function modelReply(quote: string, summary = 'Controllo pressorio stabile; proseguire la terapia in corso.') {
    return JSON.stringify({ schemaVersion: 'mediflow.document-synthesis.provider-envelope.v2',
        output: { schemaVersion: 'mediflow.ai.extract.v1', task: 'document_synthesis',
            summary,
            data: { qualityLevel: 'green', medications: [], diagnoses: [], problemStatements: [], therapyCandidates: [], servicePrescriptions: [] } },
        citations: [{ label: 'S1', quote }],
        claims: [{ claimPath: 'summary', labels: ['S1'] }, { claimPath: 'data.qualityLevel', labels: ['S1'] }] });
}

/* La risposta reale del modello locale con campi strutturati inventati (P1), con la
 * citazione portata sul documento sintetico: l'host la accetta e deve toglierli. */
const INVENTED = read('model-output-invented-fields').cases[0] as { output: { summary: string; data: Record<string, unknown> }; invented: string[] };
function inventedReply(quote: string) {
    const claims = [{ claimPath: 'summary', labels: ['S1'] }];
    for (const [key, value] of Object.entries(INVENTED.output.data)) {
        if (Array.isArray(value)) value.forEach((_, index) => claims.push({ claimPath: `data.${key}[${index}]`, labels: ['S1'] }));
        else claims.push({ claimPath: `data.${key}`, labels: ['S1'] });
    }
    return JSON.stringify({ schemaVersion: 'mediflow.document-synthesis.provider-envelope.v2', output: INVENTED.output, citations: [{ label: 'S1', quote }], claims });
}

type Mode = 'valid' | 'invented' | 'malformed' | 'truncated' | 'provider_failed' | 'function_disabled' | 'lane_disabled' | 'unsupported'
    | 'unfaithful' | 'spaced' | 'english';

/* Misura dell'11/11/2026 con qwen3.5:35b-a3b: citazioni con un tratto omesso, citazioni con gli a
 * capo fusi in uno spazio, riassunti in inglese. Qui sul documento sintetico del contratto. */
const OMITTED_QUOTE = DOCUMENT.quote.replace(' mmHg', '');
const SPACED_QUOTE = DOCUMENT.quote.replace('arteriosa ', 'arteriosa\n\n').replace(', stabile', ',  stabile');
const ENGLISH_SUMMARY = 'Patient underwent a blood pressure check. Results indicate stable values and the current therapy should be continued.';
function reply(mode: Mode): string {
    if (mode === 'malformed') return '{"schemaVersion":';
    if (mode === 'invented') return inventedReply(DOCUMENT.quote);
    if (mode === 'unfaithful') return modelReply(OMITTED_QUOTE);
    if (mode === 'spaced') return modelReply(SPACED_QUOTE);
    if (mode === 'english') return modelReply(DOCUMENT.quote, ENGLISH_SUMMARY);
    return modelReply(DOCUMENT.quote);
}

function host(t: TestContext, mode: Mode) {
    const previousFetch = globalThis.fetch;
    const descriptor = { name: MODEL, model: MODEL, size: 1234, digest: 'a'.repeat(64), details: { family: 'synthetic' } };
    const prompts: string[] = [];
    globalThis.fetch = async (input, init) => {
        const url = new URL(String(input)); assert.equal(url.origin, ENDPOINT, 'solo il finto Ollama');
        if (url.pathname === '/api/version') return Response.json({ version: '0.40.6' });
        if (url.pathname === '/api/tags' || url.pathname === '/api/ps') return Response.json({ models: [descriptor] });
        if (url.pathname === '/api/show') return Response.json({ details: descriptor.details });
        if (url.pathname === '/api/generate') return Response.json({ model: MODEL });
        assert.equal(url.pathname, '/api/chat');
        const payload = JSON.parse(String(init?.body));
        prompts.push(payload.messages.map((message: { content: string }) => message.content).join('\n'));
        if (mode === 'provider_failed') throw new Error('Synthetic provider failure');
        // Come Ollama al tetto di token (collaudo dell'11/11/2026): JSON interrotto e `done_reason: length`.
        if (mode === 'truncated') return Response.json({ model: MODEL, message: { content: modelReply(DOCUMENT.quote).slice(0, 120) },
            prompt_eval_count: 3, eval_count: payload.options.num_predict, done_reason: 'length' });
        return Response.json({ model: MODEL, message: { content: reply(mode) },
            prompt_eval_count: 3, eval_count: 4 });
    };
    t.after(() => { globalThis.fetch = previousFetch; });

    const web = issueSyntheticWebSessionContext(USER, `ds-gpui-${mode}-${sessions.length}`);
    sessions.push(web.session);
    const current = () => {
        const resolution = resolve(web.session.id, web.controlId);
        assert.equal(resolution.status, 'active');
        if (resolution.status !== 'active') throw new Error('Synthetic Web projection unavailable');
        return resolution.projection;
    };
    const context = () => { const session = current(); return Object.freeze({ session, owner: serverSessionProjectionOwnerRegistry.acquire(session) }); };
    let entropy = 0;
    const operation = createDocumentSynthesisProductionOperationForTest({
        acquireContext: async () => context(),
        // La stessa lettura di `readProductionCurrentness`, sull'archivio sintetico.
        readCurrentness: (attachmentId: string, patientId: string, ambulatoryId: string) =>
            dbServer.get(sql`SELECT a.document_source_ref AS documentSourceRef, a.document_revision AS documentRevision, a.document_freshness_epoch AS documentFreshnessEpoch FROM attachments AS a INNER JOIN patients_to_ambulatories AS pta ON pta.patient_id = a.patient_id WHERE a.id = ${attachmentId} AND a.patient_id = ${patientId} AND pta.ambulatory_id = ${ambulatoryId} LIMIT 1`),
        readLaneEnabled: () => mode !== 'lane_disabled',
        extract: (session, attachmentId, request) => mode === 'unsupported'
            ? Promise.resolve(Object.freeze({ schemaVersion: 'mediflow.anydoc_local_extraction.v1' as const,
                provenance: Object.freeze({ attachmentId, sourceSha256: 'b'.repeat(64), byteLength: 24 }),
                receipt: Object.freeze({ receiptId: 'd'.repeat(64), parser: 'anydoc-local' as const, outcome: 'review_required:image_or_scan' as const,
                    sourceSha256: 'b'.repeat(64), sourceByteLength: 24, markdownByteLength: 0 }),
                review: 'required' as const, writes: 0 as const, apply: 'none' as const, status: 'review_required' as const,
                reason: 'unsupported_local_extraction' as const, detail: 'image_or_scan' as const, markdown: '' as const, candidateUse: 'blocked' as const }))
            : composeAnyDocCurrentSelectionClientProjectionExtraction(session, { attachmentId }, request),
        async execute(configuration: unknown) { return (await createDocumentSynthesisFabricProductionComposition(configuration)?.execute()) ?? null; },
        entropy: () => Uint8Array.from({ length: 16 }, () => ++entropy),
    });
    const acquireOperation = () => operation.acquire();
    const selection = createAuthenticatedWebSessionSelectionService({ acquireOwner: async () => context().owner });
    const sources = { settings: { ...settings, ...Object.fromEntries(Object.values(FUNCTION_SWITCH_KEYS)
        .map((key) => [key, mode === 'function_disabled' ? 'disabled' : 'enabled'])) },
    ollamaLifecycle: { status: 'available', record: { version: 1, lifecycle: { provider: 'ollama', credentialClass: 'local_model', status: 'available_unqualified' } } } };
    const dispatch = createFunctionModelDispatch({ readSources: () => sources, authenticate: async () => 'synthetic-session' });
    const handlers = {
        selectionEpoch: createSmartImportSelectionEpochHttpHandler({ readEpoch: async () => serverSessionProjectionOwnerRegistry.snapshotSelectionEpoch(current()) }),
        select: createSmartImportSelectionHttpHandler({ acquireSelection: selection.acquire }),
        capture: createDocumentSynthesisCaptureHttpHandler({ acquireOperation }),
        ingest: createDocumentSynthesisIngestHttpHandler({ acquireOperation }),
        preview: dispatch('document_synthesis', createDocumentSynthesisPreviewHttpHandler({ acquireOperation })),
    };
    // Le intestazioni che il client Rust di GPUI mette su ogni richiesta all'host.
    const json = (route: string, body: unknown) => new Request(`${ORIGIN}${route}`, { method: 'POST',
        headers: { host: HOST, origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return {
        prompts,
        epoch: () => handlers.selectionEpoch(),
        select: (body: unknown) => handlers.select(json('/api/ai/smart-import/selection', body)),
        capture: (body: unknown) => handlers.capture(json('/api/ai/document-synthesis/capture', body)),
        ingest: (handle: string, base64: string) => handlers.ingest(new Request(`${ORIGIN}/api/ai/document-synthesis/ingest`, { method: 'POST',
            headers: { host: HOST, origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/octet-stream', [DOCUMENT_SYNTHESIS_CAPTURE_HEADER]: handle },
            body: Buffer.from(base64, 'base64') })),
        preview: (body: unknown) => handlers.preview(json('/api/ai/document-synthesis/preview', body)),
    };
}

/* La selezione porta riferimenti opachi casuali e una scadenza: nel file restano
 * valori fissi dello stesso formato, dopo averne verificato il formato reale. */
function stable<T extends { selection?: Record<string, unknown> }>(body: T): T {
    const lease = body.selection;
    if (!lease) return body;
    for (const [key, prefix] of [['sessionRef', 'ssr_'], ['patientRef', 'ptr_'], ['ambulatoryRef', 'abr_'], ['leaseRef', 'lsr_']] as const) {
        assert.match(String(lease[key]), new RegExp(`^${prefix}[0-9a-f]{32}$`, 'u'), key);
        lease[key] = `${prefix}${'0'.repeat(31)}${['ssr_', 'ptr_', 'abr_', 'lsr_'].indexOf(prefix) + 1}`;
    }
    assert.ok(Number.isSafeInteger(lease.expiresAt) && (lease.expiresAt as number) > Date.now());
    lease.expiresAt = Date.parse('2026-11-10T12:00:00.000Z');
    return body;
}

async function record(name: string, response: Response) {
    const value = { status: response.status, body: stable(await response.json()) };
    const file = path.join(FIXTURES, `${name}.json`);
    if (WRITE) fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
    assert.deepEqual(value, read(name), `${name}: la risposta reale non è quella che legge il client Rust`);
    return value;
}

/* Fino all'anteprima, con i corpi dei file condivisi: ciò che GPUI invia, in ordine. */
async function untilPreview(fixture: ReturnType<typeof host>, recordSteps: boolean) {
    const epoch = await fixture.epoch();
    if (recordSteps) await record('response-selection-epoch', epoch); else await epoch.json();
    const selected = await fixture.select(read('request-selection'));
    assert.equal(selected.status, 200);
    if (recordSteps) await record('response-selection', selected); else await selected.json();
    const captured = await fixture.capture(read('request-capture'));
    assert.equal(captured.status, 200);
    if (recordSteps) await record('response-capture', captured); else await captured.json();
    const ingest = read('request-ingest');
    const ingested = await fixture.ingest(ingest.captureHandle, ingest.base64);
    assert.equal(ingested.status, 200, 'ingest con i byte e l\'intestazione di GPUI');
    if (recordSteps) await record('response-ingest', ingested); else await ingested.json();
    return fixture.preview(read('request-preview'));
}

test('i corpi di GPUI passano per selezione, cattura, AnyDoc e Fabric reali fino a una proposta con citazioni', async (t) => {
    const fixture = host(t, 'valid');
    const response = await untilPreview(fixture, true);
    assert.equal(response.status, 200);
    const value = await record('response-available', response);
    assert.ok(parseDocumentSynthesisPreviewWire(value.body), 'il Web legge la stessa risposta');
    assert.equal(value.body.publication.receipt.writesPerformed, 0);
    assert.equal(value.body.publication.citations[0].quote, DOCUMENT.quote);
    // Il modello ha ricevuto il testo estratto dall'host dai byte di GPUI, non altro.
    assert.equal(fixture.prompts.length, 1);
    assert.match(fixture.prompts[0], new RegExp(DOCUMENT.quote.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
});

test('campi strutturati inventati dal modello: gli handler reali li tolgono prima di rispondere a Web e GPUI', async (t) => {
    const fixture = host(t, 'invented');
    const response = await untilPreview(fixture, false);
    assert.equal(response.status, 200, 'l\'host accetta la proposta con campi strutturati pieni');
    const value = await record('response-available-invented-fields', response);
    assert.equal(fixture.prompts.length, 1);
    const text = JSON.stringify(value.body);
    for (const needle of INVENTED.invented) assert.ok(!text.includes(needle), `${needle} arriva al client`);
    assert.deepEqual(Object.keys(value.body.publication.output), ['schemaVersion', 'task', 'summary', 'qualityLevel']);
    assert.equal(value.body.publication.output.summary, INVENTED.output.summary);
    assert.ok(parseDocumentSynthesisPreviewWire(value.body), 'il Web legge la risposta senza campi strutturati');
    const withData = structuredClone(value.body); withData.publication.output.data = INVENTED.output.data;
    assert.equal(parseDocumentSynthesisPreviewWire(withData), null, 'il Web rifiuta la stessa risposta con i campi strutturati');
});

test('dinieghi e fallimenti reali arrivano a GPUI come codici senza proposta', async (t) => {
    for (const [mode, name, status] of [
        ['truncated', 'response-proposal-truncated', 502],
        ['malformed', 'response-proposal-invalid', 502],
        ['unfaithful', 'response-proposal-citation-not-literal', 502],
        ['provider_failed', 'response-provider-failed', 503],
        ['function_disabled', 'response-function-disabled', 403],
    ] as const) {
        const fixture = host(t, mode);
        const response = await untilPreview(fixture, false);
        assert.equal(response.status, status, mode);
        const value = await record(name, response);
        // Risposta tagliata o illeggibile: secondo tentativo, poi un codice proprio e non
        // `operation_unavailable`, cosi' lo schermo dice la causa invece di tre ipotesi.
        if (mode === 'malformed' || mode === 'truncated') {
            assert.equal(value.body.code, 'model_response_invalid', mode);
            assert.equal(fixture.prompts.length, 2, mode);
        }
        // Citazione con una parte omessa anche al secondo tentativo: un codice che dice la causa.
        if (mode === 'unfaithful') {
            assert.equal(value.body.code, 'citation_not_literal', mode);
            assert.equal(fixture.prompts.length, 2, mode);
        }
    }
    const lane = await host(t, 'lane_disabled').capture(read('request-capture'));
    assert.equal(lane.status, 409);
    await record('response-capture-lane-disabled', lane);
    // La cattura chiede la selezione: senza, l'host non cattura nulla.
    const unselected = await host(t, 'valid').capture(read('request-capture'));
    assert.equal(unselected.status, 503);
    await record('response-capture-unselected', unselected);
    const unsupported = host(t, 'unsupported');
    await (await unsupported.select(read('request-selection'))).json();
    assert.equal((await unsupported.capture(read('request-capture'))).status, 200);
    const ingest = read('request-ingest');
    const refused = await unsupported.ingest(ingest.captureHandle, ingest.base64);
    assert.equal(refused.status, 409);
    await record('response-ingest-unsupported', refused);
});

test('riassunto in inglese: secondo tentativo, poi la risposta non valida e nessuna proposta', async (t) => {
    const fixture = host(t, 'english');
    const response = await untilPreview(fixture, false);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), read('response-proposal-invalid').body);
    assert.equal(fixture.prompts.length, 2);
    assert.match(fixture.prompts[0], /Write summary and qualityReason in Italian/u, 'il prompt chiede il riassunto in italiano');
});

test('citazione che differisce solo negli spazi: proposta accettata con il testo esatto del documento', async (t) => {
    const fixture = host(t, 'spaced');
    const response = await untilPreview(fixture, false);
    assert.equal(response.status, 200);
    const value = await response.json();
    assert.equal(fixture.prompts.length, 1);
    assert.equal(value.publication.citations[0].quote, DOCUMENT.quote, 'a schermo va il tratto della fonte, non il testo del modello');
    assert.notEqual(value.publication.citations[0].quote, SPACED_QUOTE);
});

test('documento cambiato dopo la cattura: l\'host nega l\'anteprima e il modello non parte', async (t) => {
    const fixture = host(t, 'valid');
    await (await fixture.select(read('request-selection'))).json();
    assert.equal((await fixture.capture(read('request-capture'))).status, 200);
    const ingest = read('request-ingest');
    assert.equal((await fixture.ingest(ingest.captureHandle, ingest.base64)).status, 200);
    const revise = (revision: number) => dbServer.run(sql`UPDATE attachments SET document_revision = ${revision} WHERE id = ${DOCUMENT.attachmentId}`);
    revise(DOCUMENT.currentness.revision + 1);
    try {
        const preview = await fixture.preview(read('request-preview'));
        assert.equal(preview.status, 409);
        await record('response-preview-stale', preview);
    } finally { revise(DOCUMENT.currentness.revision); }
    assert.equal(fixture.prompts.length, 0);
});

test('controprova: corpi alterati sono rifiutati dagli handler', async (t) => {
    const fixture = host(t, 'valid');
    const selection = read('request-selection');
    for (const altered of [{ ...selection, extra: true }, { ...selection, expectedEpoch: -1 }]) {
        assert.equal((await fixture.select(altered)).status, 400);
    }
    assert.equal((await fixture.select({ ...selection, expectedEpoch: 5 })).status, 409, 'epoca attesa diversa');
    await (await fixture.select(selection)).json();
    for (const altered of [{ attachmentId: '' }, { attachmentId: DOCUMENT.attachmentId, extra: 1 }]) {
        assert.equal((await fixture.capture(altered)).status, 400);
    }
    assert.equal((await fixture.capture({ attachmentId: 'altro-documento' })).status, 503, 'documento non del paziente selezionato');
    assert.equal((await fixture.preview({ previewHandle: 'dsp_x' })).status, 400);
    assert.equal((await fixture.preview({ previewHandle: `dsp_${'0'.repeat(32)}` })).status, 409, 'maniglia mai emessa');
    assert.equal(fixture.prompts.length, 0);
});
