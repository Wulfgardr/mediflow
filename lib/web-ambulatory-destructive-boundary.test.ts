import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { ambulatories, patients, patientsToAmbulatories, users } from './schema';
import { installNetworkPatientCookieFixture } from './network-patient-authority-test-fixture';
import { currentArchiveGeneration } from './security/archive-session-generation';
import { clearAllSessions } from './security/server-session';
import { bootstrapWebAuthControl, beginWebAuthControl, issueWebAuthControl } from './security/web-auth-control-transport';
import { WEB_CONTROL_LOCATOR_HEADER, WEB_SESSION_LOCATOR_HEADER, WEB_SESSION_PROOF_HEADER } from './security/web-session-proof-header';
import { resolve as resolveWebSession, type WebSessionProjection } from './security/web-auth-lifecycle-owner-adapter';
import { syntheticLoopbackRequest } from './security/loopback-ingress-test-fixture';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-wul961-web-destructive-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const cookieState: { cookies: Map<string, string>; headers?: Headers } = { cookies: new Map() };
const cleanupCookies = installNetworkPatientCookieFixture(dataDir, cookieState);
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server');
openDbServer();
const itemRoute = load('../app/api/ambulatories/[id]/route.ts') as Record<string, unknown>;
type RoutePost = { POST: (request: Request) => Promise<Response> };
const prepareRoute = { POST: (request: Request) => (load('../app/api/ambulatories/commands/prepare/route.ts') as RoutePost).POST(request) };
const executeRoute = { POST: (request: Request) => (load('../app/api/ambulatories/commands/execute/route.ts') as RoutePost).POST(request) };
type WebService = typeof import('./security/web-ambulatory-destructive-service');
const createWebAmbulatoryDestructiveService: WebService['createWebAmbulatoryDestructiveService'] = options =>
    (load('./security/web-ambulatory-destructive-service.ts') as WebService).createWebAmbulatoryDestructiveService(options);
const WEB_AMBULATORY_PREPARATION_MS = 300_000;
const legacyClearRoute = resolve('app/api/ambulatories/clear/route.ts');
const sql = dbServer.$client;
const origin = 'http://127.0.0.1:31961';
const PIN = '2468';
const pinHash = bcrypt.hashSync(PIN, 4);

test.after(() => {
    clearAllSessions();
    cleanupCookies();
    sql.close();
    rmSync(dataDir, { recursive: true, force: true });
});

function seed() {
    clearAllSessions();
    sql.exec('DROP TRIGGER IF EXISTS synthetic_web_command_audit; DELETE FROM entries; DELETE FROM patients_to_ambulatories; DELETE FROM patients; DELETE FROM ambulatories; DELETE FROM users;');
    dbServer.insert(users).values([
        { id: 'synthetic-admin', username: 'synthetic-admin', role: 'admin', passwordHash: pinHash, encryptedMasterKey: 'synthetic', salt: 'synthetic' },
        { id: 'synthetic-operator', username: 'synthetic-operator', role: 'user', passwordHash: pinHash, encryptedMasterKey: 'synthetic', salt: 'synthetic' },
    ]).run();
    dbServer.insert(ambulatories).values([
        { id: 'scope', name: 'Sede operativa', type: 'live', isDefault: true, version: 1, createdAt: new Date(1000) },
        { id: 'other-test', name: 'Sede test', type: 'test', isDefault: false, version: 1, createdAt: new Date(2000) },
        { id: 'other-live', name: 'Sede vuota', type: 'live', isDefault: false, version: 1, createdAt: new Date(3000) },
    ]).run();
    dbServer.insert(patients).values([
        { id: 'synthetic-test-only', firstName: 'Mario', lastName: 'Sintetico', taxCode: 'SNTMRA80A01F205X', version: 1 },
        { id: 'synthetic-shared', firstName: 'Anna', lastName: 'Sintetica', taxCode: 'SNTNNA80A41F205X', version: 1 },
    ]).run();
    dbServer.insert(patientsToAmbulatories).values([
        { patientId: 'synthetic-test-only', ambulatoryId: 'other-test' },
        { patientId: 'synthetic-shared', ambulatoryId: 'other-test' },
        { patientId: 'synthetic-shared', ambulatoryId: 'scope' },
    ]).run();
}

function webSession(userId = 'synthetic-admin') {
    const user = dbServer.select().from(users).where(eq(users.id, userId)).get()!;
    const request = syntheticLoopbackRequest(`${origin}/api/auth/login`, { method: 'POST', headers: { origin, 'sec-fetch-site': 'same-origin', [WEB_SESSION_PROOF_HEADER]: randomBytes(32).toString('hex') } });
    const control = bootstrapWebAuthControl(null)!;
    const attempt = beginWebAuthControl('login', Object.freeze({ controlId: control.controlId, ifMatch: control.etag, idempotencyKey: randomUUID() }), request);
    assert.ok(attempt);
    const issued = issueWebAuthControl(attempt, { id: user.id, username: user.username, role: user.role ?? 'user' });
    assert.ok(issued);
    const resolved = resolveWebSession(issued.sessionId, control.controlId);
    assert.equal(resolved.status, 'active');
    const proof = request.headers.get(WEB_SESSION_PROOF_HEADER)!;
    return { session: (resolved as { projection: WebSessionProjection }).projection, generation: currentArchiveGeneration()!,
        headers: { [WEB_SESSION_PROOF_HEADER]: proof, [WEB_CONTROL_LOCATOR_HEADER]: control.controlId, [WEB_SESSION_LOCATOR_HEADER]: issued.sessionId } };
}

function clinical() {
    return {
        ambulatories: sql.prepare('SELECT * FROM ambulatories ORDER BY id').all(),
        patients: sql.prepare('SELECT id, version, deleted_at FROM patients ORDER BY id').all(),
        memberships: sql.prepare('SELECT * FROM patients_to_ambulatories ORDER BY patient_id, ambulatory_id').all(),
        ambulatoryAudits: sql.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type LIKE 'ambulatory.%' OR event_type LIKE 'patient.%'").get(),
    };
}

function auditsFor(commandId: string) {
    return (sql.prepare('SELECT event_type, subject_ref, actor_ref, source_surface FROM audit_events WHERE request_id = ? ORDER BY rowid')
        .all(commandId) as Array<{ event_type: string; subject_ref: string; actor_ref: string; source_surface: string }>);
}

function routeRequest(path: string, body: unknown, session: ReturnType<typeof webSession>) {
    const request = syntheticLoopbackRequest(`${origin}${path}`, {
        method: 'POST', body: JSON.stringify(body),
        headers: { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json',
            'x-mediflow-archive-generation': session.generation, ...session.headers },
    });
    cookieState.headers = request.headers;
    return request;
}

test('WUL-961: a Web admin session reaches no legacy delete or clear of a sede', async () => {
    seed();
    const admin = webSession();
    const before = clinical();
    const legacyDelete = itemRoute.DELETE as ((request: Request, context: unknown) => Promise<Response>) | undefined;
    if (legacyDelete) {
        const response = await legacyDelete(routeRequest('/api/ambulatories/other-live', { version: 1 }, admin), { params: Promise.resolve({ id: 'other-live' }) });
        assert.notEqual(response.status, 200, 'DELETE /api/ambulatories/[id] deleted a sede with the Web session alone');
    }
    if (existsSync(legacyClearRoute)) {
        const response = await (load(legacyClearRoute) as RoutePost).POST(routeRequest('/api/ambulatories/clear', { ambulatoryId: 'other-test', version: 1 }, admin));
        assert.notEqual(response.status, 200, 'POST /api/ambulatories/clear emptied a sede with the Web session alone');
    }
    assert.deepEqual(clinical(), before);
    assert.equal(legacyDelete, undefined);
    assert.equal(existsSync(legacyClearRoute), false);
    assert.equal('deleteAmbulatory' in (load('./ambulatory-write.ts') as object), false);
    assert.equal('clearAmbulatory' in (load('./ambulatory-write.ts') as object), false);
});

test('WUL-961: the Web page clears and deletes only through the shown plan and a fresh PIN, over the real routes', async () => {
    seed();
    const admin = webSession();
    const before = clinical();

    const prepared = await prepareRoute.POST(routeRequest('/api/ambulatories/commands/prepare',
        { operation: 'ambulatory.clear-test.v1', ambulatoryId: 'other-test', expectedVersion: 1 }, admin));
    assert.equal(prepared.status, 200, await prepared.clone().text());
    const plan = await prepared.json() as { reference: string; counts: Record<string, number>; target: { name: string } };
    assert.deepEqual(plan.counts, { tombstonedPatients: 1, unlinkedPatients: 1, preservedLivePatients: 1, removedMembershipRows: 2 });
    assert.equal(plan.target.name, 'Sede test');
    assert.deepEqual(clinical(), before, 'showing the plan writes nothing');

    const wrong = await executeRoute.POST(routeRequest('/api/ambulatories/commands/execute', { reference: plan.reference, pin: '1357' }, admin));
    assert.equal(wrong.status, 403);
    assert.equal((await wrong.json()).code, 'PIN_DENIED');
    assert.deepEqual(clinical(), before, 'a wrong PIN writes nothing');

    const executed = await executeRoute.POST(routeRequest('/api/ambulatories/commands/execute', { reference: plan.reference, pin: PIN }, admin));
    assert.equal(executed.status, 200, await executed.clone().text());
    const receipt = await executed.json() as { outcome: string; commandId: string; version: number };
    assert.equal(receipt.outcome, 'applied');
    assert.equal(receipt.version, 2);
    const audits = auditsFor(receipt.commandId);
    assert.deepEqual(audits.map(row => row.event_type).sort(), ['ambulatory.cleared', 'patient.deleted', 'patient.updated']);
    assert.ok(audits.every(row => row.actor_ref === 'synthetic-admin' && row.source_surface === 'web'));
    const after = clinical();
    assert.deepEqual(after.memberships, [{ patient_id: 'synthetic-shared', ambulatory_id: 'scope', assigned_at: (before.memberships as Array<{ patient_id: string; ambulatory_id: string; assigned_at: number }>).find(row => row.ambulatory_id === 'scope')!.assigned_at }]);
    assert.ok((after.patients as Array<{ id: string; deleted_at: number | null }>).find(row => row.id === 'synthetic-test-only')!.deleted_at);
    assert.equal((after.patients as Array<{ id: string; deleted_at: number | null }>).find(row => row.id === 'synthetic-shared')!.deleted_at, null);

    const duplicate = await executeRoute.POST(routeRequest('/api/ambulatories/commands/execute', { reference: plan.reference, pin: PIN }, admin));
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).code, 'AMBULATORY_COMMAND_UNKNOWN');
    assert.deepEqual(clinical(), after, 'a duplicate confirmation writes nothing');

    const deletion = await prepareRoute.POST(routeRequest('/api/ambulatories/commands/prepare',
        { operation: 'ambulatory.delete.v1', ambulatoryId: 'other-live', expectedVersion: 1 }, admin));
    assert.equal(deletion.status, 200, await deletion.clone().text());
    const deletionPlan = await deletion.json() as { reference: string };
    const deleted = await executeRoute.POST(routeRequest('/api/ambulatories/commands/execute', { reference: deletionPlan.reference, pin: PIN }, admin));
    assert.equal(deleted.status, 200, await deleted.clone().text());
    const deletedReceipt = await deleted.json() as { commandId: string };
    assert.deepEqual(auditsFor(deletedReceipt.commandId).map(row => row.event_type), ['ambulatory.deleted']);
    assert.equal((clinical().ambulatories as Array<{ id: string }>).some(row => row.id === 'other-live'), false);
});

test('WUL-961: the routes refuse a non-admin, cross-site or stale-archive request', async () => {
    seed();
    const operator = webSession('synthetic-operator');
    const before = clinical();
    const denied = await prepareRoute.POST(routeRequest('/api/ambulatories/commands/prepare',
        { operation: 'ambulatory.clear-test.v1', ambulatoryId: 'other-test', expectedVersion: 1 }, operator));
    assert.equal(denied.status, 403);
    const admin = webSession();
    const crossSite = routeRequest('/api/ambulatories/commands/prepare', { operation: 'ambulatory.delete.v1', ambulatoryId: 'other-live', expectedVersion: 1 }, admin);
    crossSite.headers.set('sec-fetch-site', 'cross-site');
    assert.equal((await prepareRoute.POST(crossSite)).status, 403);
    const staleGeneration = routeRequest('/api/ambulatories/commands/prepare', { operation: 'ambulatory.delete.v1', ambulatoryId: 'other-live', expectedVersion: 1 }, admin);
    staleGeneration.headers.set('x-mediflow-archive-generation', randomUUID());
    assert.equal((await prepareRoute.POST(staleGeneration)).status, 403);
    assert.deepEqual(clinical(), before);
});

test('WUL-961: denied, foreign, blocked and changed plans modify nothing', async () => {
    seed();
    const service = createWebAmbulatoryDestructiveService();
    const admin = webSession(), other = webSession();
    const before = clinical();

    const blocked = service.prepare(admin, { operation: 'ambulatory.delete.v1', ambulatoryId: 'other-test', expectedVersion: 1 });
    assert.deepEqual([blocked.status, blocked.value.code], [409, 'AMBULATORY_HAS_PATIENTS']);
    const live = service.prepare(admin, { operation: 'ambulatory.clear-test.v1', ambulatoryId: 'scope', expectedVersion: 1 });
    assert.deepEqual([live.status, live.value.code], [409, 'AMBULATORY_NOT_TEST']);
    const stale = service.prepare(admin, { operation: 'ambulatory.clear-test.v1', ambulatoryId: 'other-test', expectedVersion: 7 });
    assert.deepEqual([stale.status, stale.value.code], [409, 'VERSION_CONFLICT']);

    const prepared = service.prepare(admin, { operation: 'ambulatory.clear-test.v1', ambulatoryId: 'other-test', expectedVersion: 1 });
    assert.equal(prepared.status, 200);
    const reference = prepared.value.reference as string;
    const foreign = await service.execute(new Request(origin), other, { reference, pin: PIN });
    assert.deepEqual([foreign.status, foreign.value.code], [403, 'AMBULATORY_COMMAND_DENIED']);
    assert.deepEqual(clinical(), before);

    dbServer.insert(ambulatories).values({ id: 'late-live', name: 'Sede nuova', type: 'live', isDefault: false, version: 1, createdAt: new Date(4000) }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId: 'synthetic-test-only', ambulatoryId: 'late-live' }).run();
    const changedBefore = clinical();
    const changed = await service.execute(new Request(origin), admin, { reference, pin: PIN });
    assert.deepEqual([changed.status, changed.value.code], [409, 'AMBULATORY_PLAN_CHANGED']);
    assert.deepEqual(clinical(), changedBefore, 'a plan that changed after it was shown writes nothing');
    const spent = await service.execute(new Request(origin), admin, { reference, pin: PIN });
    assert.deepEqual([spent.status, spent.value.code], [409, 'AMBULATORY_COMMAND_UNKNOWN']);
});

test('WUL-961: an expired preparation writes nothing and leads to a new authorization, not a stuck state', async () => {
    seed();
    let clock = 1_000_000;
    const service = createWebAmbulatoryDestructiveService({ now: () => clock });
    const admin = webSession();
    const before = clinical();
    const first = service.prepare(admin, { operation: 'ambulatory.delete.v1', ambulatoryId: 'other-live', expectedVersion: 1 });
    assert.equal(first.status, 200);
    clock += WEB_AMBULATORY_PREPARATION_MS;
    const expired = await service.execute(new Request(origin), admin, { reference: first.value.reference, pin: PIN });
    assert.deepEqual([expired.status, expired.value.code], [409, 'AMBULATORY_PREPARATION_EXPIRED']);
    assert.deepEqual(clinical(), before);

    const again = service.prepare(admin, { operation: 'ambulatory.delete.v1', ambulatoryId: 'other-live', expectedVersion: 1 });
    assert.equal(again.status, 200);
    const done = await service.execute(new Request(origin), admin, { reference: again.value.reference, pin: PIN });
    assert.equal(done.status, 200, JSON.stringify(done.value));
});

test('WUL-961: a preparation that expires while the PIN is checked writes nothing', async () => {
    seed();
    let clock = 1_000_000;
    const service = createWebAmbulatoryDestructiveService({ now: () => clock, verifyPin: async input => {
        clock += WEB_AMBULATORY_PREPARATION_MS;
        const { verifyHostCredentials } = load('./security/host-credential-verification.ts') as typeof import('./security/host-credential-verification');
        return verifyHostCredentials(input);
    } });
    const admin = webSession();
    const before = clinical();
    const prepared = service.prepare(admin, { operation: 'ambulatory.delete.v1', ambulatoryId: 'other-live', expectedVersion: 1 });
    const expired = await service.execute(new Request(origin), admin, { reference: prepared.value.reference, pin: PIN });
    assert.deepEqual([expired.status, expired.value.code], [409, 'AMBULATORY_PREPARATION_EXPIRED']);
    assert.deepEqual(clinical(), before);
});

test('WUL-961: two confirmations of the same plan apply it once', async () => {
    seed();
    const service = createWebAmbulatoryDestructiveService();
    const admin = webSession();
    const cleared = () => (sql.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'ambulatory.cleared'").get() as { count: number }).count;
    const clearedBefore = cleared();
    const prepared = service.prepare(admin, { operation: 'ambulatory.clear-test.v1', ambulatoryId: 'other-test', expectedVersion: 1 });
    const [a, b] = await Promise.all([
        service.execute(new Request(origin), admin, { reference: prepared.value.reference, pin: PIN }),
        service.execute(new Request(origin), admin, { reference: prepared.value.reference, pin: PIN }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.equal([a, b].find(reply => reply.status === 409)!.value.code, 'AMBULATORY_COMMAND_ALREADY_SENT');
    assert.equal(cleared() - clearedBefore, 1);
    assert.equal((clinical().ambulatories as Array<{ id: string; version: number }>).find(row => row.id === 'other-test')!.version, 2);
});

test('WUL-961: a clear whose audit cannot be written rolls back entirely and can be prepared again', async () => {
    seed();
    const service = createWebAmbulatoryDestructiveService();
    const admin = webSession();
    const before = clinical();
    const prepared = service.prepare(admin, { operation: 'ambulatory.clear-test.v1', ambulatoryId: 'other-test', expectedVersion: 1 });
    sql.exec("CREATE TRIGGER synthetic_web_command_audit BEFORE INSERT ON audit_events WHEN NEW.event_type='patient.deleted' BEGIN SELECT RAISE(IGNORE); END");
    await assert.rejects(service.execute(new Request(origin), admin, { reference: prepared.value.reference, pin: PIN }));
    assert.deepEqual(clinical(), before);
    sql.exec('DROP TRIGGER synthetic_web_command_audit');
    const again = service.prepare(admin, { operation: 'ambulatory.clear-test.v1', ambulatoryId: 'other-test', expectedVersion: 1 });
    assert.equal(again.status, 200);
    assert.equal((await service.execute(new Request(origin), admin, { reference: again.value.reference, pin: PIN })).status, 200);
});
