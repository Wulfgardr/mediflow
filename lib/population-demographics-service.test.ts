import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { eq } from 'drizzle-orm';
import { installNetworkPatientCookieFixture } from './network-patient-authority-test-fixture';
import { issueSyntheticWebSessionContext, retireSyntheticWebSession } from './security/web-auth-lifecycle-owner-test-fixture';
import { bindSessionToArchive, currentArchiveGeneration } from './security/archive-session-generation';
import { clearAllSessions, createNativeServerSession, captureNativeLoginSessionFence } from './security/server-session';
import { rotateSqliteArchiveGeneration } from './archive-generation';
import { NETWORK_MODE_KEY } from './network-contract';
import { hashNetworkPairedClientToken, NETWORK_PAIRING_STATE_KEY, serializeNetworkPairingState,
    type StoredNetworkPairedClient } from './network-pairing-model';
import { ambulatories, patients, patientsToAmbulatories, settings, users } from './schema';
import { POPULATION_DEMOGRAPHICS_CAPABILITY, type PopulationDemographicsResult } from './population-demographics';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-demographics-host-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server'); openDbServer();
const prepareSnapshot = openDbServer().prepare.bind(openDbServer());
const cookieState: { cookies: Map<string, string>; onCookies?: () => Promise<void> | void } = { cookies: new Map() };
const cleanup = installNetworkPatientCookieFixture(dataDir, cookieState);
const route = load('../app/api/v1/network/analytics/demographics/route.ts') as typeof import('../app/api/v1/network/analytics/demographics/route');
const scopeA = 'synthetic-demographics-a', scopeB = 'synthetic-demographics-b';
const user = { id: 'synthetic-demographics-operator', username: ['synthetic', 'demographics', 'operator'].join('-'), role: 'user' };
const token = 'synthetic-demographics-device-token';
let client: StoredNetworkPairedClient;
let sequence = 0;

function setting(key: string, value: string) {
    dbServer.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}
function pairing() {
    setting(NETWORK_PAIRING_STATE_KEY, JSON.stringify({
        ...JSON.parse(serializeNetworkPairingState({ clients: [client], intents: [] })), archiveGeneration: currentArchiveGeneration(),
    }));
}
function reset() {
    clearAllSessions(); cookieState.cookies.clear(); cookieState.onCookies = undefined;
    dbServer.delete(patientsToAmbulatories).run(); dbServer.delete(patients).run(); dbServer.delete(ambulatories).run(); dbServer.delete(users).run();
    dbServer.insert(ambulatories).values([
        { id: scopeA, name: 'Synthetic A', type: 'live', isDefault: true },
        { id: scopeB, name: 'Synthetic B', type: 'live', isDefault: false },
    ]).run();
    dbServer.insert(users).values({ ...user, passwordHash: 'synthetic-unused', encryptedMasterKey: 'synthetic-unused', salt: 'synthetic-unused' }).run();
    client = { clientId: 'synthetic-demographics-device', deviceName: 'Synthetic Linux', clientPlatform: 'linux',
        appVersion: 'synthetic', grantedCapabilities: [POPULATION_DEMOGRAPHICS_CAPABILITY],
        pairedAt: new Date().toISOString(), lastSeenAt: null, sourceIntentId: 'synthetic-demographics-intent',
        tokenHash: hashNetworkPairedClientToken(token) };
    setting(NETWORK_MODE_KEY, 'network-home-base'); pairing();
    const session = createNativeServerSession(user,
        { clientId: client.clientId, clientPlatform: client.clientPlatform, tokenHash: client.tokenHash }, captureNativeLoginSessionFence());
    assert.ok(session); bindSessionToArchive(session, currentArchiveGeneration());
    cookieState.cookies.set('mediflow_session', session.id); cookieState.cookies.set('ambulatory_id', scopeA);
}
function request(query = 'minAge=0&maxAge=120&timeZone=UTC', headerChanges: Record<string, string | null> = {}, signal?: AbortSignal) {
    const headers = new Headers({
        'x-mediflow-paired-client-id': client.clientId, 'x-mediflow-paired-client-token': token,
        'x-mediflow-expected-ambulatory-id': encodeURIComponent(cookieState.cookies.get('ambulatory_id') ?? scopeA),
        'x-mediflow-archive-generation': currentArchiveGeneration(),
    });
    for (const [key, value] of Object.entries(headerChanges)) { if (value === null) headers.delete(key); else headers.set(key, value); }
    return new Request(`http://127.0.0.1/api/v1/network/analytics/demographics?${query}`, { headers, signal });
}
function addPatient(id: string, values: Partial<typeof patients.$inferInsert> = {}, scopes = [scopeA]) {
    dbServer.insert(patients).values({ id, firstName: 'Persona', lastName: 'Sintetica', taxCode: 'SYNTHETIC-ONLY',
        birthDate: new Date('1980-01-01T00:00:00.000Z'), isAdi: true, notes: 'ENC:synthetic:notes',
        diagnoses: 'ENC:synthetic:diagnoses', ...values }).run();
    for (const ambulatoryId of scopes) dbServer.insert(patientsToAmbulatories).values({ patientId: id, ambulatoryId }).run();
}
function snapshot() {
    return Object.fromEntries((prepareSnapshot("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[])
        .map(({ name }) => [name, prepareSnapshot('SELECT * FROM "' + name.replaceAll('"', '""') + '"').all()]));
}
function watchPatientReads(t: TestContext, onRead?: () => void) {
    const queries: string[] = [], connection = openDbServer(), prepare = connection.prepare;
    t.mock.method(connection, 'prepare', function (this: typeof connection, sql: string) {
        const statement = prepare.call(this, sql);
        if (/\bfrom "patients"(?:\s|$)/iu.test(sql)) {
            queries.push(sql);
            if (onRead) {
                const all = statement.all as (...args: unknown[]) => unknown[];
                t.mock.method(statement, 'all', function (this: typeof statement, ...args: unknown[]) {
                    const rows = all.apply(this, args); onRead(); return rows;
                });
            }
        }
        return statement;
    });
    return queries;
}
async function assertDenied(response: Response, status: number) {
    assert.equal(response.status, status, await response.clone().text());
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json(); assert.equal('stats' in body, false); return body;
}
test.after(() => { clearAllSessions(); cleanup(); dbServer.$client.close(); rmSync(dataDir, { recursive: true, force: true }); });

test('real Linux paired operator reads only three fields from active M2M population, with no clinical or audit writes', async t => {
    reset();
    for (const [id, values, scopes] of [
        ['synthetic-shared', {}, [scopeA, scopeB]], ['synthetic-missing-date', { birthDate: null }, [scopeA]],
        ['synthetic-archived', { isArchived: true }, [scopeA]], ['synthetic-deleted', { deletedAt: new Date() }, [scopeA]],
        ['synthetic-outside', { ambulatoryId: scopeA }, [scopeB]], ['synthetic-legacy-only', { ambulatoryId: scopeA }, []],
        ['synthetic-null-flags', { isArchived: null, isAdi: null }, [scopeA]],
    ] as [string, Partial<typeof patients.$inferInsert>, string[]][]) addPatient(id, values, scopes);
    const before = snapshot(), started = Date.now(), queries = watchPatientReads(t);
    const response = await route.GET(request());
    assert.equal(response.status, 200, await response.clone().text());
    const body: PopulationDemographicsResult = await response.json();
    assert.deepEqual(body.stats, { totalInRange: 2, withBirthDate: 2, withoutBirthDate: 1, adiCount: 1,
        ageDist: { '0-18': 0, '19-64': 2, '65-80': 0, '80+': 0 } });
    assert.deepEqual(Object.keys(body).sort(), ['ageRange', 'contractVersion', 'observedAt', 'operation', 'scope', 'stats', 'timeZone']);
    assert.equal(body.operation, 'population-demographics.read.v1'); assert.equal(body.contractVersion, 1);
    assert.deepEqual(body.scope, { ambulatoryId: scopeA, archiveGeneration: currentArchiveGeneration() });
    assert.ok(Date.parse(body.observedAt) >= started && Date.parse(body.observedAt) <= Date.now());
    assert.deepEqual(body.ageRange, [0, 120]); assert.equal(body.timeZone, 'UTC');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(queries.length, 1);
    assert.match(queries[0], /^select "patients"\."birth_date", "patients"\."is_adi", "patients"\."is_archived" from "patients" inner join "patients_to_ambulatories"/u);
    assert.equal(/\blimit\b|first_name|last_name|tax_code|notes|diagnoses|address|phone/iu.test(queries[0]), false);
    assert.deepEqual(snapshot(), before);
});

test('membership is read at observation time and the real empty population is a successful zero', async () => {
    reset(); addPatient('synthetic-member');
    assert.equal(((await (await route.GET(request())).json()) as PopulationDemographicsResult).stats.totalInRange, 1);
    dbServer.delete(patientsToAmbulatories).run();
    const response = await route.GET(request()); assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).stats, { totalInRange: 0, withBirthDate: 0, withoutBirthDate: 0, adiCount: 0,
        ageDist: { '0-18': 0, '19-64': 0, '65-80': 0, '80+': 0 } });
});

test('invalid query, missing scope and wrong generation deny before any patient projection', async t => {
    reset(); addPatient('synthetic-member'); const before = snapshot(), queries = watchPatientReads(t);
    for (const candidate of ['minAge=0&maxAge=120', 'minAge=0&maxAge=120&timeZone=UTC&patientId=synthetic-member',
        'minAge=0&maxAge=120&timeZone=UTC&observedAt=2026-01-01']) {
        assert.equal((await assertDenied(await route.GET(request(candidate)), 400)).code, 'ANALYTICS_INVALID_QUERY');
    }
    await assertDenied(await route.GET(request(undefined, { 'x-mediflow-expected-ambulatory-id': null })), 403);
    await assertDenied(await route.GET(request(undefined, { 'x-mediflow-expected-ambulatory-id': scopeB })), 403);
    for (const generation of [null, 'synthetic-not-current']) {
        assert.equal((await assertDenied(await route.GET(request(undefined, { 'x-mediflow-archive-generation': generation })), 409)).code, 'ARCHIVE_REPLACED');
    }
    assert.deepEqual(queries, []); assert.deepEqual(snapshot(), before);
});

test('pairing alone, a foreign device, missing capability and disabled mode never grant a population read', async t => {
    reset(); addPatient('synthetic-member'); const before = snapshot(), queries = watchPatientReads(t);
    await assertDenied(await route.GET(request(undefined, { 'x-mediflow-paired-client-token': null })), 401);
    const session = cookieState.cookies.get('mediflow_session')!; cookieState.cookies.delete('mediflow_session');
    await assertDenied(await route.GET(request()), 401); cookieState.cookies.set('mediflow_session', session);
    const originalClientId = client.clientId; client.clientId = 'synthetic-foreign-device'; pairing();
    await assertDenied(await route.GET(request()), 401); client.clientId = originalClientId; pairing();
    client.grantedCapabilities = []; pairing(); await assertDenied(await route.GET(request()), 403);
    client.grantedCapabilities = [POPULATION_DEMOGRAPHICS_CAPABILITY]; pairing();
    setting(NETWORK_MODE_KEY, 'standalone'); await assertDenied(await route.GET(request()), 403);
    setting(NETWORK_MODE_KEY, 'network-home-base');
    assert.deepEqual(queries, []); assert.deepEqual(snapshot(), before);
});

for (const cause of ['session', 'pairing', 'capability', 'mode', 'role', 'scope', 'archive'] as const) {
    test(`retirement during the real asynchronous scope boundary denies ${cause} without reading patients`, { timeout: 10_000 }, async t => {
        reset(); addPatient('synthetic-member'); const queries = watchPatientReads(t), originalRequest = request();
        let enter!: () => void, release!: () => void, calls = 0;
        const reached = new Promise<void>(resolve => { enter = resolve; });
        const waiting = new Promise<void>(resolve => { release = resolve; });
        cookieState.onCookies = async () => { if (++calls === 3) { enter(); await waiting; } };
        const pending = route.GET(originalRequest);
        await Promise.race([reached, pending.then(() => { throw new Error('Synthetic scope wait was not reached'); })]);
        try {
            if (cause === 'session') clearAllSessions();
            if (cause === 'pairing') { client.tokenHash = hashNetworkPairedClientToken('synthetic-rotated-token'); pairing(); }
            if (cause === 'capability') { client.grantedCapabilities = []; pairing(); }
            if (cause === 'mode') setting(NETWORK_MODE_KEY, 'standalone');
            if (cause === 'role') dbServer.update(users).set({ role: 'admin' }).where(eq(users.id, user.id)).run();
            if (cause === 'scope') cookieState.cookies.set('ambulatory_id', scopeB);
            if (cause === 'archive') dbServer.$client.transaction(() => rotateSqliteArchiveGeneration(dbServer.$client)).immediate();
        } finally { release(); }
        const before = snapshot();
        const status = cause === 'archive' ? 409 : ['scope', 'capability', 'mode'].includes(cause) ? 403 : 401;
        await assertDenied(await pending, status); assert.deepEqual(queries, []); assert.deepEqual(snapshot(), before);
    });
}

test('retiring the original owner after the real SELECT prevents delivery by the final guard', async t => {
    reset(); addPatient('synthetic-member'); const before = snapshot();
    const queries = watchPatientReads(t, () => clearAllSessions());
    await assertDenied(await route.GET(request()), 401); assert.equal(queries.length, 1);
    t.mock.restoreAll();
    assert.deepEqual(snapshot(), before);
});

test('the Web channel keeps its physical owner and rejects that owner after retirement', async () => {
    reset(); addPatient('synthetic-member');
    const web = issueSyntheticWebSessionContext(user, `demographics-${++sequence}`);
    cookieState.cookies.set('mediflow_session', web.session.id); cookieState.cookies.set('mediflow_auth_control', web.controlId);
    const before = snapshot(); assert.equal((await route.GET(request())).status, 200);
    let calls = 0;
    cookieState.onCookies = () => { if (++calls === 2) retireSyntheticWebSession(web.session); };
    await assertDenied(await route.GET(request()), 401); assert.deepEqual(snapshot(), before);
});

test('read failures and cancellation are explicit and cannot masquerade as empty success', async t => {
    reset(); addPatient('synthetic-member'); const before = snapshot();
    const cancelled = new AbortController(); cancelled.abort();
    assert.equal((await assertDenied(await route.GET(request(undefined, {}, cancelled.signal)), 409)).code, 'ANALYTICS_CANCELLED');
    watchPatientReads(t, () => { throw new Error('synthetic SQL path and record must remain server-side'); });
    t.mock.method(console, 'error', () => undefined);
    assert.deepEqual(await assertDenied(await route.GET(request()), 500), { error: 'Errore interno del server.', code: 'internal_error' });
    t.mock.restoreAll();
    assert.deepEqual(snapshot(), before);
});

test('the response budget rejects a whole result without truncation', async () => {
    reset(); const largeScope = `synthetic-${'scope'.repeat(1000)}`;
    dbServer.insert(ambulatories).values({ id: largeScope, name: 'Synthetic long scope', type: 'live' }).run();
    cookieState.cookies.set('ambulatory_id', largeScope); const before = snapshot();
    assert.equal((await assertDenied(await route.GET(request()), 413)).code, 'ANALYTICS_OUTPUT_TOO_LARGE');
    assert.deepEqual(snapshot(), before);
});
