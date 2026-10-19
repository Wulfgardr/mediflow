/* ADR0153: real routes, selection owner, pairing/session, SQLite and AES; synthetic records only. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import { ambulatories, patients, patientsToAmbulatories, settings } from './schema';
import { installNetworkPatientCookieFixture, syntheticNetworkPatientAuthority } from './network-patient-authority-test-fixture';
import { NETWORK_PAIRING_STATE_KEY, serializeNetworkPairingState } from './network-pairing-model';
import { clearAllSessions, retireServerSessionForLogout } from './security/server-session';
import { currentArchiveGeneration } from './security/archive-session-generation';
import { encryptData, decryptData, generateMasterKey } from './security/security';
import { prepareScaleSubmission } from './scale-submission';
import { SCALES } from './scale-definitions';
import { SCALE_USE_CONTRACTS } from './scales/scale-use-contract';
import type { NetworkScalePreparation } from './network-scale-service';
import type { ScaleCatalog } from './scale-catalog';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-scales-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const cookieState: { cookies: Map<string, string>; onCookies?: () => void } = { cookies: new Map() };
const cleanupCookies = installNetworkPatientCookieFixture(dataDir, cookieState);
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server'); openDbServer();
const catalogRoute = load('../app/api/v1/network/scales/route.ts') as typeof import('../app/api/v1/network/scales/route');
const prepareRoute = load('../app/api/v1/network/patients/[id]/scales/prepare/route.ts') as typeof import('../app/api/v1/network/patients/[id]/scales/prepare/route');
const profileRoute = load('../app/api/v1/network/patients/[id]/profile-query/route.ts') as typeof import('../app/api/v1/network/patients/[id]/profile-query/route');
const epochRoute = load('../app/api/v1/network/patient-profile/selection-epoch/route.ts') as typeof import('../app/api/v1/network/patient-profile/selection-epoch/route');
const entryRoute = load('../app/api/v1/network/patients/[id]/entries/route.ts') as typeof import('../app/api/v1/network/patients/[id]/entries/route');
const entryDetail = load('../app/api/v1/network/patients/[id]/entries/[entryId]/route.ts') as typeof import('../app/api/v1/network/patients/[id]/entries/[entryId]/route');
const { networkScaleFailure } = load('./network-scale-service.ts') as typeof import('./network-scale-service');
const vectors = JSON.parse(readFileSync(join(process.cwd(), 'scripts/fixtures/clinical-scales-v1.json'), 'utf8')) as {
    scaleId: string; valid: { answers: Record<string, number>; score: number }[];
};
const CATALOG = 'network.catalogs.readonly', PATIENT_READ = 'network.replica.readonly-patients';
const PATIENT = 'synthetic-scale-patient-a', OTHER = 'synthetic-scale-patient-b', SCOPE = 'synthetic-scale-scope';
let authority: ReturnType<typeof syntheticNetworkPatientAuthority>;
let epoch = 0;

test.after(() => {
    clearAllSessions(); cleanupCookies(); dbServer.$client.close();
    rmSync(dataDir, { recursive: true, force: true });
});

function grant(capabilities: string[]) {
    authority.pairedClient.grantedCapabilities = capabilities;
    dbServer.update(settings).set({ value: JSON.stringify({
        ...JSON.parse(serializeNetworkPairingState({ clients: [authority.pairedClient], intents: [] })), archiveGeneration: currentArchiveGeneration(),
    }) }).where(eq(settings.key, NETWORK_PAIRING_STATE_KEY)).run();
}

async function reset(selected = true, capabilities = [CATALOG, PATIENT_READ]) {
    clearAllSessions(); cookieState.cookies.clear(); cookieState.onCookies = undefined;
    dbServer.$client.exec('DELETE FROM entries; DELETE FROM patients_to_ambulatories; DELETE FROM patients; DELETE FROM ambulatories; DELETE FROM users; DELETE FROM settings;');
    dbServer.insert(ambulatories).values({ id: SCOPE, name: 'Synthetic scale scope', isDefault: true }).run();
    for (const id of [PATIENT, OTHER]) {
        dbServer.insert(patients).values({ id, firstName: 'Synthetic', lastName: 'Scale', taxCode: 'SYNTHETIC-SCALE', version: 4 }).run();
        dbServer.insert(patientsToAmbulatories).values({ patientId: id, ambulatoryId: SCOPE }).run();
    }
    authority = syntheticNetworkPatientAuthority(dbServer, SCOPE); grant(capabilities);
    cookieState.cookies.set('mediflow_session', authority.session.id); cookieState.cookies.set('ambulatory_id', SCOPE);
    epoch = 0;
    if (selected) await select(PATIENT);
}

function request(path: string, body?: unknown, raw?: string) {
    const headers = new Headers(authority.request.headers);
    headers.set('content-type', 'application/json'); headers.set('x-mediflow-expected-ambulatory-id', SCOPE);
    return new Request(new URL(path, 'http://127.0.0.1'), { method: body === undefined && raw === undefined ? 'GET' : 'POST', headers,
        ...(body === undefined && raw === undefined ? {} : { body: raw ?? JSON.stringify(body) }) });
}

async function select(id: string) {
    const epochResponse = await epochRoute.GET(request('/api/v1/network/patient-profile/selection-epoch'));
    assert.equal(epochResponse.status, 200);
    const response = await profileRoute.POST(request(`/api/v1/network/patients/${id}/profile-query`, {
        kind: 'open', contractVersion: 1, projection: 'profile', expectedSelectionEpoch: (await epochResponse.json()).selectionEpoch,
    }), { params: Promise.resolve({ id }) });
    assert.equal(response.status, 200, await response.clone().text());
    epoch = (await response.json()).currentness.selectionEpoch;
}

function snapshot() {
    return Object.fromEntries((dbServer.$client.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[])
        .map(({ name }) => [name, dbServer.$client.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"').all()]));
}

async function catalog(): Promise<ScaleCatalog> {
    const response = await catalogRoute.GET(request('/api/v1/network/scales'));
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return response.json();
}

async function input() {
    return { contractVersion: 1, scaleId: vectors.scaleId, answers: vectors.valid[1].answers,
        expectedCatalogRevision: (await catalog()).catalogRevision, expectedPatientVersion: 4, expectedSelectionEpoch: epoch };
}

function prepare(body: unknown, id = PATIENT, raw?: string) {
    return prepareRoute.POST(request(`/api/v1/network/patients/${id}/scales/prepare`, body, raw), { params: Promise.resolve({ id }) });
}

test('catalog requires only the explicit catalog capability and serializes the five current definitions without effects', async () => {
    await reset(false, [CATALOG]);
    const before = snapshot(); const value = await catalog();
    assert.equal(value.contractVersion, 1); assert.equal(value.preparationVersion, 'mediflow.scales.prepare.v1');
    assert.match(value.catalogRevision, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(value.scales.map(scale => scale.id), Object.keys(SCALES).sort());
    for (const scale of value.scales) {
        assert.deepEqual(scale.questions, SCALES[scale.id].questions);
        assert.deepEqual(scale.instrument, SCALES[scale.id].instrument);
        assert.deepEqual(scale.useContract, SCALE_USE_CONTRACTS[scale.id as keyof typeof SCALE_USE_CONTRACTS]);
        assert.equal('scoringLogic' in scale || 'interpretation' in scale, false);
    }
    assert.deepEqual(await catalog(), value); assert.deepEqual(snapshot(), before);
});

test('preparation uses the existing POMA vector and returns the complete canonical draft with zero persistence', async () => {
    await reset(); const body = await input(); const before = snapshot();
    const response = await prepare(body); assert.equal(response.status, 200, await response.clone().text());
    const value: NetworkScalePreparation = await response.json();
    assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(value.status, 'draft');
    assert.deepEqual(value.context, { patientId: PATIENT, ambulatoryId: SCOPE, patientVersion: 4, selectionEpoch: epoch });
    assert.deepEqual(value.submission, prepareScaleSubmission(body.scaleId, body.answers));
    assert.equal(value.submission.metadata.score, vectors.valid[1].score);
    assert.equal(value.catalogRevision, body.expectedCatalogRevision); assert.deepEqual(snapshot(), before);
});

test('closed request rejects invented scoring, foreign or incomplete answers, retired instruments and coercion', async () => {
    await reset(); const body = await input(); const before = snapshot();
    const first = Object.keys(body.answers)[0];
    const incomplete = { ...body.answers }; delete incomplete[first];
    for (const value of [null, [], { ...body, score: 999 }, { ...body, interpretation: 'Synthetic invented outcome' },
        { ...body, metadata: {} }, { ...body, patientId: OTHER }, { ...body, scaleId: 'tinetti' }, { ...body, scaleId: 'unknown' },
        { ...body, answers: incomplete }, { ...body, answers: { ...body.answers, unknown: 1 } },
        { ...body, answers: { ...body.answers, [first]: '1' } }, { ...body, answers: { ...body.answers, [first]: 0.5 } },
        { ...body, expectedPatientVersion: '4' }, { ...body, expectedSelectionEpoch: -1 }]) {
        const response = await prepare(value); assert.equal(response.status, 400, JSON.stringify(value));
        assert.equal(response.headers.get('cache-control'), 'no-store'); assert.deepEqual(snapshot(), before);
    }
});

test('the new route keeps the inclusive 65536-byte bound and rejects query parameters without effects', async () => {
    await reset(); const body = await input(); const before = snapshot();
    const json = JSON.stringify(body), bytes = Buffer.byteLength(json);
    assert.equal((await prepare(body, PATIENT, json + ' '.repeat(65536 - bytes))).status, 200);
    const oversized = await prepare(body, PATIENT, json + ' '.repeat(65537 - bytes));
    assert.equal(oversized.status, 413); assert.equal((await oversized.json()).code, 'JSON_BODY_TOO_LARGE');
    assert.equal(oversized.headers.get('cache-control'), 'no-store');
    assert.equal((await catalogRoute.GET(request('/api/v1/network/scales?scale=adl'))).status, 400);
    assert.equal((await prepareRoute.POST(request(`/api/v1/network/patients/${PATIENT}/scales/prepare?score=2`, body),
        { params: Promise.resolve({ id: PATIENT }) })).status, 400);
    assert.deepEqual(snapshot(), before);
});

test('capability and scope assertions deny before preparation without granting diary write', async () => {
    await reset(); const body = await input();
    for (const capabilities of [[CATALOG], [PATIENT_READ]]) {
        grant(capabilities); const before = snapshot();
        const response = await prepare(body); assert.equal(response.status, 403); assert.deepEqual(snapshot(), before);
    }
    grant([CATALOG, PATIENT_READ]);
    const wrongScope = request(`/api/v1/network/patients/${PATIENT}/scales/prepare`, body);
    wrongScope.headers.set('x-mediflow-expected-ambulatory-id', 'synthetic-other-scope');
    assert.equal((await prepareRoute.POST(wrongScope, { params: Promise.resolve({ id: PATIENT }) })).status, 403);
    const write = await entryRoute.POST(request(`/api/v1/network/patients/${PATIENT}/entries`, { type: 'scale' }), { params: Promise.resolve({ id: PATIENT }) });
    assert.equal(write.status, 403);
});

test('current catalog, patient revision and actual host selection are required', async () => {
    await reset(); const body = await input(); const before = snapshot();
    for (const changed of [{ ...body, expectedCatalogRevision: `sha256:${'0'.repeat(64)}` },
        { ...body, expectedPatientVersion: 3 }, { ...body, expectedSelectionEpoch: epoch + 1 }]) {
        assert.equal((await prepare(changed)).status, 409);
    }
    assert.equal((await prepare(body, OTHER)).status, 409); assert.deepEqual(snapshot(), before);
    await reset(false); const absent = await input();
    assert.equal((await prepare(absent)).status, 409, 'The local window epoch cannot create a host selection');
});

for (const change of ['session', 'catalog-capability', 'patient-capability', 'selection', 'patient-version', 'membership'] as const) {
    test(`preparation after ${change} changes during body read is never delivered`, async () => {
        await reset(); const body = await input();
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
        const source = request(`/api/v1/network/patients/${PATIENT}/scales/prepare`, body);
        const pendingRequest = new Request(source.url, { method: 'POST', headers: source.headers, body: stream, duplex: 'half' } as RequestInit);
        let reading = false;
        const getReader = pendingRequest.body!.getReader.bind(pendingRequest.body);
        Object.defineProperty(pendingRequest.body, 'getReader', { value: () => { reading = true; return getReader(); } });
        const pending = prepareRoute.POST(pendingRequest, { params: Promise.resolve({ id: PATIENT }) });
        for (let index = 0; index < 1000 && !reading; index++) await new Promise<void>(resolve => setImmediate(resolve));
        assert.ok(reading);
        if (change === 'session') retireServerSessionForLogout(authority.session.id);
        else if (change === 'catalog-capability') grant([PATIENT_READ]);
        else if (change === 'patient-capability') grant([CATALOG]);
        else if (change === 'selection') await select(OTHER);
        else if (change === 'patient-version') dbServer.update(patients).set({ version: 5 }).where(eq(patients.id, PATIENT)).run();
        else dbServer.delete(patientsToAmbulatories).where(eq(patientsToAmbulatories.patientId, PATIENT)).run();
        const before = snapshot();
        controller.enqueue(new TextEncoder().encode(JSON.stringify(body))); controller.close();
        const response = await pending;
        assert.equal(response.status, change === 'session' ? 401 : change === 'selection' || change === 'patient-version' ? 409 : 403);
        assert.doesNotMatch(await response.text(), /submission|POMA|poma28v1/); assert.deepEqual(snapshot(), before);
    });
}

test('the last cookie await cannot revive a retired session or return internal calculation errors', async () => {
    await reset(); const body = await input();
    const source = request(`/api/v1/network/patients/${PATIENT}/scales/prepare`, body);
    const getReader = source.body!.getReader.bind(source.body);
    Object.defineProperty(source.body, 'getReader', { value: () => {
        cookieState.onCookies = () => { cookieState.onCookies = undefined; retireServerSessionForLogout(authority.session.id); };
        return getReader();
    } });
    const before = snapshot();
    assert.equal((await prepareRoute.POST(source, { params: Promise.resolve({ id: PATIENT }) })).status, 401);
    assert.deepEqual(snapshot(), before);
    const unavailable = networkScaleFailure(new Error('Synthetic clinical answer and private internals'));
    assert.equal(unavailable.status, 503); assert.equal(unavailable.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(await unavailable.text(), /clinical answer|private internals/);
});

test('a reviewed synthetic submission uses the ordinary AES diary writer, rereads exactly, replays once and rolls back audit failure', async () => {
    await reset(); const body = await input();
    const response = await prepare(body); assert.equal(response.status, 200);
    const prepared: NetworkScalePreparation = await response.json();
    grant([CATALOG, PATIENT_READ, 'network.replica.write-clinical-diary', 'network.replica.readonly-clinical-diary']);
    const key = await generateMasterKey();
    const seal = async (value: unknown) => { const encrypted = await encryptData(value, key); return `ENC:${encrypted.iv}:${encrypted.data}`; };
    const open = async (value: string) => { const [, iv, data] = value.split(':'); return decryptData(data, iv, key); };
    const [title, content, metadata] = await Promise.all([prepared.submission.title, prepared.submission.content, prepared.submission.metadata].map(seal));
    const payload = { id: 'synthetic-scale-entry', type: 'scale', title, content, metadata, date: '2026-10-19T10:00:00.000Z', setting: 'ambulatory' };
    const params = { params: Promise.resolve({ id: PATIENT }) };
    const count = () => (dbServer.$client.prepare('SELECT count(*) n FROM audit_events').get() as { n: number }).n;
    const beforeCount = count();
    const saved = await entryRoute.POST(request(`/api/v1/network/patients/${PATIENT}/entries`, payload), params);
    assert.equal(saved.status, 201, await saved.clone().text()); assert.equal(count(), beforeCount + 1);
    const reread = await entryDetail.GET(request(`/api/v1/network/patients/${PATIENT}/entries/${payload.id}`),
        { params: Promise.resolve({ id: PATIENT, entryId: payload.id }) });
    assert.equal(reread.status, 200); const entry = await reread.json();
    assert.equal(entry.id, payload.id); assert.equal(entry.patientId, PATIENT); assert.equal(entry.version, 1);
    assert.equal(entry.type, 'scale'); assert.equal(entry.date, payload.date); assert.equal(entry.setting, payload.setting);
    assert.deepEqual({ title: await open(entry.title), content: await open(entry.content), metadata: await open(entry.metadata) }, prepared.submission);
    assert.equal(entry.deletedAt, null); assert.equal(entry.attachments, null);
    const audit = dbServer.$client.prepare("SELECT actor_ref, event_type, redacted_metadata FROM audit_events WHERE subject_ref=?").get(payload.id) as Record<string, string>;
    assert.equal(audit.actor_ref, authority.session.userId); assert.equal(audit.event_type, 'entry.created');
    assert.doesNotMatch(audit.redacted_metadata, /POMA|poma28v1|Punteggio|Interpretazione/);
    const committed = snapshot();
    const replay = await entryRoute.POST(request(`/api/v1/network/patients/${PATIENT}/entries`, payload), params);
    assert.equal(replay.status, 200); assert.equal((await replay.json()).idempotent, true); assert.deepEqual(snapshot(), committed);
    dbServer.$client.exec("CREATE TRIGGER synthetic_scale_audit_fault BEFORE INSERT ON audit_events WHEN NEW.event_type='entry.created' BEGIN SELECT RAISE(ABORT, 'synthetic_scale_audit_fault'); END");
    try {
        const denied = await entryRoute.POST(request(`/api/v1/network/patients/${PATIENT}/entries`, { ...payload, id: 'synthetic-scale-audit-fault' }), params);
        assert.equal(denied.status, 500); assert.deepEqual(snapshot(), committed);
    } finally { dbServer.$client.exec('DROP TRIGGER synthetic_scale_audit_fault'); }
});
