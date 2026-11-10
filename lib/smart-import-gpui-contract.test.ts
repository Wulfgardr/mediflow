/* Import assistito in GPUI (G-5c): le fonti che GPUI raccoglie dalla scheda sono quelle
 * del costruttore Web; i corpi che GPUI invia passano per gli handler reali di selezione,
 * ingest e anteprima, per il proprietario delle proiezioni e il broker reali, per la
 * capacità reale (interruttore, Fabric, prompt, validazione della proposta e delle fonti).
 * Sessione Web, archivio e provider sono sintetici e dichiarati: il modello è un adattatore
 * Ollama finto, come in `smart-import-synthetic-composition.test.ts`. Le risposte prodotte
 * qui sono i file che il client Rust legge in `transport/tests/fixtures/smart_import/`. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, afterEach, type TestContext } from 'node:test';
import Database from 'better-sqlite3';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FIXTURES = path.join(ROOT_DIR, 'experiments/gpui-patient-pilot/transport/tests/fixtures/smart_import');
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'));
const WRITE = process.env.MEDIFLOW_WRITE_FIXTURES !== undefined;
const CHART = read('chart');
const MODEL = 'synthetic-smart-import:1';
const ORIGIN = 'http://127.0.0.1:43118';
const HOST = new URL(ORIGIN).host;
/* La proiezione vale 300 s dalla cattura: l'orologio del test è fermo un secondo dopo. */
const NOW = Date.parse(CHART.capturedAt) + 1_000;

const DATA_DIRECTORY = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-si-gpui-'));
process.env.MEDIFLOW_DATA_DIR = DATA_DIRECTORY;
const bootstrap = new Database(path.join(DATA_DIRECTORY, 'medical.db'));
for (const file of fs.readdirSync(path.join(ROOT_DIR, 'drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
    bootstrap.exec(fs.readFileSync(path.join(ROOT_DIR, 'drizzle', file), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
}
bootstrap.close();
(await import('./db-server.ts')).openDbServer();
const seed = new Database(path.join(DATA_DIRECTORY, 'medical.db'));
seed.prepare('INSERT INTO ambulatories (id, name, type) VALUES (?, ?, ?)').run(CHART.ambulatoryId, 'Ambulatorio sintetico', 'test');
seed.prepare('INSERT INTO patients (id, first_name, last_name, tax_code, version) VALUES (?, ?, ?, ?, ?)')
    .run(CHART.patient.id, 'Persona', 'Sintetica', 'SYNTHETICSIGPUI01', CHART.patient.version);
seed.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES (?, ?)').run(CHART.patient.id, CHART.ambulatoryId);
seed.close();

const { clearAllSessions } = await import('./security/server-session.ts');
const { serverSessionProjectionOwnerRegistry } = await import('./security/server-session-projection-owner-production.ts');
const { createAuthenticatedWebSessionSelectionService } = await import('./security/server-session-authenticated-selection.ts');
const { createSmartImportSelectionHttpHandler, createSmartImportSelectionEpochHttpHandler } = await import('./security/server-session-smart-import-selection-http.ts');
const { createAuthenticatedSmartImportAttachmentIngestService } = await import('./security/server-session-authenticated-smart-import-attachment-ingest.ts');
const { ingestServerSessionSmartImportAttachmentWithOwner } = await import('./security/server-session-smart-import-attachment-ingest.ts');
const { createSmartImportIngestHttpHandler } = await import('./security/server-session-smart-import-ingest-http.ts');
const { createAuthenticatedSmartImportPreviewService } = await import('./security/server-session-authenticated-smart-import-preview.ts');
const { createSmartImportPreviewHttpHandler } = await import('./security/server-session-smart-import-preview-http.ts');
const { createPatientSmartImportHostCapability } = await import('./domain/documents/patient-smart-import-host-capability.ts');
const { createPatientSmartImportHostKillSwitch } = await import('./domain/documents/patient-smart-import-host-kill-switch.ts');
const { buildPatientSmartImportProjectionCaptureInput } = await import('./domain/documents/patient-smart-import-projection-capture.ts');
const { createSmartImportProjectionAttachmentBrowserNormalizer } = await import('./security/smart-import-projection-attachment-browser-normalizer.ts');
const { routeHostResolvedCandidateCapability } = await import('./ai-providers/fabric/candidate-router.ts');
const { localProviderRegistry } = await import('./ai-providers/registry.ts');
const { parseSmartImportPreviewWireRoot } = await import('./smart-import-preview-wire.ts');
const { createFunctionModelDispatch } = await import('./ai-providers/fabric/function-model-dispatch.ts');
const { FUNCTION_SWITCH_KEYS } = await import('./ai-providers/fabric/function-model-preferences.ts');
const { issueSyntheticWebSessionContext, retireSyntheticWebSession } = await import('./security/web-auth-lifecycle-owner-test-fixture.ts');
const { resolve } = await import('./security/web-auth-lifecycle-owner-adapter.ts');

const USER = Object.freeze({ id: 'user.synthetic.si.gpui', username: ['clinician', 'synthetic', 'si'].join('.'), role: 'clinician' as const });
const sessions: ReturnType<typeof issueSyntheticWebSessionContext>['session'][] = [];
afterEach(() => { for (const session of sessions.splice(0)) retireSyntheticWebSession(session); clearAllSessions(); });
after(() => fs.rmSync(DATA_DIRECTORY, { recursive: true, force: true }));

/* La scheda di `chart.json` nella forma che riceve il costruttore Web. */
function webCapture(chart = CHART) {
    const patient = { ...chart.patient, documentInsights: undefined };
    const entries = chart.entries.map((row: Record<string, unknown>) => ({ ...row, patientId: chart.patient.id }));
    const attachments = chart.attachments.map((row: { createdAt: string }) => ({ ...row, createdAt: new Date(row.createdAt) }));
    // Come la pagina Web: alle fonti arrivano le terapie non eliminate; il costruttore tiene le attive.
    return buildPatientSmartImportProjectionCaptureInput(patient as never, entries as never, attachments as never, chart.therapies as never);
}
/* La proiezione che il normalizzatore Web produce da quella cattura, con l'ordinale e l'ora fissati. */
function webAttachment() {
    const normalizer = createSmartImportProjectionAttachmentBrowserNormalizer({ clock: () => new Date(CHART.capturedAt) });
    for (let revision = 1; revision < CHART.sourceRevision; revision += 1) normalizer.capture(webCapture(), true);
    return JSON.parse(JSON.stringify(normalizer.capture(webCapture(), true)));
}
/* Ogni candidato cita la fonte che contiene la sua evidenza. */
const sourceId = (label: string) => (webAttachment().sources as { id: string; label: string }[]).find((source) => source.label === label)!.id;
const SOURCE = { 'clinical-entry': sourceId('VISITA 05/11/2026'), 'patient-notes': sourceId('Note paziente · segmento 2'), 'attachment-summary': sourceId('Allegato referto-cardiologico.pdf') };

/* Risposta deterministica del modello finto: un candidato per tipo, ognuno da una fonte diversa. */
function modelReply() {
    return JSON.stringify({ schemaVersion: 'mediflow.ai.extract.v1', task: 'smart_import', summary: 'Ipertensione in terapia; ecocardiogramma da programmare.',
        data: {
            diagnoses: [{ label: 'Ipertensione arteriosa', icdQuery: 'ipertensione essenziale', confidence: 'high', evidence: 'Pressione 150/95 in due misurazioni.', sourceId: SOURCE['clinical-entry'] }],
            therapies: [{ drugMention: 'ramipril 5 mg', drugQuery: 'ramipril', confidence: 'medium', evidence: 'ramipril 5 mg una volta al giorno', sourceId: SOURCE['patient-notes'], dosage: '5 mg una volta al giorno', therapyState: 'active' }],
            servicePrescriptions: [{ serviceName: 'Ecocardiogramma', confidence: 'medium', evidence: 'Consigliato ecocardiogramma di controllo.', sourceId: SOURCE['attachment-summary'], category: 'imaging' }],
        } });
}

type Mode = 'valid' | 'malformed' | 'provider_failed' | 'kill_switch_disabled' | 'function_disabled' | 'provider_unready';

function host(t: TestContext, mode: Mode, now = NOW) {
    t.mock.timers.enable({ apis: ['Date'], now });
    const prompts: string[] = [];
    const base = localProviderRegistry.resolve({ task: 'clinical', models: { clinical: MODEL }, endpoint: 'http://127.0.0.1:11434', chatTimeoutMs: 1_000 });
    const binding = { ...base, adapter: Object.freeze({ id: base.adapter.id, kind: base.adapter.kind, capabilities: base.adapter.capabilities,
        getBaseUrl: () => base.adapter.getBaseUrl(), getModel: () => base.adapter.getModel(), listModels: async () => [],
        chat: async (messages: { content: string }[]) => {
            prompts.push(messages.map((message) => message.content).join('\n'));
            if (mode === 'provider_failed') throw new Error('Synthetic provider failure');
            return { content: mode === 'malformed' ? '{"schemaVersion":' : modelReply(), stats: { latency: 1, tokensIn: 1, tokensOut: 1 } };
        } }) };
    const web = issueSyntheticWebSessionContext(USER, `si-gpui-${mode}-${sessions.length}`);
    sessions.push(web.session);
    const current = () => {
        const resolution = resolve(web.session.id, web.controlId);
        assert.equal(resolution.status, 'active');
        if (resolution.status !== 'active') throw new Error('Synthetic Web projection unavailable');
        return resolution.projection;
    };
    const context = () => { const session = current(); return Object.freeze({ session, owner: serverSessionProjectionOwnerRegistry.acquire(session) }); };
    const selection = createAuthenticatedWebSessionSelectionService({ acquireOwner: async () => context().owner });
    const ingest = createAuthenticatedSmartImportAttachmentIngestService({ acquireContext: async () => context(), ingestWithOwner: ingestServerSessionSmartImportAttachmentWithOwner });
    let entropy = 0;
    const preview = createAuthenticatedSmartImportPreviewService({ acquireContext: async () => context(), createCapability: (broker) => createPatientSmartImportHostCapability({
        killSwitch: createPatientSmartImportHostKillSwitch({ readSetting: async () => mode === 'kill_switch_disabled' ? 'disabled' : 'enabled' }), broker,
        lifecycle: { read: () => ({ status: 'available', record: { schemaVersion: 'mediflow.ai.provider-lifecycle-record.v1', lifecycle: { schemaVersion: 'mediflow.ai.provider-lifecycle.v1', provider: 'ollama', credentialClass: 'local_model', status: 'available_unqualified' }, actorClass: 'host_service', actorRef: `actor_${'a'.repeat(32)}`, version: 1, hostTimestamp: new Date(NOW).toISOString(), receiptRef: `receipt_${'b'.repeat(32)}` } }) },
        binding: { readClinical: async () => ({ status: 'available', resolution: binding }) },
        readiness: { observeClinical: async () => mode === 'provider_unready'
            ? { status: 'denied', code: 'provider_unready', observation: { venue: 'local_process', state: 'offline', reason: 'provider_unreachable' } }
            : { status: 'available', code: null, observation: { venue: 'local_process', state: 'available', reason: null } } },
        route: routeHostResolvedCandidateCapability,
        sources: { clock: () => new Date().toISOString(), entropy: () => Uint8Array.from({ length: 16 }, () => ++entropy) },
    } as never) });
    const settings = Object.fromEntries(Object.values(FUNCTION_SWITCH_KEYS).map((key) => [key, mode === 'function_disabled' ? 'disabled' : 'enabled']));
    const dispatch = createFunctionModelDispatch({ readSources: () => ({ settings, ollamaLifecycle: { status: 'available', record: { version: 1, lifecycle: { provider: 'ollama', credentialClass: 'local_model', status: 'available_unqualified' } } } }) as never, authenticate: async () => 'synthetic-session' });
    const handlers = {
        selectionEpoch: createSmartImportSelectionEpochHttpHandler({ readEpoch: async () => serverSessionProjectionOwnerRegistry.snapshotSelectionEpoch(current()) }),
        select: createSmartImportSelectionHttpHandler({ acquireSelection: selection.acquire }),
        ingest: createSmartImportIngestHttpHandler({ acquireIngest: ingest.acquire }),
        preview: dispatch('smart_import', createSmartImportPreviewHttpHandler({ acquirePreview: preview.acquire })),
    };
    // Le intestazioni che il client Rust di GPUI mette su ogni richiesta all'host.
    const json = (route: string, body: unknown) => new Request(`${ORIGIN}${route}`, { method: 'POST',
        headers: { host: HOST, origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return {
        prompts,
        epoch: () => handlers.selectionEpoch(),
        select: (body: unknown) => handlers.select(json('/api/ai/smart-import/selection', body)),
        ingest: (body: unknown) => handlers.ingest(json('/api/ai/smart-import/ingest', body)),
        preview: (body: unknown) => handlers.preview(json('/api/ai/smart-import/preview', body)),
    };
}

/* Riferimenti opachi casuali: nei file restano valori fissi dello stesso formato. La
 * mappa serve a rimettere i valori veri nei corpi letti dai file prima di inviarli. */
const LIVE = new Map<string, string>();
function stableRef(real: string, prefix: string, slot: number): string {
    assert.match(real, new RegExp(`^${prefix}[0-9a-f]{32}$`, 'u'));
    const fixed = `${prefix}${'0'.repeat(31)}${slot}`;
    LIVE.set(fixed, real);
    return fixed;
}
function stable(body: Record<string, unknown>): Record<string, unknown> {
    const lease = body.selection as Record<string, unknown> | undefined;
    if (lease) {
        for (const [key, prefix, slot] of [['sessionRef', 'ssr_', 1], ['patientRef', 'ptr_', 2], ['ambulatoryRef', 'abr_', 3], ['leaseRef', 'lsr_', 4]] as const) {
            lease[key] = stableRef(String(lease[key]), prefix, slot);
        }
        // La scadenza viene da un orologio che il test non ferma: nel file resta un valore fisso.
        assert.ok(Number.isSafeInteger(lease.expiresAt) && (lease.expiresAt as number) > NOW);
        lease.expiresAt = Date.parse('2026-11-10T12:00:00.000Z');
    }
    if (typeof body.handle === 'string') body.handle = stableRef(body.handle, 'prj_', 5);
    return body;
}
function live(body: unknown): unknown {
    return JSON.parse(JSON.stringify(body), (_key, value) => typeof value === 'string' && LIVE.has(value) ? LIVE.get(value) : value);
}
function writeFixture(name: string, value: unknown) {
    fs.writeFileSync(path.join(FIXTURES, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
}
async function record(name: string, response: Response) {
    const value = { status: response.status, body: stable(await response.json()) };
    if (WRITE) writeFixture(name, value);
    assert.deepEqual(value, read(name), `${name}: la risposta reale non è quella che legge il client Rust`);
    return value;
}

/* Fino all'anteprima, con i corpi dei file condivisi: ciò che GPUI invia, in ordine. */
async function untilPreview(fixture: ReturnType<typeof host>, recordSteps: boolean) {
    const epoch = await fixture.epoch();
    if (recordSteps) await record('response-selection-epoch', epoch); else stable(await epoch.json());
    const selected = await fixture.select(read('request-selection'));
    assert.equal(selected.status, 200);
    const lease = recordSteps ? (await record('response-selection', selected)).body : stable(await selected.json());
    if (WRITE && recordSteps) {
        const tuple = Object.fromEntries(['sessionRef', 'selectionEpoch', 'patientRef', 'ambulatoryRef', 'leaseRef'].map((key) => [key, (lease.selection as Record<string, unknown>)[key]]));
        writeFixture('request-ingest', { tuple, attachment: webAttachment(), requestId: CHART.requestIds[0] });
    }
    const ingested = await fixture.ingest(live(read('request-ingest')));
    assert.equal(ingested.status, 200, 'ingest della proiezione di GPUI');
    const handle = recordSteps ? (await record('response-ingest', ingested)).body : stable(await ingested.json());
    if (WRITE && recordSteps) writeFixture('request-preview', { handle: handle.handle, requestId: CHART.requestIds[1] });
    return fixture.preview(live(read('request-preview')));
}

test('GPUI raccoglie dalla scheda le stesse fonti del costruttore e del normalizzatore Web', () => {
    const capture = JSON.parse(JSON.stringify(webCapture()));
    if (WRITE) writeFixture('capture-input', capture);
    assert.deepEqual(capture, read('capture-input'));
    if (!WRITE) assert.deepEqual(read('request-ingest').attachment, webAttachment(), 'la proiezione inviata da GPUI è quella del normalizzatore Web');
    assert.equal(read('request-selection').patientId, CHART.patient.id);
});

test('note oltre 900 unità UTF-16: il Web le accorcia entro il limite e il normalizzatore le accetta, come GPUI', () => {
    const limit = read('chart-limit');
    const capture = JSON.parse(JSON.stringify(webCapture(limit)));
    const notes = capture.sources.filter((source: { kind: string }) => source.kind === 'patient-notes');
    assert.equal(notes.length, 2);
    for (const source of notes) {
        assert.ok(source.content.length <= 900, `${source.label}: ${source.content.length} unità`);
        assert.ok(source.content.endsWith('...'));
        assert.doesNotMatch(source.content, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u, 'nessuna coppia surrogata spezzata');
    }
    const normalizer = createSmartImportProjectionAttachmentBrowserNormalizer({ clock: () => new Date(CHART.capturedAt) });
    assert.doesNotThrow(() => normalizer.capture(webCapture(limit), true), 'la cattura Web passa il normalizzatore');
    if (WRITE) writeFixture('capture-input-limit', capture);
    assert.deepEqual(capture, read('capture-input-limit'));
});

test('testo ricco nel diario e note vicino a 900 unità: GPUI riceve dal Web le stesse fonti', () => {
    const rich = read('chart-rich-text');
    const capture = JSON.parse(JSON.stringify(webCapture(rich)));
    const sources = capture.sources as { kind: string; label: string; content: string }[];
    const notes = sources.filter((source) => source.kind === 'patient-notes');
    assert.deepEqual(notes.slice(0, 2).map((source) => source.content.length), [900, 899], 'il primo segmento resta intero, il secondo si accorcia prima della coppia surrogata');
    for (const source of sources) {
        assert.doesNotMatch(source.content, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u, `${source.label}: nessuna coppia surrogata spezzata`);
    }
    const entries = sources.filter((source) => source.kind === 'clinical-entry');
    assert.ok(entries.length > 1);
    for (const source of entries) {
        assert.doesNotMatch(source.content, /<\/?[a-z]+>|&(?:amp|lt|gt|quot|nbsp);|\*\*|\[barrato:/u, `${source.label}: testo semplice`);
    }
    const normalizer = createSmartImportProjectionAttachmentBrowserNormalizer({ clock: () => new Date(CHART.capturedAt) });
    assert.doesNotThrow(() => normalizer.capture(webCapture(rich), true), 'la cattura Web passa il normalizzatore');
    if (WRITE) writeFixture('capture-input-rich-text', capture);
    assert.deepEqual(capture, read('capture-input-rich-text'));
});

test('i corpi di GPUI passano per selezione, ingest e capacità reali fino a una proposta con fonti', async (t) => {
    const fixture = host(t, 'valid');
    const response = await untilPreview(fixture, true);
    assert.equal(response.status, 200);
    const value = await record('response-available', response);
    const parsed = parseSmartImportPreviewWireRoot(value.body);
    assert.ok(parsed && parsed.preview.status === 'available', 'il Web legge la stessa risposta');
    assert.equal(parsed.preview.writesPerformed, 0);
    assert.equal(parsed.preview.apply, 'denied');
    assert.deepEqual([parsed.preview.proposal.diagnoses.length, parsed.preview.proposal.therapies.length, parsed.preview.proposal.servicePrescriptions.length], [1, 1, 1]);
    // Il modello ha ricevuto le fonti di GPUI, non altro.
    assert.equal(fixture.prompts.length, 1);
    assert.match(fixture.prompts[0], /Pressione 150\/95/u);
    assert.doesNotMatch(fixture.prompts[0], /Questa voce non deve arrivare/u);
    // La stessa maniglia una seconda volta: l'host nega e il modello non riparte.
    const replay = await fixture.preview(live(read('request-preview')));
    assert.equal(replay.status, 200);
    await record('response-preview-replayed', replay);
    assert.equal(fixture.prompts.length, 1);
});

test('dinieghi e fallimenti reali arrivano a GPUI come codici senza proposta', async (t) => {
    for (const [mode, name, status, prompts] of [
        ['kill_switch_disabled', 'response-kill-switch-disabled', 200, 0],
        ['function_disabled', 'response-function-disabled', 403, 0],
        ['provider_unready', 'response-provider-unready', 200, 0],
        ['provider_failed', 'response-provider-failed', 200, 1],
        // Il modello locale ha un solo secondo tentativo quando la proposta non è valida.
        ['malformed', 'response-proposal-invalid', 200, 2],
    ] as const) {
        const fixture = host(t, mode);
        const response = await untilPreview(fixture, false);
        assert.equal(response.status, status, mode);
        await record(name, response);
        assert.equal(fixture.prompts.length, prompts, mode);
        t.mock.timers.reset();
    }
});

test('proiezione più vecchia di 300 s: l\'ingest la rifiuta e il modello non parte', async (t) => {
    const fixture = host(t, 'valid', Date.parse(CHART.capturedAt) + 301_000);
    stable(await (await fixture.select(read('request-selection'))).json());
    const stale = await fixture.ingest(live(read('request-ingest')));
    assert.equal(stale.status, 410);
    await record('response-ingest-stale', stale);
    assert.equal(fixture.prompts.length, 0);
});

test('controprova: corpi alterati sono rifiutati dagli handler', async (t) => {
    const fixture = host(t, 'valid');
    stable(await (await fixture.select(read('request-selection'))).json());
    const ingest = live(read('request-ingest')) as { tuple: Record<string, unknown>; attachment: Record<string, unknown>; requestId: string };
    for (const altered of [
        { ...ingest, extra: true },
        { ...ingest, requestId: '1' },
        { ...ingest, attachment: { ...ingest.attachment, sources: [] } },
        { ...ingest, attachment: { ...ingest.attachment, patientRevision: 0 } },
    ]) {
        assert.equal((await fixture.ingest(altered)).status, 400);
    }
    assert.equal((await fixture.ingest({ ...ingest, tuple: { ...ingest.tuple, selectionEpoch: 99 } })).status, 409, 'selezione diversa da quella concessa');
    assert.equal((await fixture.preview({ handle: 'prj_x', requestId: CHART.requestIds[1] })).status, 400);
    const unknown = await fixture.preview({ handle: `prj_${'0'.repeat(32)}`, requestId: CHART.requestIds[1] });
    assert.equal((await unknown.json()).preview.code, 'projection_unavailable', 'maniglia mai emessa');
    assert.equal(fixture.prompts.length, 0);
});
