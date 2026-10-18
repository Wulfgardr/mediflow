/* Synthetic SQLite conformance for the common host profile port. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { installNetworkPatientCookieFixture, syntheticNetworkPatientAuthority } from './network-patient-authority-test-fixture';
import { issueSyntheticWebSessionContext, retireSyntheticWebSession } from './security/web-auth-lifecycle-owner-test-fixture';
import { clearAllSessions, retireServerSessionForLogout } from './security/server-session';
import { currentArchiveGeneration } from './security/archive-session-generation';
import { serializeNetworkPairingState, NETWORK_PAIRING_STATE_KEY } from './network-pairing-model';
import { NETWORK_FSE_VALIDATE_CAPABILITY } from './network-contract';
import { eq } from 'drizzle-orm';
import { ambulatories, patients, patientsToAmbulatories, settings, users } from './schema';
import type { RequiredAuditContext } from './security/audit';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-profile-port-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server');
openDbServer();
const cookieState = { cookies: new Map<string, string>() };
const cleanupCookies = installNetworkPatientCookieFixture(dataDir, cookieState);
process.env.MEDIFLOW_LOCAL_API_TOKEN = 'profile-synthetic-local-token';
const { readPatientProfile: admittedRead, updatePatientProfile } = load('./patient-profile-service.ts') as typeof import('./patient-profile-service');
const sql = dbServer.$client;
const { updatePatientOperation } = load('./patient-update-operation.ts') as typeof import('./patient-update-operation');
const profileDispatch = load('./patient-profile-update-dispatch.ts') as typeof import('./patient-profile-update-dispatch');
const webRoute = load('../app/api/patients/[id]/route.ts') as typeof import('../app/api/patients/[id]/route');
const v1Route = load('../app/api/v1/patients/[id]/route.ts') as typeof import('../app/api/v1/patients/[id]/route');
const networkRoute = load('../app/api/v1/network/patients/[id]/route.ts') as typeof import('../app/api/v1/network/patients/[id]/route');
const fseRoute = load('../app/api/v1/network/fse/validate-patient/route.ts') as typeof import('../app/api/v1/network/fse/validate-patient/route');
let authority: ReturnType<typeof syntheticNetworkPatientAuthority>;
let webSession: ReturnType<typeof issueSyntheticWebSessionContext>;

function selectSession(channel: 'web' | 'native') {
    cookieState.cookies.clear();
    cookieState.cookies.set('mediflow_session', channel === 'web' ? webSession.session.id : authority.session.id);
    if (channel === 'web') cookieState.cookies.set('mediflow_auth_control', webSession.controlId);
    cookieState.cookies.set('ambulatory_id', 'profile-a');
}
function grant(capabilities: string[]) {
    dbServer.insert(settings).values({ key: NETWORK_PAIRING_STATE_KEY, value: JSON.stringify({
        ...JSON.parse(serializeNetworkPairingState({ intents: [], clients: [{ ...authority.pairedClient, grantedCapabilities: capabilities }] })),
        archiveGeneration: currentArchiveGeneration(),
    }) }).onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify({
        ...JSON.parse(serializeNetworkPairingState({ intents: [], clients: [{ ...authority.pairedClient, grantedCapabilities: capabilities }] })),
        archiveGeneration: currentArchiveGeneration(),
    }) } }).run();
}
function request(projection: 'web' | 'api-v1' | 'network', extraHeaders: Record<string, string> = {}) {
    const headers = new Headers(projection === 'network' ? authority.request.headers : {});
    if (projection === 'api-v1') headers.set('authorization', 'Bearer profile-synthetic-local-token');
    for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
    return new Request('http://127.0.0.1/api/patients/' + patientId, { headers });
}
async function readPatientProfile(input: { patientId: string; projection: 'web' | 'api-v1' | 'network'; scopeAmbulatoryId?: string }) {
    selectSession(input.projection === 'web' ? 'web' : 'native');
    if (input.scopeAmbulatoryId) cookieState.cookies.set('ambulatory_id', input.scopeAmbulatoryId);
    const result = await admittedRead({ request: request(input.projection), projection: input.projection, patientId: async () => input.patientId });
    if (!result.ok) throw new Error('Synthetic profile admission denied: ' + result.response.status);
    return result.profile;
}
const patientId = 'profile-port-synthetic-patient';
const sealedNotes = 'ENC:YWJj:bm90ZXM=';

test.after(() => {
    clearAllSessions(); cleanupCookies();
    sql.close();
    rmSync(dataDir, { recursive: true, force: true });
});

function reset() {
    clearAllSessions();
    dbServer.delete(patientsToAmbulatories).run();
    dbServer.delete(patients).run();
    dbServer.delete(ambulatories).run();
    dbServer.delete(users).run(); dbServer.delete(settings).run();
    dbServer.insert(ambulatories).values([
        { id: 'profile-a', name: 'Ambulatorio sintetico A', type: 'live', isDefault: true },
        { id: 'profile-b', name: 'Ambulatorio sintetico B', type: 'live' },
    ]).run();
    dbServer.insert(patients).values({
        id: patientId, firstName: 'Ada', lastName: 'Sintetica', taxCode: 'PROFILE-SYNTHETIC',
        birthDate: new Date(0), createdAt: new Date(0), updatedAt: new Date(0),
        notes: sealedNotes, address: 'ENC:YWJj:YWRkcmVzcw==', phone: null,
        ambulatoryId: 'profile-a', version: 4, isArchived: false,
    }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId, ambulatoryId: 'profile-a' }).run();
    authority = syntheticNetworkPatientAuthority(dbServer, 'profile-a');
    webSession = issueSyntheticWebSessionContext({ id: authority.session.userId, username: authority.session.username, role: authority.session.role }, Math.random().toString());
    grant(['network.replica.readonly-patients', NETWORK_FSE_VALIDATE_CAPABILITY]);
    selectSession('web');
}

function snapshot() {
    return {
        database: Object.fromEntries((sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[])
            .map(({ name }) => [name, sql.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"').all()])),
        patients: sql.prepare('SELECT * FROM patients ORDER BY id').all(),
        memberships: sql.prepare('SELECT * FROM patients_to_ambulatories ORDER BY patient_id, ambulatory_id').all(),
        audit: sql.prepare('SELECT * FROM audit_events ORDER BY rowid').all() as Record<string, unknown>[],
    };
}

function audit(): RequiredAuditContext {
    const row = sql.prepare('SELECT generation FROM archive_generation WHERE id=1').get() as { generation: string };
    return { archiveGeneration: row.generation, actorType: 'user', actorRef: 'profile-host-user',
        sourceSurface: 'web', requestId: 'profile-host-request', flags: ['auth:session'] };
}

test('three projections preserve ciphertext, nulls and epoch dates without read effects', async () => {
    reset();
    const before = snapshot();
    const web = await readPatientProfile({ patientId, projection: 'web' });
    const v1 = await readPatientProfile({ patientId, projection: 'api-v1' });
    const network = await readPatientProfile({ patientId, projection: 'network', scopeAmbulatoryId: 'profile-a' });
    assert.ok(web && v1 && network);
    assert.equal(web.birthDate, '1970-01-01T00:00:00.000Z');
    assert.equal(v1.birthDate, '1970-01-01T00:00:00.000Z');
    assert.equal(v1.createdAt, '1970-01-01T00:00:00.000Z');
    assert.equal(v1.notes, sealedNotes);
    assert.equal(v1.phone, null);
    assert.equal(Object.hasOwn(v1, 'deletedAt'), false);
    assert.equal(Object.hasOwn(v1, 'deletionReason'), false);
    assert.deepEqual(network, { ...v1, deletedAt: null, deletionReason: null });
    assert.deepEqual(JSON.parse(JSON.stringify(web)), { ...v1, deletedAt: null, deletionReason: null });
    assert.deepEqual(snapshot(), before);
});

test('archived profiles remain readable while scope mismatch and tombstones stay absent', async () => {
    reset();
    dbServer.update(patients).set({ isArchived: true }).where(eq(patients.id, patientId)).run();
    assert.equal((await readPatientProfile({ patientId, projection: 'api-v1' }))?.isArchived, true);
    assert.equal((await readPatientProfile({ patientId, projection: 'network', scopeAmbulatoryId: 'profile-a' }))?.isArchived, true);
    assert.equal(await readPatientProfile({ patientId, projection: 'network', scopeAmbulatoryId: 'profile-b' }), null);
    dbServer.update(patients).set({ deletedAt: new Date(), deletionReason: 'synthetic' }).where(eq(patients.id, patientId)).run();
    assert.equal(await readPatientProfile({ patientId, projection: 'web' }), null);
    assert.equal(await readPatientProfile({ patientId, projection: 'api-v1' }), null);
    assert.equal(await readPatientProfile({ patientId, projection: 'network', scopeAmbulatoryId: 'profile-a' }), null);
});

test('body cannot spoof host patient, scope, expected version, operation contract, actor, role, audit or receipt', async () => {
    reset();
    const before = snapshot();
    const body = {
        notes: 'ENC:YWJj:bmV3', id: 'forged-patient', patientId: 'forged-patient',
        version: 999, expectedVersion: 999, scopeAmbulatoryId: 'profile-b',
        actorRef: 'forged-actor', actorType: 'system', role: 'admin',
        sourceSurface: 'job', audit: { actorRef: 'forged-audit' },
        receipt: { success: true, idempotencyKey: 'forged-receipt' },
        operationId: 'patient-profile.read.v1', contractVersion: 999,
    };
    const result = await updatePatientProfile({ patientId, expectedVersion: 4, audit }, body);
    assert.equal(result.status, 200);
    const after = snapshot();
    assert.equal(after.patients.length, 1);
    const previous = before.patients[0] as Record<string, unknown>;
    const current = after.patients[0] as Record<string, unknown>;
    assert.equal(current.notes, body.notes);
    assert.equal(current.version, 5);
    for (const key of Object.keys(previous)) {
        if (!['notes', 'version', 'updated_at'].includes(key)) assert.deepEqual(current[key], previous[key], key);
    }
    assert.deepEqual(after.memberships, before.memberships);
    assert.equal(after.audit.length, before.audit.length + 1);
    const event = after.audit.at(-1)!;
    assert.equal(event.actor_ref, 'profile-host-user');
    assert.equal(event.subject_ref, patientId);
    assert.equal(event.source_surface, 'web');
    assert.equal(event.request_id, 'profile-host-request');
    const metadata = JSON.parse(event.redacted_metadata as string);
    assert.deepEqual(metadata.changedFields, ['notes']);
    assert.equal(metadata.resourceVersion, 5);
    assert.ok(!JSON.stringify(event).includes('forged'));
    assert.ok(!JSON.stringify(event).includes(body.notes));
    const retry = await updatePatientProfile({ patientId, expectedVersion: 4, audit }, body);
    assert.equal(retry.status, 409);
    assert.deepEqual(snapshot(), after);
});

test('unknown update operation identity or contract version is rejected before transactions, commit guards and database effects', (t) => {
    const transaction = t.mock.method(dbServer, 'transaction');
    for (const contract of [
        {},
        { operationId: 'patient-profile.read.v1', contractVersion: 1 },
        { operationId: 'patient-profile.update.v1', contractVersion: 2 },
    ]) {
        reset();
        const before = snapshot();
        let guardCalls = 0, auditReads = 0;
        const input = {
            ...contract, patientId, expectedVersion: 4, values: { notes: 'ENC:YWJj:bmV3' },
            setPrimaryAmbulatory: false,
            authorizeCommit: () => { guardCalls += 1; },
            get audit() { auditReads += 1; return audit(); },
        } as unknown as Parameters<typeof updatePatientOperation>[0];
        assert.throws(() => updatePatientOperation(input), /Unsupported patient profile update operation/);
        assert.equal(transaction.mock.callCount(), 0);
        assert.equal(guardCalls, 0);
        assert.equal(auditReads, 0);
        assert.deepEqual(snapshot(), before);
    }
});

test('unscoped profile preserves omitted notes, explicit null and empty string semantics', async () => {
    reset();
    assert.equal((await updatePatientProfile({ patientId, expectedVersion: 4, audit }, { phone: null })).status, 200);
    assert.equal((await readPatientProfile({ patientId, projection: 'web' }))?.notes, sealedNotes);
    assert.equal((await updatePatientProfile({ patientId, expectedVersion: 5, audit }, { notes: null })).status, 200);
    assert.equal((await readPatientProfile({ patientId, projection: 'web' }))?.notes, null);
    assert.equal((await updatePatientProfile({ patientId, expectedVersion: 6, audit }, { notes: '' })).status, 200);
    assert.equal((await readPatientProfile({ patientId, projection: 'web' }))?.notes, '');
});

test('missing-before-invalid precedence does not acquire an audit context for invalid input', async () => {
    reset();
    let auditCalls = 0;
    const context = { patientId, expectedVersion: 4, audit: () => { auditCalls += 1; return audit(); } };
    const before = snapshot();
    assert.equal((await updatePatientProfile({ ...context, patientId: 'missing' }, { birthDate: 'invalid' })).status, 404);
    assert.equal((await updatePatientProfile(context, { birthDate: 'invalid' })).status, 400);
    assert.equal((await updatePatientProfile(context, {})).status, 400);
    assert.equal(auditCalls, 0);
    assert.deepEqual(snapshot(), before);
});

test('profile routes do not import database, schema or ORM directly', () => {
    for (const file of ['app/api/patients/[id]/route.ts', 'app/api/v1/patients/[id]/route.ts', 'app/api/v1/network/patients/[id]/route.ts']) {
        const source = ts.createSourceFile(file, readFileSync(join(import.meta.dirname, '..', file), 'utf8'), ts.ScriptTarget.Latest, true);
        const inspect = (node: ts.Node) => {
            let specifier: ts.Expression | undefined;
            if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
            if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
                || ts.isIdentifier(node.expression) && node.expression.text === 'require')) specifier = node.arguments[0];
            if (specifier && ts.isStringLiteral(specifier)) {
                assert.ok(!/(^|\/)(db-server|schema)(\.[cm]?ts)?$|^drizzle-orm($|\/)/.test(specifier.text), `${file}: ${specifier.text}`);
            }
            ts.forEachChild(node, inspect);
        };
        inspect(source);
    }
});


test('real Web, token-only v1 and paired GET adapters preserve the same profile wire and do not write', async () => {
    reset();
    const before = snapshot();
    const params = { params: Promise.resolve({ id: patientId }) };
    const web = await webRoute.GET(request('web'), params);
    assert.equal(web.status, 200);
    const webBody = await web.json();
    cookieState.cookies.clear();
    const local = await v1Route.GET(request('api-v1'), params);
    assert.equal(local.status, 200, 'local token does not require a human session');
    const v1Body = await local.json();
    assert.deepEqual(v1Body, {
        id: patientId, firstName: 'Ada', lastName: 'Sintetica', taxCode: 'PROFILE-SYNTHETIC',
        birthDate: '1970-01-01T00:00:00.000Z', address: 'ENC:YWJj:YWRkcmVzcw==', phone: null,
        caregiver: null, exemptions: null, diagnoses: null, monitoringProfile: null, statusReason: null,
        archiveReason: null, archiveNote: null, notes: sealedNotes, aiSummary: null,
        aiSummaryGeneratedAt: null, aiSummaryContextHash: null, documentInsights: null,
        isAdi: false, isArchived: false, version: 4, ambulatoryId: 'profile-a',
        createdAt: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.000Z',
    });
    assert.equal(v1Body.notes, sealedNotes);
    assert.equal(v1Body.birthDate, '1970-01-01T00:00:00.000Z');
    assert.equal(Object.hasOwn(v1Body, 'deletedAt'), false);
    selectSession('native');
    const network = await networkRoute.GET(request('network'), params);
    assert.equal(network.status, 200);
    assert.deepEqual(await network.json(), webBody);
    assert.deepEqual(webBody, { ...v1Body, deletedAt: null, deletionReason: null });
    assert.deepEqual(snapshot(), before);
});

test('unissued body principals and caller-supplied authority cannot admit a profile read', async () => {
    reset(); cookieState.cookies.clear();
    const before = snapshot();
    const forged = await admittedRead({ patientId: async () => patientId, projection: 'web',
        request: new Request('http://127.0.0.1/api/patients/' + patientId + '?role=admin&scopeAmbulatoryId=profile-a'),
        actor: { userId: authority.session.userId, role: 'admin' }, session: authority.session, scopeAmbulatoryId: 'profile-a',
        receipt: { authorized: true },
    } as Parameters<typeof admittedRead>[0]);
    assert.equal(forged.ok, false);
    if (!forged.ok) assert.equal(forged.response.status, 401);
    const unauthorized = await v1Route.GET(new Request('http://127.0.0.1/api/v1/patients/' + patientId,
        { headers: { 'x-mediflow-role': 'admin', 'x-mediflow-actor': authority.session.userId } }), { params: Promise.resolve({ id: patientId }) });
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(snapshot(), before);
});

test('current issuer retirement denies Web and paired sessions through the real adapters', async () => {
    reset(); const before = snapshot();
    retireSyntheticWebSession(webSession.session);
    const params = { params: Promise.resolve({ id: patientId }) };
    assert.equal((await webRoute.GET(request('web'), params)).status, 401);
    selectSession('native'); retireServerSessionForLogout(authority.session.id);
    assert.equal((await networkRoute.GET(request('network'), params)).status, 401);
    assert.deepEqual(snapshot(), before);
});

test('network scope assertion and capability denials retain errors without read effects', async () => {
    reset(); selectSession('native'); const before = snapshot();
    const params = { params: Promise.resolve({ id: patientId }) };
    const mismatch = await networkRoute.GET(request('network', { 'x-mediflow-expected-ambulatory-id': 'profile-b' }), params);
    assert.equal(mismatch.status, 403); assert.deepEqual(await mismatch.json(), { error: 'Network scope unavailable' });
    assert.deepEqual(snapshot(), before);
    grant([]); const denied = snapshot();
    const response = await networkRoute.GET(request('network'), params);
    assert.equal(response.status, 403); assert.deepEqual(await response.json(), { error: 'Forbidden' });
    assert.deepEqual(snapshot(), denied);
});

test('FSE reads preserve their own capability without requiring patient-replica permission', async () => {
    reset(); selectSession('native'); grant([NETWORK_FSE_VALIDATE_CAPABILITY]);
    const before = snapshot();
    const headers = authority.request.headers;
    const response = await fseRoute.GET(new Request('http://127.0.0.1/api/v1/network/fse/validate-patient?patientId=' + patientId, { headers }));
    assert.equal(response.status, 200); assert.equal((await response.json()).patientId, patientId);
    const missing = await fseRoute.GET(new Request('http://127.0.0.1/api/v1/network/fse/validate-patient', { headers }));
    assert.equal(missing.status, 400); assert.deepEqual(await missing.json(), { error: 'patientId is required' });
    assert.deepEqual(snapshot(), before);
    grant(['network.replica.readonly-patients']); const denied = snapshot();
    assert.equal((await fseRoute.GET(new Request('http://127.0.0.1/api/v1/network/fse/validate-patient?patientId=' + patientId, { headers }))).status, 403);
    assert.deepEqual(snapshot(), denied);
});


test('all profile HTTP adapters keep archived/missing/tombstone errors and ignore claimed authority in URL', async () => {
    reset();
    dbServer.update(patients).set({ isArchived: true }).where(eq(patients.id, patientId)).run();
    const cases = [[webRoute, 'web'], [v1Route, 'api-v1'], [networkRoute, 'network']] as const;
    for (const [route, projection] of cases) {
        selectSession(projection === 'web' ? 'web' : 'native');
        const original = request(projection);
        const spoof = new Request(original.url + '?patientId=wrong&projection=api-v1&scopeAmbulatoryId=profile-b&actorRef=wrong&role=doctor&receipt=accepted', { headers: original.headers });
        const before = snapshot();
        const response = await route.GET(spoof, { params: Promise.resolve({ id: patientId }) });
        assert.equal(response.status, 200); const body = await response.json();
        assert.equal(body.id, patientId); assert.equal(body.notes, sealedNotes); assert.equal(body.isArchived, true);
        assert.equal((await route.GET(original, { params: Promise.resolve({ id: 'profile-missing' }) })).status, 404);
        assert.deepEqual(snapshot(), before);
    }
    dbServer.update(patients).set({ deletedAt: new Date(), deletionReason: 'Synthetic tombstone' }).where(eq(patients.id, patientId)).run();
    const before = snapshot();
    for (const [route, projection] of cases) {
        selectSession(projection === 'web' ? 'web' : 'native');
        const response = await route.GET(request(projection), { params: Promise.resolve({ id: patientId }) });
        assert.equal(response.status, 404); assert.deepEqual(await response.json(), { error: 'Not found' });
    }
    assert.deepEqual(snapshot(), before);
});

test('mode, pairing and missing-session decisions cannot be replaced by caller claims', async () => {
    reset(); selectSession('native'); const params = { params: Promise.resolve({ id: patientId }) };
    dbServer.update(settings).set({ value: 'local-only' }).where(eq(settings.key, 'network.mode')).run();
    let before = snapshot();
    const disabled = await networkRoute.GET(request('network'), params);
    assert.equal(disabled.status, 403); assert.equal((await disabled.json()).code, 'NETWORK_MODE_DISABLED');
    assert.deepEqual(snapshot(), before);
    dbServer.update(settings).set({ value: 'network-home-base' }).where(eq(settings.key, 'network.mode')).run();
    before = snapshot(); cookieState.cookies.clear();
    assert.equal((await networkRoute.GET(request('network'), params)).status, 401);
    selectSession('native');
    assert.equal((await networkRoute.GET(new Request('http://127.0.0.1/api/v1/network/patients/' + patientId), params)).status, 401);
    assert.deepEqual(snapshot(), before);
});


test('unauthorized adapters deny before resolving the host patient parameter', async () => {
    reset(); cookieState.cookies.clear(); const before = snapshot();
    let reads = 0;
    const params = { params: Promise.resolve({ get id(): string { reads++; throw new Error('Patient parameter must remain unread'); } }) };
    assert.equal((await webRoute.GET(new Request('http://127.0.0.1/api/patients/x'), params)).status, 401);
    assert.equal((await v1Route.GET(new Request('http://127.0.0.1/api/v1/patients/x'), params)).status, 401);
    assert.equal((await networkRoute.GET(new Request('http://127.0.0.1/api/v1/network/patients/x'), params)).status, 401);
    assert.equal(reads, 0); assert.deepEqual(snapshot(), before);
});

test('FSE enforces request scope while preserving GET compatibility for untrusted generation headers', async () => {
    reset(); selectSession('native'); grant([NETWORK_FSE_VALIDATE_CAPABILITY]);
    const before = snapshot();
    const headers = new Headers(authority.request.headers);
    headers.set('x-mediflow-expected-ambulatory-id', 'profile-b');
    let response = await fseRoute.GET(new Request('http://127.0.0.1/api/v1/network/fse/validate-patient?patientId=' + patientId, { headers }));
    assert.equal(response.status, 403); assert.deepEqual(await response.json(), { error: 'Network scope unavailable' });
    headers.delete('x-mediflow-expected-ambulatory-id'); headers.set('x-mediflow-archive-generation', 'synthetic-stale-generation');
    response = await fseRoute.GET(new Request('http://127.0.0.1/api/v1/network/fse/validate-patient?patientId=' + patientId, { headers }));
    assert.equal(response.status, 200, 'GET never treated a caller generation header as authority or a write fence');
    assert.deepEqual(snapshot(), before);
});


test('paired parameters resolve before the final scope binding and cannot retain an earlier scope', async () => {
    reset(); selectSession('native'); const before = snapshot();
    let release!: (value: { id: string }) => void;
    const params = new Promise<{ id: string }>(resolve => { release = resolve; });
    const pending = networkRoute.GET(request('network'), { params });
    await new Promise(resolve => setImmediate(resolve));
    cookieState.cookies.set('ambulatory_id', 'profile-b');
    release({ id: patientId });
    const response = await pending;
    assert.equal(response.status, 404, 'patient belongs only to profile-a, not the scope chosen while params were pending');
    assert.deepEqual(snapshot(), before);
    selectSession('native');
    let resolveAgain!: (value: { id: string }) => void;
    const delayed = new Promise<{ id: string }>(resolve => { resolveAgain = resolve; });
    const asserted = networkRoute.GET(request('network', { 'x-mediflow-expected-ambulatory-id': 'profile-a' }), { params: delayed });
    await new Promise(resolve => setImmediate(resolve));
    cookieState.cookies.set('ambulatory_id', 'profile-b'); resolveAgain({ id: patientId });
    assert.equal((await asserted).status, 403);
    assert.deepEqual(snapshot(), before);
});

function updateRequest(projection: 'web' | 'api-v1' | 'network', body: unknown) {
    const headers = new Headers(request(projection).headers);
    headers.set('x-mediflow-archive-generation', currentArchiveGeneration());
    headers.set('x-request-id', 'synthetic-shared-correlation');
    headers.set('Content-Type', 'application/json');
    const prefix = projection === 'web' ? '/api' : projection === 'api-v1' ? '/api/v1' : '/api/v1/network';
    return new Request('http://127.0.0.1' + prefix + '/patients/' + patientId,
        { method: 'PUT', headers, body: JSON.stringify(body) });
}

test('real update adapters issue separate host executions for repeated caller keys: one commit/audit then CAS409', async t => {
    const commands: ReturnType<typeof profileDispatch.createPatientProfileUpdateExecution>['command'][] = [];
    const create = profileDispatch.createPatientProfileUpdateExecution;
    t.mock.method(profileDispatch, 'createPatientProfileUpdateExecution', (input: Parameters<typeof create>[0]) => {
        const execution = create(input); commands.push(execution.command); return execution;
    });
    const body = { version: 4, notes: 'ENC:YWJj:bmV3', operationId: 'untrusted.operation', contractVersion: 999,
        executionId: 'claimed-execution', idempotencyKey: 'same-caller-key', correlationId: 'claimed-correlation',
        executor: 'rust', purpose: 'claimed-purpose', path: 'new-writer', confirmation: 'human-confirmed', authorization: { allowed: true },
        author: { kind: 'doctor', ref: 'forged-author' }, scope: { kind: 'ambulatory', ambulatoryId: 'profile-b' },
        patientId: 'forged-patient', scopeAmbulatoryId: 'profile-b', expectedVersion: 99, audit: { actorRef: 'forged-audit' } };
    for (const [route, projection] of [[webRoute, 'web'], [v1Route, 'api-v1'], [networkRoute, 'network']] as const) {
        reset();
        if (projection === 'api-v1') cookieState.cookies.clear();
        if (projection === 'network') { selectSession('native'); grant(['network.replica.write-patient-profile']); }
        const before = snapshot();
        const params = { params: Promise.resolve({ id: patientId }) };
        const first = await route.PUT(updateRequest(projection, body), params);
        assert.equal(first.status, 200, projection); assert.deepEqual(await first.json(), { success: true });
        const committed = snapshot();
        assert.equal(committed.audit.length, before.audit.length + 1);
        assert.equal((committed.patients[0] as Record<string, unknown>).notes, body.notes);
        assert.equal((committed.patients[0] as Record<string, unknown>).version, 5);
        assert.deepEqual(committed.memberships, before.memberships);
        const retry = await route.PUT(updateRequest(projection, body), params);
        assert.equal(retry.status, 409, projection); assert.equal((await retry.json()).code, 'VERSION_CONFLICT');
        assert.deepEqual(snapshot(), committed);
        const [a, b] = commands.slice(-2);
        assert.notEqual(a.idempotencyKey, b.idempotencyKey); assert.notEqual(a.executionId, b.executionId);
        assert.equal(a.correlationId, 'synthetic-shared-correlation');
        assert.notEqual(a.idempotencyKey, body.idempotencyKey); assert.notEqual(a.executionId, body.executionId);
        assert.equal(a.operationId, 'patient-profile.update.v1'); assert.equal(a.contractVersion, 1);
        assert.equal(a.executor, 'legacy-node'); assert.equal(a.confirmation, 'legacy-not-attested');
        assert.equal(a.purpose, 'patient-profile-update');
        assert.equal(a.authorization.kind, 'existing-host-admission');
        assert.deepEqual(a.target, { patientId, expectedVersion: 4 });
        assert.deepEqual(a.payload, { notes: body.notes });
        assert.deepEqual(a.scope, projection === 'network' ? { kind: 'ambulatory', ambulatoryId: 'profile-a' } : { kind: 'local' });
        assert.equal(a.author.ref, projection === 'api-v1' ? 'local-api' : authority.session.userId);
        assert.equal(a.author.kind, projection === 'api-v1' ? 'system' : 'user');
        assert.ok(!JSON.stringify(committed.audit.at(-1)).includes('forged'));
    }
    assert.equal(commands.length, 6);
});

test('real update adapters preserve common domain errors and documented absence/field-validation precedence', async () => {
    const cases = [
        { body: { notes: sealedNotes }, id: patientId, status: 400, error: 'Version is required' },
        { body: { version: 4 }, id: patientId, status: 400, error: 'No valid fields to update' },
        { body: { version: 4, birthDate: 'invalid' }, id: patientId, status: 400, error: 'Invalid birthDate' },
        { body: { version: 4, notes: sealedNotes }, id: 'missing', status: 404, error: 'Not found' },
    ];
    for (const [route, projection] of [[webRoute, 'web'], [v1Route, 'api-v1'], [networkRoute, 'network']] as const) {
        for (const sample of cases) {
            reset();
            if (projection === 'api-v1') cookieState.cookies.clear();
            if (projection === 'network') { selectSession('native'); grant(['network.replica.write-patient-profile']); }
            const before = snapshot();
            const response = await route.PUT(updateRequest(projection, sample.body), { params: Promise.resolve({ id: sample.id }) });
            assert.equal(response.status, sample.status, projection); assert.deepEqual(await response.json(), { error: sample.error });
            assert.deepEqual(snapshot(), before);
        }
        reset();
        if (projection === 'api-v1') cookieState.cookies.clear();
        if (projection === 'network') { selectSession('native'); grant(['network.replica.write-patient-profile']); }
        const before = snapshot();
        const response = await route.PUT(updateRequest(projection, { version: 4, birthDate: 'invalid' }), { params: Promise.resolve({ id: 'missing' }) });
        assert.equal(response.status, projection === 'network' ? 400 : 404);
        assert.deepEqual(await response.json(), { error: projection === 'network' ? 'Invalid birthDate' : 'Not found' });
        assert.deepEqual(snapshot(), before);
    }
});

test('one admitted execution deduplicates the real SQLite writer and reuses its successful result', async () => {
    reset(); const before = snapshot();
    const execution = profileDispatch.createPatientProfileUpdateExecution({ patientId, expectedVersion: 4,
        values: { notes: 'ENC:YWJj:b25jZQ==', updatedAt: new Date(), version: 5 },
        setPrimaryAmbulatory: false, audit: audit() });
    const first = profileDispatch.dispatchPatientProfileUpdate(execution, execution.command);
    const concurrent = profileDispatch.dispatchPatientProfileUpdate(execution, execution.command);
    assert.equal(first, concurrent);
    const [a, b] = await Promise.all([first, concurrent]); assert.equal(a, b); assert.equal(a.kind, 'applied');
    assert.equal(a.executionId, execution.command.executionId);
    if (a.kind === 'applied') assert.equal(a.result.status, 200);
    const committed = snapshot();
    assert.equal((committed.patients[0] as Record<string, unknown>).version, 5);
    assert.equal(committed.audit.length, before.audit.length + 1);
    assert.equal(await profileDispatch.dispatchPatientProfileUpdate(execution, execution.command), a);
    assert.deepEqual(snapshot(), committed);
});

test('an uncertain exception after the real writer commits is terminal without a second commit/audit', async t => {
    reset(); const before = snapshot();
    const writer = load('./patient-update-operation.ts') as typeof import('./patient-update-operation');
    const write = writer.updatePatientOperation;
    const uncertain = new Error('Synthetic outcome unavailable after commit');
    const call = t.mock.method(writer, 'updatePatientOperation', (input: Parameters<typeof write>[0]) => {
        assert.equal(write(input).status, 200); throw uncertain;
    });
    const execution = profileDispatch.createPatientProfileUpdateExecution({ patientId, expectedVersion: 4,
        values: { notes: 'ENC:YWJj:b25jZQ==', updatedAt: new Date(), version: 5 },
        setPrimaryAmbulatory: false, audit: audit() });
    const first = profileDispatch.dispatchPatientProfileUpdate(execution, execution.command);
    const outcome = await first;
    assert.equal(outcome.kind, 'uncertain');
    assert.equal(outcome.executionId, execution.command.executionId);
    assert.equal(outcome.purpose, 'patient-profile-update');
    if (outcome.kind === 'uncertain') assert.equal(outcome.error, uncertain);
    const committed = snapshot();
    assert.equal((committed.patients[0] as Record<string, unknown>).version, 5);
    assert.equal(committed.audit.length, before.audit.length + 1);
    const retry = profileDispatch.dispatchPatientProfileUpdate(execution, execution.command);
    assert.equal(retry, first); assert.equal(await retry, outcome);
    assert.equal(call.mock.callCount(), 1); assert.deepEqual(snapshot(), committed);
});

test('canonical payload preserves every existing local profile field and timestamp/membership semantics', async () => {
    reset();
    const body = { firstName: 'Bea', lastName: 'Sintetica aggiornata', taxCode: 'SYNTHETIC-UPDATED',
        birthDate: '2000-02-29T00:00:00.000Z', address: 'ENC:YWJj:YQ==', phone: null,
        caregiver: '', notes: sealedNotes, monitoringProfile: 'profile', statusReason: 'ENC:YWJj:cg==',
        archiveReason: 'ENC:YWJj:cg==', archiveNote: 'ENC:YWJj:cg==',
        exemptions: ['synthetic-exemption'], diagnoses: ['synthetic-diagnosis'],
        aiSummary: 'synthetic-derived', aiSummaryGeneratedAt: '2026-10-18T10:00:00.123Z',
        aiSummaryContextHash: 'synthetic-hash', documentInsights: 'synthetic-document-insights',
        isAdi: true, isArchived: true, ambulatoryId: 'profile-b' };
    assert.equal((await updatePatientProfile({ patientId, expectedVersion: 4, audit }, body)).status, 200);
    const row = dbServer.select().from(patients).where(eq(patients.id, patientId)).get()!;
    for (const field of ['firstName', 'lastName', 'taxCode', 'address', 'phone', 'caregiver', 'notes',
        'monitoringProfile', 'statusReason', 'archiveReason', 'archiveNote', 'aiSummary', 'aiSummaryContextHash',
        'documentInsights', 'isAdi', 'isArchived', 'ambulatoryId'] as const) assert.equal(row[field], body[field], field);
    assert.equal(row.birthDate?.toISOString(), body.birthDate);
    assert.equal(row.aiSummaryGeneratedAt?.toISOString(), '2026-10-18T10:00:00.000Z', 'existing SQLite timestamp precision remains seconds');
    assert.equal(row.exemptions, '["synthetic-exemption"]'); assert.equal(row.diagnoses, '["synthetic-diagnosis"]');
    assert.equal(row.version, 5);
    assert.ok(dbServer.select().from(patientsToAmbulatories).all().some(link => link.patientId === patientId && link.ambulatoryId === 'profile-b'));
});
