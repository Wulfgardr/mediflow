/* @Codex: WUL-720 real synthetic SQLite and real Web/API-v1 DELETE route checks. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import Database from 'better-sqlite3';
import { ambulatories, entries, patients, patientsToAmbulatories } from './schema';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-c05-delete-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const previousToken = process.env.MEDIFLOW_LOCAL_API_TOKEN;
process.env.MEDIFLOW_LOCAL_API_TOKEN = 'c05-delete-synthetic-token';
const state = { web: true, v1: true, actorSession: false };
const stateKey = Symbol.for(`c05-delete-auth-${dataDir}`);
(globalThis as unknown as Record<symbol, typeof state>)[stateKey] = state;
function seam(name: string, source: string) {
    const file = join(dataDir, name);
    writeFileSync(file, source, { mode: 0o600 });
    return pathToFileURL(file).href;
}
const auth = seam('auth.cjs', `const s=globalThis[Symbol.for(${JSON.stringify(`c05-delete-auth-${dataDir}`)})];
exports.requireSession=async()=>s.web?({id:'web-session',userId:'c05-web-user',role:'admin'}):null;
exports.requireLocalApiActorSession=async()=>s.actorSession?({id:'native-session',userId:'c05-native-user',role:'admin'}):({id:'local-api',userId:'local-api',role:'admin'});
exports.unauthorizedResponse=()=>Response.json({error:'Unauthorized'},{status:401});`);
const token = seam('token.cjs', `const s=globalThis[Symbol.for(${JSON.stringify(`c05-delete-auth-${dataDir}`)})];
exports.requireLocalApiToken=()=>s.v1?null:Response.json({error:'Unauthorized'},{status:401});
exports.hasValidLocalApiToken=(request)=>s.v1&&request.headers.get('authorization')==='Bearer c05-delete-synthetic-token';`);
const { registerHooks } = load('node:module') as {
    registerHooks: (hooks: { resolve: (specifier: string, context: unknown,
        next: (specifier: string, context: unknown) => { url: string }) => { url: string; shortCircuit?: boolean } }) => { deregister: () => void };
};
const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@/lib/security/server-auth') return { url: auth, shortCircuit: true };
    if (specifier === '@/lib/security/local-api-auth') return { url: token, shortCircuit: true };
    return next(specifier, context);
} });
const { dbServer } = load('./db-server.ts') as typeof import('./db-server.ts');
const web = load('../app/api/patients/[id]/route.ts') as typeof import('../app/api/patients/[id]/route.ts');
const v1 = load('../app/api/v1/patients/[id]/route.ts') as typeof import('../app/api/v1/patients/[id]/route.ts');
const sql = new Database(join(dataDir, 'medical.db'));
const id = 'c05-delete-patient';

test.after(() => {
    sql.close(); dbServer.$client.close(); hooks.deregister();
    delete (globalThis as unknown as Record<symbol, typeof state>)[stateKey];
    if (previousToken === undefined) delete process.env.MEDIFLOW_LOCAL_API_TOKEN;
    else process.env.MEDIFLOW_LOCAL_API_TOKEN = previousToken;
    rmSync(dataDir, { recursive: true, force: true });
});

function reset(archived = false) {
    sql.exec('DROP TRIGGER IF EXISTS c05_delete_audit_fail');
    sql.exec('DROP TRIGGER IF EXISTS c05_delete_patient_fail');
    dbServer.delete(entries).run();
    dbServer.delete(patientsToAmbulatories).run();
    dbServer.delete(patients).run();
    dbServer.delete(ambulatories).run();
    dbServer.insert(ambulatories).values({ id: 'c05-delete-a', name: 'Ambulatorio sintetico', type: 'live' }).run();
    dbServer.insert(patients).values({ id, firstName: 'Ada', lastName: 'Sintetica', taxCode: 'C05DELETE',
        version: 3, ambulatoryId: 'c05-delete-a', isArchived: archived }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId: id, ambulatoryId: 'c05-delete-a' }).run();
    dbServer.insert(entries).values({ id: 'c05-delete-entry', patientId: id, type: 'note',
        title: 'Voce sintetica', date: new Date('2026-01-01'), content: 'Segnaposto sintetico' }).run();
    state.web = true; state.v1 = true; state.actorSession = false;
}

function snapshot() {
    const patient = dbServer.select().from(patients).all()[0];
    return { version: patient.version, deletedAt: patient.deletedAt?.getTime() ?? null,
        deletionReason: patient.deletionReason, isArchived: patient.isArchived,
        entries: dbServer.select().from(entries).all().map(row => row.id),
        memberships: dbServer.select().from(patientsToAmbulatories).all().map(row => row.ambulatoryId),
        events: sql.prepare('SELECT event_type, actor_type, actor_ref, source_surface, subject_ref, redacted_metadata FROM audit_events WHERE subject_ref=? ORDER BY rowid').all(id) as Array<Record<string, unknown>> };
}

type Route = typeof web | typeof v1;
function requestFor(route: Route, body: string) {
    return new Request(`http://127.0.0.1/api/patients/${id}`, { method: 'DELETE', body,
        headers: { 'content-type': 'application/json',
            authorization: route === v1 ? 'Bearer c05-delete-synthetic-token' : '',
            'x-request-id': 'c05-delete-request', 'x-mediflow-source-surface': 'job',
            'x-actor-ref': 'spoofed',
        } });
}
function del(route: Route, body: string | Request) {
    return route.DELETE(typeof body === 'string' ? requestFor(route, body) : body,
        { params: Promise.resolve({ id }) });
}

for (const [name, route] of [['web', web], ['v1', v1]] as const) {
    test(`${name}: audit FAIL rolls back the tombstone`, async () => {
        reset();
        const before = snapshot();
        sql.exec("CREATE TRIGGER c05_delete_audit_fail BEFORE INSERT ON audit_events BEGIN SELECT RAISE(FAIL, 'synthetic audit failure'); END");
        const response = await del(route, JSON.stringify({ version: 3 }));
        assert.equal(response.status, 500);
        assert.deepEqual(snapshot(), before);
    });

    test(`${name}: audit IGNORE also rolls back the tombstone`, async () => {
        reset();
        const before = snapshot();
        sql.exec('CREATE TRIGGER c05_delete_audit_fail BEFORE INSERT ON audit_events BEGIN SELECT RAISE(IGNORE); END');
        const response = await del(route, JSON.stringify({ version: 3 }));
        assert.equal(response.status, 500);
        assert.deepEqual(snapshot(), before);
    });

    test(`${name}: failed patient UPDATE leaves no new audit event`, async () => {
        reset();
        const before = snapshot();
        sql.exec("CREATE TRIGGER c05_delete_patient_fail BEFORE UPDATE OF deleted_at ON patients BEGIN SELECT RAISE(FAIL, 'synthetic patient update failure'); END");
        const response = await del(route, JSON.stringify({ version: 3 }));
        assert.equal(response.status, 500);
        assert.deepEqual(snapshot(), before);
    });

    test(`${name}: successful delete commits one event and preserves child and membership`, async () => {
        reset();
        const before = snapshot();
        const response = await del(route, JSON.stringify({ version: 3, deletionReason: 'motivo sintetico',
            actorRef: 'forged', sourceSurface: 'job', clinicalSentinel: 'SECRET_SYNTHETIC_CLINICAL' }));
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { success: true });
        const after = snapshot();
        assert.equal(after.version, 4);
        assert.ok(after.deletedAt);
        assert.equal(after.deletionReason, 'motivo sintetico');
        assert.deepEqual(after.entries, before.entries);
        assert.deepEqual(after.memberships, before.memberships);
        assert.equal(after.events.length, before.events.length + 1);
        const event = after.events.at(-1)!;
        assert.equal(event.event_type, 'patient.deleted');
        assert.equal(event.subject_ref, id);
        assert.equal(event.actor_type, name === 'web' ? 'user' : 'system');
        assert.equal(event.actor_ref, name === 'web' ? 'c05-web-user' : 'local-api');
        assert.equal(event.source_surface, name === 'web' ? 'web' : 'api');
        assert.deepEqual(JSON.parse(String(event.redacted_metadata)), {
            resourceVersion: 4, flags: [`auth:${name === 'web' ? 'session' : 'local-token'}`],
        });
        assert.doesNotMatch(JSON.stringify(event), /motivo sintetico|SECRET_SYNTHETIC_CLINICAL|forged|job/);

        const reopened = new Database(join(dataDir, 'medical.db'), { readonly: true });
        try {
            const persisted = reopened.prepare('SELECT version, deleted_at, deletion_reason FROM patients WHERE id=?').get(id) as Record<string, unknown>;
            assert.equal(persisted.version, 4);
            assert.ok(persisted.deleted_at);
            assert.equal(persisted.deletion_reason, 'motivo sintetico');
            assert.equal((reopened.prepare('SELECT count(*) AS n FROM entries WHERE patient_id=?').get(id) as { n: number }).n, 1);
            assert.equal((reopened.prepare('SELECT count(*) AS n FROM audit_events WHERE subject_ref=?').get(id) as { n: number }).n,
                before.events.length + 1);
        } finally { reopened.close(); }

        const repeated = await del(route, JSON.stringify({ version: 4 }));
        assert.equal(repeated.status, 404);
        assert.equal(snapshot().events.length, after.events.length);
    });

    test(`${name}: archived patient is tombstoned, not unarchived`, async () => {
        reset(true);
        const response = await del(route, JSON.stringify({ version: 3 }));
        assert.equal(response.status, 200);
        const after = snapshot();
        assert.equal(after.isArchived, true);
        assert.equal(after.version, 4);
        assert.ok(after.deletedAt);
    });

    test(`${name}: stale active version is 409 without state or audit change`, async () => {
        reset();
        const before = snapshot();
        const response = await del(route, JSON.stringify({ version: 2 }));
        assert.equal(response.status, 409);
        const conflict = await response.json();
        assert.equal(conflict.currentVersion, 3);
        assert.deepEqual(snapshot(), before);
    });

    test(`${name}: denied authentication precedes a poisoned body read`, async () => {
        reset();
        const before = snapshot();
        state[name] = false;
        const request = requestFor(route, JSON.stringify({ version: 3 }));
        Object.defineProperty(request, 'json', { value: () => { throw new Error('poisoned JSON read'); } });
        const response = await del(route, request);
        assert.equal(response.status, 401);
        assert.deepEqual(snapshot(), before);
    });

    for (const [label, body] of [['missing version', '{}'], ['invalid version', '{"version":"3"}'],
        ['invalid reason', '{"version":3,"deletionReason":" "}'], ['null', 'null'], ['array', '[]'],
        ['malformed', '{"version":'], ['empty', '']] as const) {
        test(`${name}: ${label} is 400 without state or audit change`, async () => {
            reset();
            const before = snapshot();
            const response = await del(route, body);
            assert.equal(response.status, 400);
            assert.deepEqual(snapshot(), before);
        });
    }
}

test('v1 paired actor session takes precedence over spoofed source and body identity', async () => {
    reset(); state.actorSession = true;
    const before = snapshot();
    const response = await del(v1, JSON.stringify({ version: 3, actorRef: 'forged', sourceSurface: 'job' }));
    assert.equal(response.status, 200);
    const event = snapshot().events.at(-1)!;
    assert.equal(snapshot().events.length, before.events.length + 1);
    assert.equal(event.actor_type, 'user');
    assert.equal(event.actor_ref, 'c05-native-user');
    assert.equal(event.source_surface, 'native');
});

test('two SQLite writer processes with the same version produce one tombstone and one audit event', async () => {
    reset();
    const before = snapshot();
    const script = join(dataDir, 'concurrent-delete.mjs');
    const repo = join(import.meta.dirname, '..');
    writeFileSync(script, `import { createRequire } from 'node:module';
import { existsSync, writeFileSync } from 'node:fs';
const load = createRequire(import.meta.url);
const { deletePatientOperation } = load(${JSON.stringify(join(repo, 'lib/patient-delete-operation.ts'))});
writeFileSync(process.argv[2], 'ready');
while (!existsSync(process.argv[3])) await new Promise(resolve => setTimeout(resolve, 10));
const result = deletePatientOperation({patientId:'c05-delete-patient',expectedVersion:3,
  deletionReason:'synthetic-concurrent', audit:{actorType:'user',actorRef:'c05-child',
    sourceSurface:'web',requestId:'c05-concurrent',flags:['auth:session']}});
console.log(JSON.stringify({status:result.status}));
`, { mode: 0o600 });
    const start = join(dataDir, 'concurrent-start');
    const children = [0, 1].map(index => {
        const ready = join(dataDir, `concurrent-ready-${index}`);
        const child = spawn(process.execPath, ['--experimental-strip-types', '--import',
            join(repo, 'scripts/register-strip-types-loader.mjs'), script, ready, start], {
            cwd: repo, env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir },
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 15_000,
        });
        let stdout = ''; let stderr = '';
        child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
        child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
        const done = new Promise<{ code: number | null; stdout: string; stderr: string; error?: Error }>((resolve) => {
            let error: Error | undefined;
            child.once('error', cause => { error = cause; });
            child.once('close', code => resolve({ code, stdout, stderr, error }));
        });
        return { child, ready, done };
    });
    try {
        const deadline = Date.now() + 10_000;
        while (!children.every(child => existsSync(child.ready))) {
            assert.ok(Date.now() < deadline, 'writer process readiness timeout');
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        writeFileSync(start, 'start');
        const results = await Promise.all(children.map(child => child.done));
        for (const result of results) {
            assert.equal(result.error, undefined);
            assert.equal(result.code, 0, result.stderr);
        }
        const statuses = results.map(result => (JSON.parse(result.stdout) as { status: number }).status).sort();
        assert.equal(statuses[0], 200);
        assert.ok(statuses[1] === 404 || statuses[1] === 409);
        const after = snapshot();
        assert.equal(after.version, 4);
        assert.ok(after.deletedAt);
        assert.equal(after.events.length, before.events.length + 1);
        assert.deepEqual(after.entries, before.entries);
        assert.deepEqual(after.memberships, before.memberships);
    } finally {
        for (const child of children) if (child.child.exitCode === null) child.child.kill();
        await Promise.allSettled(children.map(child => child.done));
    }
});
