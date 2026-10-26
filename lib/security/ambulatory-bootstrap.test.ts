import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { fork } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import { ambulatories, users, settings } from '../schema';
import { installNetworkPatientCookieFixture, syntheticNetworkPatientAuthority } from '../network-patient-authority-test-fixture';
import { NETWORK_PAIRING_STATE_KEY, serializeNetworkPairingState } from '../network-pairing-model';
import { currentArchiveGeneration } from './archive-session-generation';
import { clearAllSessions, retireServerSessionForLogout } from './server-session';
import { beginWebAuthControl, issueWebAuthControl, resolveWebAuthControlSession } from './web-auth-control-transport';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(process.env.MEDIFLOW_DATA_DIR!, 'bootstrap-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const cookieState = { cookies: new Map<string, string>() };
const cleanup = installNetworkPatientCookieFixture(dataDir, cookieState);
const { dbServer, openDbServer } = load('../db-server.ts') as typeof import('../db-server'); openDbServer();
const { createAmbulatoryBootstrapService, ambulatoryBootstrapService } = load('./ambulatory-bootstrap-service.ts') as typeof import('./ambulatory-bootstrap-service');
const { ambulatoryBootstrapHttp } = load('./ambulatory-bootstrap-http.ts') as typeof import('./ambulatory-bootstrap-http');
const sql = dbServer.$client;
const origin = 'http://127.0.0.1:31999';
const operation = 'first-ambulatory.create.v1';
const draft = () => ({ operation, id: randomUUID(), name: 'Sede inventata', address: null, description: null });
const confirm = { operation, confirm: true };
type Service = ReturnType<typeof createAmbulatoryBootstrapService>;

test.after(() => { clearAllSessions(); cleanup(); sql.close(); });
function seed() {
    clearAllSessions(); cookieState.cookies.clear();
    dbServer.delete(ambulatories).run();
    dbServer.update(users).set({ role: 'admin' }).run();
    const native = syntheticNetworkPatientAuthority(dbServer, 'scope-not-yet-created');
    return native;
}
function request(path = '', headers: Record<string, string> = {}, method = 'POST') {
    return new Request(`${origin}/api/auth/ambulatory-bootstrap${path}`, { method, headers: {
        origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json',
        'x-mediflow-archive-generation': currentArchiveGeneration(), ...headers,
    } });
}
function bind(service: Service, native: ReturnType<typeof seed>, payload = draft()) {
    const initial = request('/begin', Object.fromEntries(native.request.headers));
    const result = service.begin(initial, native.session, native.pairedClient, payload);
    assert.equal(result.status, 200); assert.ok(result.control);
    const attempt = beginWebAuthControl('login', Object.freeze({ controlId: result.control.controlId, ifMatch: result.control.etag, idempotencyKey: randomUUID() }));
    assert.ok(attempt);
    const web = issueWebAuthControl(attempt, { id: native.session.userId, username: native.session.username, role: native.session.role });
    assert.ok(web);
    const headers = { 'x-mediflow-bootstrap-reference': String(result.value.reference),
        cookie: `mediflow_session=${web.sessionId}; mediflow_auth_control=${result.control.controlId}` };
    return { payload, web, control: result.control, headers, initial, reference: String(result.value.reference) };
}
function snapshot() {
    return { rows: sql.prepare('SELECT * FROM ambulatories ORDER BY id').all(), audit: sql.prepare('SELECT * FROM audit_events ORDER BY rowid').all() };
}

test('exact first create, authenticated readback and no replay leave one row and one audit', () => {
    const service = createAmbulatoryBootstrapService(), native = seed(), flow = bind(service, native);
    const before = snapshot();
    const created = service.commit(request('', flow.headers), confirm);
    assert.equal(created.status, 201);
    assert.deepEqual(created.value.affectedAmbulatories, [{ id: flow.payload.id, version: 1 }]);
    const after = snapshot();
    assert.equal(after.rows.length, 1); assert.equal(after.audit.length - before.audit.length, 1);
    assert.equal(service.read(request('', flow.headers, 'GET')).status, 200);
    assert.equal(service.commit(request('', flow.headers), confirm).value.code, 'BOOTSTRAP_NOT_EMPTY');
    assert.deepEqual(snapshot(), after);
});

test('two preparations cannot create two rows even when the second ID differs', () => {
    const service = createAmbulatoryBootstrapService(), native = seed();
    const a = bind(service, native), b = bind(service, native);
    assert.equal(service.commit(request('', a.headers), confirm).status, 201);
    const before = snapshot();
    assert.equal(service.commit(request('', b.headers), confirm).status, 409);
    assert.deepEqual(snapshot(), before);
});

test('two real processes contend for SQLite and only one bootstrap commits', { timeout: 20_000 }, async () => {
    seed();
    const before = snapshot();
    const workerFile = join(dataDir, 'concurrent-bootstrap.cjs');
    const release = join(dataDir, `release-${randomUUID()}`);
    writeFileSync(workerFile, `
const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const [root,dir,workerId,id,release]=process.argv.slice(2);
const cookieDir=path.join(dir,workerId);fs.mkdirSync(cookieDir,{recursive:true});
const fixture=require(root+'/lib/network-patient-authority-test-fixture.ts');
const cleanup=fixture.installNetworkPatientCookieFixture(cookieDir,{cookies:new Map()});
const {dbServer,openDbServer}=require(root+'/lib/db-server.ts');openDbServer();
const {createAmbulatoryBootstrapService}=require(root+'/lib/security/ambulatory-bootstrap-service.ts');
const {beginWebAuthControl,issueWebAuthControl}=require(root+'/lib/security/web-auth-control-transport.ts');
const {currentArchiveGeneration}=require(root+'/lib/security/archive-session-generation.ts');
const native=fixture.syntheticNetworkPatientAuthority(dbServer,'no-scope');
const service=createAmbulatoryBootstrapService(),origin='http://127.0.0.1:31999';
const req=(headers={})=>new Request(origin+'/api/auth/ambulatory-bootstrap',{method:'POST',headers:{origin,'content-type':'application/json','sec-fetch-site':'same-origin','x-mediflow-archive-generation':currentArchiveGeneration(),...headers}});
const opened=service.begin(req(Object.fromEntries(native.request.headers)),native.session,native.pairedClient,{operation:'first-ambulatory.create.v1',id,name:'Sede concorrente '+workerId,address:null,description:null});
if(!opened.control)throw new Error('prepare denied '+opened.status);
const attempt=beginWebAuthControl('login',Object.freeze({controlId:opened.control.controlId,ifMatch:opened.control.etag,idempotencyKey:crypto.randomUUID()}));
const web=issueWebAuthControl(attempt,{id:native.session.userId,username:native.session.username,role:'admin'});
if(!web)throw new Error('web issue denied');
const headers={'x-mediflow-bootstrap-reference':opened.value.reference,cookie:'mediflow_session='+web.sessionId+'; mediflow_auth_control='+opened.control.controlId};
process.on('message',message=>{
 if(message==='commit'){
  process.send({kind:'attempting'});
  let result;
  if(workerId==='a')result=dbServer.transaction(()=>{process.send({kind:'locked'});const deadline=Date.now()+5000;while(!fs.existsSync(release)){if(Date.now()>deadline)throw new Error('barrier timeout');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);}return service.commit(req(headers),{operation:'first-ambulatory.create.v1',confirm:true});},{behavior:'immediate'});
  else result=service.commit(req(headers),{operation:'first-ambulatory.create.v1',confirm:true});
  cleanup();dbServer.$client.close();process.send({kind:'done',status:result.status,code:result.value.code});process.disconnect();
 }
});process.send({kind:'ready'});
`);
    const workers = ['a', 'b'].map(workerId => {
        const child = fork(workerFile, [process.cwd(), dataDir, workerId, randomUUID(), release], {
            execArgv: ['--import', pathToFileURL(join(process.cwd(), 'scripts/register-strip-types-loader.mjs')).href],
            env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        });
        const exited = new Promise<number | null>(resolve => child.once('exit', code => resolve(code)));
        const messages: Array<{ kind: string; status?: number; code?: string }> = [];
        let failure = '';
        child.stderr?.on('data', chunk => { failure += String(chunk); });
        child.on('message', message => messages.push(message as typeof messages[number]));
        return { child, messages, exited, failure: () => failure };
    });
    const wait = async (worker: typeof workers[number], kind: string) => {
        for (let n = 0; n < 1000; n++) {
            const message = worker.messages.find(message => message.kind === kind);
            if (message) return message;
            if (worker.child.exitCode !== null) throw new Error(worker.failure() || 'worker exited');
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        throw new Error(`worker ${kind} timeout: ${worker.failure()}`);
    };
    try {
        await Promise.all(workers.map(worker => wait(worker, 'ready')));
        workers[0].child.send('commit'); await wait(workers[0], 'locked');
        workers[1].child.send('commit'); await wait(workers[1], 'attempting');
        writeFileSync(release, 'release synthetic writer barrier');
        const results = await Promise.all(workers.map(worker => wait(worker, 'done')));
        assert.deepEqual(results.map(result => result.status), [201, 409]);
        assert.equal(results[1].code, 'BOOTSTRAP_NOT_EMPTY');
        const exits = await Promise.all(workers.map(worker => worker.exited));
        assert.deepEqual(exits, [0, 0]);
        const after = snapshot();
        assert.equal(after.rows.length, 1); assert.equal(after.audit.length - before.audit.length, 1);
    } finally {
        for (const { child } of workers) if (child.exitCode === null && child.connected) child.kill();
    }
});

test('missing, substituted and expired authorities never change rows or audit', () => {
    const service = createAmbulatoryBootstrapService(), native = seed();
    const a = bind(service, native), b = bind(service, native), before = snapshot();
    assert.equal(service.commit(request(), confirm).status, 401);
    assert.equal(service.commit(request('', { ...a.headers, cookie: b.headers.cookie }), confirm).status, 401);
    assert.equal(service.commit(request('', { ...a.headers, cookie: `mediflow_session=${native.session.id}; mediflow_auth_control=${a.control.controlId}` }), confirm).status, 401);
    assert.deepEqual(snapshot(), before);
});

test('native revocation, role changes and generation changes are checked at the actual commit', () => {
    for (const change of ['session', 'role', 'peer', 'archive'] as const) {
        const service = createAmbulatoryBootstrapService(), native = seed(), flow = bind(service, native);
        if (change === 'session') retireServerSessionForLogout(native.session.id);
        if (change === 'role') dbServer.update(users).set({ role: 'operator' }).where(eq(users.id, native.session.userId)).run();
        if (change === 'peer') dbServer.update(settings).set({ value: JSON.stringify({ ...JSON.parse(serializeNetworkPairingState({ clients: [], intents: [] })), archiveGeneration: currentArchiveGeneration() }) }).where(eq(settings.key, NETWORK_PAIRING_STATE_KEY)).run();
        if (change === 'archive') sql.prepare('UPDATE archive_generation SET generation=? WHERE id=1').run(randomUUID());
        const before = snapshot();
        if (change === 'archive') assert.equal(service.commit(request('', flow.headers), confirm).value.code, 'ARCHIVE_REPLACED');
        else assert.ok(service.commit(request('', flow.headers), confirm).status >= 400);
        assert.deepEqual(snapshot(), before);
    }
});

test('non-admin and different Web operator are not eligible', () => {
    const service = createAmbulatoryBootstrapService(), native = seed();
    dbServer.update(users).set({ role: 'operator' }).run();
    assert.equal(service.begin(request('/begin', Object.fromEntries(native.request.headers)), native.session, native.pairedClient, draft()).status, 403);
    dbServer.update(users).set({ role: 'admin' }).run();
    const result = service.begin(request('/begin', Object.fromEntries(native.request.headers)), native.session, native.pairedClient, draft());
    assert.ok(result.control);
    const attempt = beginWebAuthControl('login', Object.freeze({ controlId: result.control.controlId, ifMatch: result.control.etag, idempotencyKey: randomUUID() }));
    const web = issueWebAuthControl(attempt, { id: 'other-synthetic-user', username: ['synthetic', 'other'].join('-'), role: 'admin' }); assert.ok(web);
    const before = snapshot();
    assert.equal(service.commit(request('', { 'x-mediflow-bootstrap-reference': String(result.value.reference), cookie: `mediflow_session=${web.sessionId}; mediflow_auth_control=${result.control.controlId}` }), confirm).status, 401);
    assert.deepEqual(snapshot(), before);
});

test('deadline and capacity deny without evicting a live preparation', () => {
    let clock = Date.now();
    const service = createAmbulatoryBootstrapService({ now: () => clock }), native = seed();
    const first = bind(service, native); clock = Date.now() + 120_001;
    assert.equal(service.commit(request('', first.headers), confirm).value.code, 'BOOTSTRAP_EXPIRED');
    const before = snapshot();
    for (let index = 1; index < 128; index++) assert.equal(service.begin(request('/begin', Object.fromEntries(native.request.headers)), native.session, native.pairedClient, draft()).status, 200);
    assert.equal((service.begin(request('/begin', Object.fromEntries(native.request.headers)), native.session, native.pairedClient, draft()).value as Record<string, unknown>).code, 'BOOTSTRAP_CAPACITY');
    assert.deepEqual(snapshot(), before);
});

test('audit FAIL/IGNORE and DML IGNORE roll back the exact bootstrap writer', () => {
    for (const trigger of ["BEFORE INSERT ON audit_events BEGIN SELECT RAISE(FAIL, 'synthetic failure'); END",
        'BEFORE INSERT ON audit_events BEGIN SELECT RAISE(IGNORE); END',
        'BEFORE INSERT ON ambulatories BEGIN SELECT RAISE(IGNORE); END']) {
        const service = createAmbulatoryBootstrapService(), native = seed(), flow = bind(service, native), before = snapshot();
        sql.exec(`CREATE TRIGGER synthetic_bootstrap_fault ${trigger}`);
        try { assert.throws(() => service.commit(request('', flow.headers), confirm)); assert.deepEqual(snapshot(), before); }
        finally { sql.exec('DROP TRIGGER synthetic_bootstrap_fault'); }
    }
});

test('reconciliation observes matching state without attributing causality or rearming creation', () => {
    const service = createAmbulatoryBootstrapService(), native = seed(), flow = bind(service, native);
    service.commit(request('', flow.headers), confirm);
    const fresh = bind(service, native, flow.payload);
    const before = snapshot();
    assert.equal(service.read(request('', fresh.headers, 'GET')).status, 200);
    assert.equal(service.commit(request('', fresh.headers), confirm).status, 409);
    assert.deepEqual(snapshot(), before);
    dbServer.update(ambulatories).set({ name: 'Altra sede inventata', version: 2 }).run();
    assert.equal(service.read(request('', fresh.headers, 'GET')).value.code, 'READBACK_DIVERGED');
});

test('exact retirement preserves another Web P3, native authority and never invokes Supervisor retirement', async () => {
    const service = createAmbulatoryBootstrapService(), native = seed(), a = bind(service, native), b = bind(service, native);
    assert.equal((await service.retire(request('', { ...a.headers, cookie: b.headers.cookie }), { operation: 'first-ambulatory.retire.v1' })).status, 401);
    const sentinel = { calls: 0 };
    const key = Symbol.for('synthetic-bootstrap-supervisor-sentinel');
    (globalThis as unknown as Record<symbol, unknown>)[key] = sentinel;
    const file = join(dataDir, 'supervisor-sentinel.cjs');
    writeFileSync(file, "exports.retirePortableSupervisorWebSessionV1=async()=>{globalThis[Symbol.for('synthetic-bootstrap-supervisor-sentinel')].calls++;return true;};");
    const { registerHooks } = load('node:module') as { registerHooks(hooks: { resolve(specifier: string, context: unknown, next: (specifier: string, context: unknown) => { url: string }): { url: string; shortCircuit?: boolean } }): { deregister(): void } };
    const hook = registerHooks({ resolve(specifier, context, next) {
        return specifier === './portable-supervisor-web-session-controller'
            ? { url: pathToFileURL(file).href, shortCircuit: true } : next(specifier, context);
    } });
    try {
        assert.equal((await service.retire(request('', a.headers), { operation: 'first-ambulatory.retire.v1' })).status, 204);
        assert.equal(sentinel.calls, 0);
        const generic = load('./portable-supervisor-web-lifecycle.ts') as typeof import('./portable-supervisor-web-lifecycle');
        assert.equal((await generic.completePortableSupervisorWebLifecycleMutationV1(Promise.resolve(new Response(null, { status: 204 })), 'logout')).status, 204);
        assert.equal(sentinel.calls, 1, 'positive control: generic lifecycle would reach the Supervisor boundary');
    } finally { hook.deregister(); delete (globalThis as unknown as Record<symbol, unknown>)[key]; }
    assert.equal(resolveWebAuthControlSession(b.web.sessionId, b.control.controlId)?.status, 'active');
    assert.equal(service.commit(request('', b.headers), confirm).status, 201);
});

test('HTTP gate rejects CSRF, query and malformed input before a writer can run', async () => {
    seed(); const before = snapshot();
    for (const headers of [{ origin: 'http://127.0.0.1:32000' }, { 'sec-fetch-site': 'cross-site' }, { 'content-type': 'text/plain' }] as Array<Record<string, string>>) {
        assert.equal((await ambulatoryBootstrapHttp(request('/begin', headers), 'begin')).status, 403);
    }
    assert.equal((await ambulatoryBootstrapHttp(new Request(`${origin}/api/auth/ambulatory-bootstrap?x=1`, { headers: { origin, 'sec-fetch-site': 'same-origin' } }), 'read')).status, 403);
    assert.deepEqual(snapshot(), before);
});


test('HTTP begin, real Web P3 login and the named commit/read/retire compose without a scope', async () => {
    const native = seed();
    const bcrypt = load('bcryptjs') as typeof import('bcryptjs');
    const pin = ['24', '68'].join('');
    dbServer.update(users).set({ passwordHash: await bcrypt.hash(pin, 4), unlockVerifierHash: null }).where(eq(users.id, native.session.userId)).run();
    cookieState.cookies.set('mediflow_session', native.session.id);
    const payload = draft();
    const initialHeaders = Object.fromEntries(native.request.headers);
    const opened = await ambulatoryBootstrapHttp(new Request(`${origin}/api/auth/ambulatory-bootstrap/begin`, {
        method: 'POST', headers: Object.fromEntries(request('/begin', initialHeaders).headers), body: JSON.stringify(payload),
    }), 'begin');
    assert.equal(opened.status, 200);
    const value = await opened.json() as { reference: string };
    const control = opened.headers.get('set-cookie')!.match(/mediflow_auth_control=([^;]+)/u)![1];
    const login = load('../../app/api/auth/login/route.ts') as typeof import('../../app/api/auth/login/route');
    const logged = await login.POST(new Request(`${origin}/api/auth/login`, { method: 'POST',
        headers: { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', cookie: `mediflow_auth_control=${control}`,
            'if-match': opened.headers.get('etag')!, 'idempotency-key': randomUUID() },
        body: JSON.stringify({ username: native.session.username, password: pin }) }));
    assert.equal(logged.status, 200);
    const web = logged.headers.get('set-cookie')!.match(/mediflow_session=([^;]+)/u)![1];
    const headers = { 'x-mediflow-bootstrap-reference': value.reference, cookie: `mediflow_session=${web}; mediflow_auth_control=${control}` };
    const before = snapshot();
    const created = await ambulatoryBootstrapHttp(new Request(request('', headers), { body: JSON.stringify(confirm) }), 'commit');
    assert.equal(created.status, 201);
    assert.equal(snapshot().audit.length - before.audit.length, 1);
    assert.equal((await ambulatoryBootstrapHttp(request('', headers, 'GET'), 'read')).status, 200);
    assert.equal((await ambulatoryBootstrapHttp(new Request(request('/retire', headers), { body: JSON.stringify({ operation: 'first-ambulatory.retire.v1' }) }), 'retire')).status, 204);
});


test('closed first-site payload rejects extra fields and malformed identifiers without effects', () => {
    const service = createAmbulatoryBootstrapService(), native = seed(), valid = draft(), before = snapshot();
    for (const value of [{ ...valid, parentId: 'invented' }, { ...valid, type: 'test' }, { ...valid, isDefault: false },
        { ...valid, id: '' }, { ...valid, name: ' name ' }, { ...valid, address: 'x'.repeat(501) }]) {
        assert.equal(service.begin(request('/begin', Object.fromEntries(native.request.headers)), native.session, native.pairedClient, value).status, 400);
    }
    assert.deepEqual(snapshot(), before);
});

test('HTTP commit rechecks Web revocation, role and archive after a paused body', async () => {
    const owner = load('./web-auth-lifecycle-owner-adapter.ts') as typeof import('./web-auth-lifecycle-owner-adapter');
    for (const mutation of ['web', 'role', 'archive'] as const) {
        const native = seed(), flow = bind(ambulatoryBootstrapService, native);
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
        const input = new Request(request('', flow.headers), { body, duplex: 'half' } as RequestInit);
        const pending = ambulatoryBootstrapHttp(input, 'commit');
        controller.enqueue(new TextEncoder().encode('{'));
        await new Promise<void>(resolve => setImmediate(resolve));
        if (mutation === 'web') {
            const resolution = resolveWebAuthControlSession(flow.web.sessionId, flow.control.controlId);
            assert.equal(resolution?.status, 'active');
            owner.retire((resolution as { projection: unknown }).projection, 'delete');
        } else if (mutation === 'role') dbServer.update(users).set({ role: 'operator' }).run();
        else sql.prepare('UPDATE archive_generation SET generation=? WHERE id=1').run(randomUUID());
        const before = snapshot();
        controller.enqueue(new TextEncoder().encode(JSON.stringify(confirm).slice(1))); controller.close();
        const result = await pending;
        assert.equal(result.status, mutation === 'web' ? 401 : mutation === 'role' ? 403 : 409);
        assert.deepEqual(snapshot(), before);
    }
});

test('exact Web retirement remains available after its paired operator was revoked', async () => {
    const service = createAmbulatoryBootstrapService(), native = seed(), flow = bind(service, native);
    retireServerSessionForLogout(native.session.id);
    assert.equal((await service.retire(request('', flow.headers), { operation: 'first-ambulatory.retire.v1' })).status, 204);
});
