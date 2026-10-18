import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import { installNetworkPatientCookieFixture, syntheticNetworkPatientAuthority } from './network-patient-authority-test-fixture';
import { issueSyntheticWebSessionContext, retireSyntheticWebSession } from './security/web-auth-lifecycle-owner-test-fixture';
import { clearAllSessions, createNativeServerSession, captureNativeLoginSessionFence } from './security/server-session';
import { bindSessionToArchive, currentArchiveGeneration } from './security/archive-session-generation';
import { serializeNetworkPairingState, NETWORK_PAIRING_STATE_KEY } from './network-pairing-model';
import { ambulatories, patients, patientsToAmbulatories, settings, users } from './schema';
import { isProfileResult, PROFILE_FIELD_NAMES, PROFILE_QUERY_MAX_RESULT_BYTES, assertProfileResultBudget,
    type ProfileQuery, type ProfileResult } from './patient-profile-scoped-contract';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-scoped-profile-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server');
openDbServer();
const cookieState: { cookies: Map<string, string>; onCookies?: () => Promise<void> | void } = { cookies: new Map() };
const cleanup = installNetworkPatientCookieFixture(dataDir, cookieState);
const web = load('../app/api/patients/[id]/profile-query/route.ts') as typeof import('../app/api/patients/[id]/profile-query/route');
const network = load('../app/api/v1/network/patients/[id]/profile-query/route.ts') as typeof import('../app/api/v1/network/patients/[id]/profile-query/route');
const epochWeb = load('../app/api/patient-profile/selection-epoch/route.ts') as typeof import('../app/api/patient-profile/selection-epoch/route');
const epochNetwork = load('../app/api/v1/network/patient-profile/selection-epoch/route.ts') as typeof import('../app/api/v1/network/patient-profile/selection-epoch/route');
const { acquirePatientProfileQueryHostPort } = load('./security/patient-profile-query-host-port.ts') as typeof import('./security/patient-profile-query-host-port');
let authority: ReturnType<typeof syntheticNetworkPatientAuthority>;
let webSession: ReturnType<typeof issueSyntheticWebSessionContext>;
const patientA = 'scoped-synthetic-a', patientB = 'scoped-synthetic-b';
const notes = 'ENC:c3ludGhldGlj:bm90ZXM=';

function grant(platform: 'ipados' | 'windows' | 'linux' = 'ipados', capabilities = ['network.replica.readonly-patients']) {
    const previousPlatform = authority.pairedClient.clientPlatform;
    authority.pairedClient = { ...authority.pairedClient, clientPlatform: platform, grantedCapabilities: capabilities };
    dbServer.insert(settings).values({ key: NETWORK_PAIRING_STATE_KEY, value: JSON.stringify({
        ...JSON.parse(serializeNetworkPairingState({ intents: [], clients: [authority.pairedClient] })), archiveGeneration: currentArchiveGeneration(),
    }) }).onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify({
        ...JSON.parse(serializeNetworkPairingState({ intents: [], clients: [authority.pairedClient] })), archiveGeneration: currentArchiveGeneration(),
    }) } }).run();
    if (previousPlatform !== platform) {
        authority.session = createNativeServerSession({ id: authority.session.userId, username: authority.session.username, role: authority.session.role },
            { clientId: authority.pairedClient.clientId, clientPlatform: platform, tokenHash: authority.pairedClient.tokenHash }, captureNativeLoginSessionFence())!;
        bindSessionToArchive(authority.session, currentArchiveGeneration());
    }
}

function reset() {
    clearAllSessions(); cookieState.onCookies = undefined;
    dbServer.delete(patientsToAmbulatories).run(); dbServer.delete(patients).run();
    dbServer.delete(ambulatories).run(); dbServer.delete(users).run(); dbServer.delete(settings).run();
    dbServer.insert(ambulatories).values([{ id: 'scope-a', name: 'Synthetic A', type: 'live', isDefault: true },
        { id: 'scope-b', name: 'Synthetic B', type: 'live' }]).run();
    for (const id of [patientA, patientB]) {
        dbServer.insert(patients).values({ id, firstName: 'Ada', lastName: 'Sintetica', taxCode: 'SYNTHETIC-SCOPED',
            birthDate: new Date(0), createdAt: new Date(0), updatedAt: new Date(0), ambulatoryId: 'scope-a',
            version: 4, notes, isArchived: false, documentInsights: 'synthetic-internal-id-only-blob', aiSummary: 'synthetic-private-summary' }).run();
        dbServer.insert(patientsToAmbulatories).values({ patientId: id, ambulatoryId: 'scope-a' }).run();
    }
    authority = syntheticNetworkPatientAuthority(dbServer, 'scope-a'); grant();
    webSession = issueSyntheticWebSessionContext({ id: authority.session.userId, username: authority.session.username, role: authority.session.role }, Math.random().toString());
    select('web');
}
function select(lane: 'web' | 'network') {
    cookieState.cookies.clear(); cookieState.cookies.set('mediflow_session', lane === 'web' ? webSession.session.id : authority.session.id);
    if (lane === 'web') cookieState.cookies.set('mediflow_auth_control', webSession.controlId);
    cookieState.cookies.set('ambulatory_id', 'scope-a');
}
function request(lane: 'web' | 'network', body?: unknown) {
    const headers = new Headers(lane === 'network' ? authority.request.headers : {});
    headers.set('content-type', 'application/json'); headers.set('origin', 'http://127.0.0.1'); headers.set('sec-fetch-site', 'same-origin');
    headers.set('x-mediflow-archive-generation', currentArchiveGeneration());
    headers.set('x-mediflow-expected-ambulatory-id', 'scope-a');
    return new Request('http://127.0.0.1/api/patients/' + patientA + '/profile-query', {
        method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}
const open = (epoch: number, projection: 'profile' | 'notes' = 'profile'): ProfileQuery => ({ kind: 'open', contractVersion: 1, projection, expectedSelectionEpoch: epoch });
const reread = (result: ProfileResult, projection = result.projection): ProfileQuery => ({ kind: 'read', contractVersion: 1,
    handle: result.handle, expectedRevision: result.currentness.revision, projection });
async function query(lane: 'web' | 'network', input: ProfileQuery | unknown, id = patientA) {
    return (lane === 'web' ? web : network).POST(request(lane, input), { params: Promise.resolve({ id }) });
}
async function epoch(lane: 'web' | 'network') {
    const response = await (lane === 'web' ? epochWeb : epochNetwork).GET(request(lane));
    assert.equal(response.status, 200); return (await response.json()).selectionEpoch as number;
}
function snapshot() {
    return Object.fromEntries((dbServer.$client.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[])
        .map(({ name }) => [name, dbServer.$client.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"').all()]));
}
test.after(() => { clearAllSessions(); cleanup(); dbServer.$client.close(); rmSync(dataDir, { recursive: true, force: true }); });

for (const lane of ['web', 'network'] as const) test(`${lane}: real scoped adapters open, retry and restrict without identifiers or database/audit mutations`, async () => {
    reset(); select(lane); const before = snapshot();
    const response = await query(lane, open(await epoch(lane))); assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json() as ProfileResult;
    assert.equal(isProfileResult(result), true); assert.deepEqual(Object.keys(result.profile).sort(), [...PROFILE_FIELD_NAMES].sort());
    assert.equal(result.profile.notes, notes); assert.equal(JSON.stringify(result).includes('synthetic-internal-id-only-blob'), false);
    assert.equal(JSON.stringify(result).includes(patientA), false); assert.equal(JSON.stringify(result).includes('scope-a'), false);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const again = await query(lane, reread(result)); assert.equal(again.status, 200); assert.equal((await again.json()).handle, result.handle);
    const restricted = await query(lane, reread(result, 'notes')); assert.equal(restricted.status, 200); assert.deepEqual((await restricted.json()).profile, { notes });
    assert.deepEqual(snapshot(), before);
});

test('real adapters reject forged, wrong-patient, wrong-scope, wrong-revision, widened and superseded references', async () => {
    reset(); const first = await (await query('web', open(0, 'notes'))).json() as ProfileResult;
    assert.equal((await query('web', { ...reread(first), handle: 'pph_' + '0'.repeat(64) })).status, 409);
    assert.equal((await query('web', reread(first), patientB)).status, 403);
    assert.equal((await query('web', { ...reread(first), expectedRevision: 999 })).status, 409);
    assert.equal((await query('web', reread(first, 'profile'))).status, 403);
    cookieState.cookies.set('ambulatory_id', 'scope-b'); assert.equal((await query('web', reread(first))).status, 403);
    cookieState.cookies.set('ambulatory_id', 'scope-a');
    const second = await query('web', open(first.currentness.selectionEpoch), patientB); assert.equal(second.status, 200);
    assert.equal((await query('web', open(first.currentness.selectionEpoch), patientA)).status, 409);
    assert.equal((await query('web', reread(first))).status, 409);
});

test('read never turns a missing handle or missing revision into an open, and body authority cannot be smuggled', async () => {
    reset(); const before = snapshot();
    for (const input of [{ kind: 'read', contractVersion: 1, projection: 'profile' },
        { kind: 'read', contractVersion: 1, projection: 'profile', handle: 'pph_' + '1'.repeat(64) },
        { ...open(0), actor: 'admin' }, { ...open(0), ambulatoryId: 'scope-b' }, { ...open(0), contractVersion: 2 }]) {
        assert.equal((await query('web', input)).status, 400);
    }
    assert.deepEqual(snapshot(), before);
});

test('unauthenticated request does not parse body or resolve patient parameters', async () => {
    reset(); cookieState.cookies.clear(); let touched = 0;
    const req = request('web', open(0)); Object.defineProperty(req, 'json', { value: async () => { touched++; return open(0); } });
    const result = await web.POST(req, { params: { then() { touched++; throw new Error('must not resolve'); } } as never });
    assert.equal(result.status, 401); assert.equal(touched, 0);
});

for (const transition of ['role', 'lock', 'capability'] as const) test(`real admission is revalidated after body awaits: ${transition}`, async () => {
    reset(); const lane = transition === 'capability' ? 'network' : 'web'; select(lane);
    const req = request(lane, open(0)); Object.defineProperty(req, 'json', { value: async () => {
        await Promise.resolve();
        if (transition === 'role') dbServer.update(users).set({ role: 'user' }).where(eq(users.id, webSession.session.userId)).run();
        if (transition === 'lock') retireSyntheticWebSession(webSession.session);
        if (transition === 'capability') grant('ipados', []);
        return open(0);
    } });
    const before = snapshot();
    const response = await (lane === 'web' ? web : network).POST(req, { params: Promise.resolve({ id: patientA }) });
    assert.ok(response.status === 401 || response.status === 403); assert.equal((await response.json()).profile, undefined);
    assert.deepEqual(snapshot().patients, before.patients); assert.deepEqual(snapshot().audit_events, before.audit_events);
});

for (const platform of ['windows', 'linux'] as const) test(`${platform}: native scoped read needs no AI grant and emits no inference/commit authority`, async () => {
    reset(); grant(platform); select('network');
    const response = await query('network', open(await epoch('network'))); assert.equal(response.status, 200, await response.clone().text());
    const { nativeProfileSelectionOwner } = load('./security/native-profile-selection-owner.ts') as typeof import('./security/native-profile-selection-owner');
    const owner = nativeProfileSelectionOwner.registry.acquire(authority.session);
    assert.deepEqual(Object.keys(owner).sort(), ['dispose', 'issueSelection', 'snapshotSelectionEpoch', 'withLeaseCriticalSection']);
    const inference = load('./security/native-inference-lifecycle.ts') as typeof import('./security/native-inference-lifecycle');
    assert.equal(inference.mintResourcePort(authority.session), null);
    for (const method of ['resolveProjectionService', 'acquireProjectionIngest', 'mintPatientInsightLeaseCommitPort',
        'mintOcrLeaseCommitPort', 'mintDocumentSynthesisLeaseCommitPort', 'mintTreatmentReasoningLeaseCommitPort', 'mintDurableReviewCommitPort']) {
        assert.equal(Reflect.get(owner, method), undefined);
    }
});

test('headless host port opens only the activated selection and revokes without reselection or clinical effects', async () => {
    reset(); const selected = await (await query('web', open(0))).json() as ProfileResult;
    const port = await acquirePatientProfileQueryHostPort('notes', Date.now() + 60_000); assert.ok(port);
    const before = snapshot(); const input = open(selected.currentness.selectionEpoch, 'notes');
    const first = await port.executeProfileQuery(input); assert.equal(first.currentness.selectionEpoch, selected.currentness.selectionEpoch);
    assert.deepEqual(first.profile, { notes });
    assert.equal((await port.executeProfileQuery(reread(first))).handle, first.handle);
    await assert.rejects(port.executeProfileQuery(open(first.currentness.selectionEpoch, 'profile')), { code: 'scope_denied' });
    await assert.rejects(port.executeProfileQuery(open(0, 'notes')), { code: 'selection_conflict' });
    assert.deepEqual(snapshot(), before);
    port.dispose(); await assert.rejects(port.executeProfileQuery(reread(first)), { code: 'handle_unavailable' });
});

test('shared JSON UTF-8 budget admits exactly the boundary, rejects Unicode/escaping oversize without truncation', async () => {
    reset(); const base = await (await query('web', open(0, 'notes'))).json() as ProfileResult;
    const empty = { ...base, profile: { notes: '' } } as ProfileResult;
    const overhead = new TextEncoder().encode(JSON.stringify(empty)).byteLength;
    const exact = { ...empty, profile: { notes: 'x'.repeat(PROFILE_QUERY_MAX_RESULT_BYTES - overhead) } } as ProfileResult;
    assertProfileResultBudget(exact);
    assert.throws(() => assertProfileResultBudget({ ...exact, profile: { notes: exact.profile.notes + 'é' } } as ProfileResult), { code: 'output_too_large' });
    assert.throws(() => assertProfileResultBudget({ ...exact, profile: { notes: exact.profile.notes + '"' } } as ProfileResult), { code: 'output_too_large' });
    dbServer.update(patients).set({ notes: 'é"'.repeat(PROFILE_QUERY_MAX_RESULT_BYTES) }).where(eq(patients.id, patientA)).run();
    const response = await query('web', open(await epoch('web'), 'notes'));
    assert.equal(response.status, 413); const body = await response.json(); assert.equal(body.code, 'output_too_large');
    assert.equal(body.profile, undefined); assert.equal(body.handle, undefined);
});

test('scope preserves canonical missing-cookie fallback and rejects expected/default drift after awaits', async () => {
    reset(); cookieState.cookies.set('ambulatory_id', 'deleted-synthetic-scope');
    const firstResponse = await query('web', open(0)); assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json() as ProfileResult;
    const mismatch = request('web', reread(first)); mismatch.headers.set('x-mediflow-expected-ambulatory-id', 'scope-b');
    assert.equal((await web.POST(mismatch, { params: Promise.resolve({ id: patientA }) })).status, 403);
    const changed = request('web', reread(first)); Object.defineProperty(changed, 'json', { value: async () => {
        await Promise.resolve();
        dbServer.update(ambulatories).set({ isDefault: false }).where(eq(ambulatories.id, 'scope-a')).run();
        dbServer.update(ambulatories).set({ isDefault: true }).where(eq(ambulatories.id, 'scope-b')).run();
        return reread(first);
    } });
    assert.equal((await web.POST(changed, { params: Promise.resolve({ id: patientA }) })).status, 403);
});

test('an opening paused on route params cannot silently reselect A after B wins the epoch', async () => {
    reset(); let release!: (value: { id: string }) => void;
    const paused = new Promise<{ id: string }>(resolve => { release = resolve; });
    const pending = web.POST(request('web', open(0)), { params: paused });
    await new Promise<void>(resolve => setImmediate(resolve));
    const secondResponse = await query('web', open(0), patientB); assert.equal(secondResponse.status, 200);
    const second = await secondResponse.json() as ProfileResult;
    release({ id: patientA }); assert.equal((await pending).status, 409);
    assert.equal((await query('web', reread(second), patientB)).status, 200);
});

test('expired, version-stale and new-session references never return profile data', async t => {
    reset(); const first = await (await query('web', open(0))).json() as ProfileResult;
    const clock = t.mock.method(Date, 'now', () => first.currentness.expiresAt + 1);
    const expired = await query('web', reread(first)); assert.equal(expired.status, 410); assert.equal((await expired.json()).profile, undefined);
    clock.mock.restore();
    dbServer.update(patients).set({ version: 5 }).where(eq(patients.id, patientA)).run();
    const stale = await query('web', reread(first)); assert.equal(stale.status, 409); assert.equal((await stale.json()).profile, undefined);
    webSession = issueSyntheticWebSessionContext({ id: authority.session.userId, username: authority.session.username, role: authority.session.role }, Math.random().toString());
    select('web'); const restarted = await query('web', reread(first)); assert.equal(restarted.status, 409);
    assert.equal((await restarted.json()).profile, undefined);
});

test('observed role drift permanently retires the host owner and old handle after role restoration', async () => {
    reset(); const selected = await (await query('web', open(0))).json() as ProfileResult;
    const port = await acquirePatientProfileQueryHostPort('profile', Date.now() + 60_000); assert.ok(port);
    const first = await port.executeProfileQuery(open(selected.currentness.selectionEpoch));
    dbServer.update(users).set({ role: 'user' }).where(eq(users.id, authority.session.userId)).run();
    await assert.rejects(port.executeProfileQuery(reread(first)), { code: 'session_unavailable' });
    dbServer.update(users).set({ role: authority.session.role }).where(eq(users.id, authority.session.userId)).run();
    await assert.rejects(port.executeProfileQuery(reread(first)), { code: 'handle_unavailable' });
    const oldHttp = await query('web', reread(selected)); assert.ok(oldHttp.status >= 400); assert.equal((await oldHttp.json()).profile, undefined);
});

test('real Web dispatcher requires its admitted port and publishes only the current scoped result', async () => {
    reset(); const selected = await (await query('web', open(0))).json() as ProfileResult;
    const acquired = await acquirePatientProfileQueryHostPort('notes', Date.now() + 60_000); assert.ok(acquired);
    const { createPatientProfileQueryWebDispatcher } = load('./security/patient-profile-query-web-dispatcher.ts') as typeof import('./security/patient-profile-query-web-dispatcher');
    const { encodePatientProfileQueryIpcFrameV1, decodePatientProfileQueryIpcFrameV1 } = load('../packages/aip/src/patient-profile-query-ipc.ts') as typeof import('../packages/aip/src/patient-profile-query-ipc');
    let port: typeof acquired | null = null, failures = 0;
    const frames: string[] = [];
    const dispatcher = createPatientProfileQueryWebDispatcher({ readPort: () => port, send: value => { frames.push(value); }, onProtocolFailure: () => { failures++; } });
    const frame = (digit: string) => encodePatientProfileQueryIpcFrameV1({ schemaVersion: 'mediflow.patient-profile.ipc.v1', type: 'query',
        requestRef: 'ppqr_' + digit.repeat(32), operationId: 'patient-profile.read.v1', input: open(selected.currentness.selectionEpoch, 'notes') });
    await dispatcher.accept(frame('1'));
    const denied = decodePatientProfileQueryIpcFrameV1(frames.pop()!); assert.equal(denied.type, 'query_result');
    assert.equal(Reflect.get(denied, 'outcome'), 'denied'); assert.equal(Reflect.get(denied, 'result'), undefined);
    port = acquired; const before = snapshot(); await dispatcher.accept(frame('2'));
    const result = decodePatientProfileQueryIpcFrameV1(frames.pop()!);
    assert.equal(Reflect.get(result, 'outcome'), 'completed'); assert.deepEqual({ ...Reflect.get(result, 'result').profile }, { notes });
    assert.deepEqual(snapshot(), before);
    await dispatcher.accept(frame('2')); assert.equal(failures, 1); assert.equal(frames.length, 0);
    acquired.dispose();
});

for (const transition of ['lock', 'role'] as const) test(`dispatcher withholds a result invalidated during its publication await: ${transition}`, async () => {
    reset(); const selected = await (await query('web', open(0))).json() as ProfileResult;
    const port = await acquirePatientProfileQueryHostPort('profile', Date.now() + 60_000); assert.ok(port);
    const { createPatientProfileQueryWebDispatcher } = load('./security/patient-profile-query-web-dispatcher.ts') as typeof import('./security/patient-profile-query-web-dispatcher');
    const { encodePatientProfileQueryIpcFrameV1, decodePatientProfileQueryIpcFrameV1 } = load('../packages/aip/src/patient-profile-query-ipc.ts') as typeof import('../packages/aip/src/patient-profile-query-ipc');
    const frames: string[] = [];
    const dispatcher = createPatientProfileQueryWebDispatcher({ readPort: () => port, send: frame => { frames.push(frame); }, onProtocolFailure() { assert.fail('valid request is not protocol failure'); } });
    const pending = dispatcher.accept(encodePatientProfileQueryIpcFrameV1({ schemaVersion: 'mediflow.patient-profile.ipc.v1', type: 'query',
        requestRef: 'ppqr_' + '3'.repeat(32), operationId: 'patient-profile.read.v1', input: open(selected.currentness.selectionEpoch) }));
    if (transition === 'lock') retireSyntheticWebSession(webSession.session);
    else dbServer.update(users).set({ role: 'user' }).where(eq(users.id, webSession.session.userId)).run();
    await pending; const response = decodePatientProfileQueryIpcFrameV1(frames[0]);
    assert.equal(Reflect.get(response, 'outcome'), 'denied'); assert.equal(Reflect.get(response, 'result'), undefined);
    port.dispose();
});

test('MCP contracts import directly in Node strip-only mode without a transform loader', () => {
    const moduleUrl = new URL('../packages/mcp/src/contracts.ts', import.meta.url).href;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(moduleUrl)})`],
        { encoding: 'utf8', timeout: 10_000, env: { ...process.env, NODE_OPTIONS: '' } });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
});

for (const lane of ['web', 'network'] as const) test(`${lane}: scoped open, real PUT, epoch observation and explicit fresh readback`, async () => {
    reset(); if (lane === 'network') grant('ipados', ['network.replica.readonly-patients', 'network.replica.write-patient-profile']); select(lane);
    const initial = await (await query(lane, open(await epoch(lane)))).json() as ProfileResult;
    const writer = load(lane === 'web' ? '../app/api/patients/[id]/route.ts' : '../app/api/v1/network/patients/[id]/route.ts');
    const base = request(lane); const req = new Request(base.url, { method: 'PUT', headers: base.headers,
        body: JSON.stringify({ version: initial.currentness.revision, notes: 'ENC:aXY=:dXBkYXRlZA==' }) });
    const update = await writer.PUT(req, { params: Promise.resolve({ id: patientA }) });
    assert.equal(update.status, 200, await update.clone().text());
    const epochResponse = await (lane === 'web' ? epochWeb : epochNetwork).GET(request(lane));
    assert.equal(epochResponse.status, 200, await epochResponse.clone().text());
    const currentEpoch = (await epochResponse.json()).selectionEpoch; assert.ok(currentEpoch >= initial.currentness.selectionEpoch);
    const before = snapshot();
    const freshResponse = await query(lane, open(currentEpoch)); assert.equal(freshResponse.status, 200, await freshResponse.clone().text());
    const fresh = await freshResponse.json() as ProfileResult; assert.equal(fresh.currentness.revision, initial.currentness.revision + 1);
    assert.equal(fresh.profile.notes, 'ENC:aXY=:dXBkYXRlZA=='); assert.notEqual(fresh.handle, initial.handle); assert.ok(fresh.currentness.selectionEpoch > initial.currentness.selectionEpoch);
    assert.equal((await query(lane, reread(fresh))).status, 200); assert.ok((await query(lane, reread(initial))).status >= 400);
    assert.deepEqual(snapshot(), before);
    if (lane === 'web') retireSyntheticWebSession(webSession.session); else grant('ipados', []);
    const revoked = await (lane === 'web' ? epochWeb : epochNetwork).GET(request(lane));
    assert.ok(revoked.status === 401 || revoked.status === 403);
    assert.equal((await revoked.json()).selectionEpoch, undefined);
});

test('headless handle deadline intersects the acknowledged host grant despite query skew and never renews on read', async () => {
    reset(); const selected = await (await query('web', open(0))).json() as ProfileResult;
    const originalNow = Date.now; const capturedAt = originalNow(); const deadline = capturedAt + 60_000;
    try {
        Date.now = () => capturedAt;
        const port = await acquirePatientProfileQueryHostPort('notes', deadline); assert.ok(port);
        Date.now = () => capturedAt + 124;
        const result = await port.executeProfileQuery(open(selected.currentness.selectionEpoch, 'notes'));
        assert.equal(result.currentness.observedAt, capturedAt + 124); assert.equal(result.currentness.expiresAt, deadline);
        Date.now = () => capturedAt + 248;
        const retry = await port.executeProfileQuery(reread(result)); assert.equal(retry.handle, result.handle);
        assert.equal(retry.currentness.expiresAt, deadline); assert.ok(retry.currentness.expiresAt <= deadline);
        Date.now = () => deadline;
        await assert.rejects(port.executeProfileQuery(reread(retry)), { code: 'handle_expired' });
        port.dispose();
        assert.equal(await acquirePatientProfileQueryHostPort('notes', Date.now() - 1), null);
        assert.equal(await acquirePatientProfileQueryHostPort('notes', NaN), null);
    } finally { Date.now = originalNow; }
});
