/* @Codex: WUL-719 real synthetic SQLite, real PUT routes, auth seams only. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import Database from 'better-sqlite3';
import { ambulatories, patients, patientsToAmbulatories } from './schema';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-c04-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const state = { webAllowed: true, v1Allowed: true, v1ActorLocal: true };
const priorLocalApiToken = process.env.MEDIFLOW_LOCAL_API_TOKEN;
process.env.MEDIFLOW_LOCAL_API_TOKEN = 'c04-synthetic-local-token';
const stateKey = Symbol.for(`mediflow-c04-auth-${dataDir}`);
(globalThis as unknown as Record<symbol, typeof state>)[stateKey] = state;
const { registerHooks } = load('node:module') as {
    registerHooks: (hooks: { resolve: (specifier: string, context: unknown,
        next: (specifier: string, context: unknown) => { url: string }) => { url: string; shortCircuit?: boolean } }) => { deregister: () => void };
};
const authPath = join(dataDir, 'auth-seam.cjs');
writeFileSync(authPath, `const state=globalThis[Symbol.for(${JSON.stringify(`mediflow-c04-auth-${dataDir}`)})];
exports.requireSession=async()=>state.webAllowed?({userId:'synthetic-user',role:'admin'}):null;
exports.unauthorizedResponse=()=>Response.json({error:'Unauthorized'},{status:401});
exports.requireLocalApiActorSession=async()=>state.v1ActorLocal?({id:'local-api',userId:'local-api',role:'admin'}):({id:'synthetic-session',userId:'synthetic-user',role:'admin'});`, { mode: 0o600 });
const tokenPath = join(dataDir, 'token-seam.cjs');
writeFileSync(tokenPath, `const state=globalThis[Symbol.for(${JSON.stringify(`mediflow-c04-auth-${dataDir}`)})];
exports.requireLocalApiToken=()=>state.v1Allowed?null:Response.json({error:'Unauthorized'},{status:401});
exports.hasValidLocalApiToken=()=>state.v1Allowed;`, { mode: 0o600 });
const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@/lib/security/server-auth') return { url: pathToFileURL(authPath).href, shortCircuit: true };
    if (specifier === '@/lib/security/local-api-auth') return { url: pathToFileURL(tokenPath).href, shortCircuit: true };
    return next(specifier, context);
} });
const { dbServer } = load('./db-server.ts') as typeof import('./db-server.ts');
const web = load('../app/api/patients/[id]/route.ts') as typeof import('../app/api/patients/[id]/route.ts');
const v1 = load('../app/api/v1/patients/[id]/route.ts') as typeof import('../app/api/v1/patients/[id]/route.ts');
const { updateNetworkScopedPatient } = load('./network-patient-write.ts') as typeof import('./network-patient-write.ts');
const { updatePatientOperation } = load('./patient-update-operation.ts') as typeof import('./patient-update-operation.ts');
const sql = new Database(join(dataDir, 'medical.db'));

test.after(() => {
    sql.close(); dbServer.$client.close(); hooks.deregister();
    if (priorLocalApiToken === undefined) delete process.env.MEDIFLOW_LOCAL_API_TOKEN;
    else process.env.MEDIFLOW_LOCAL_API_TOKEN = priorLocalApiToken;
    delete (globalThis as unknown as Record<symbol, typeof state>)[stateKey];
    rmSync(dataDir, { recursive: true, force: true });
});

function reset() {
    sql.exec('DROP TRIGGER IF EXISTS c04_fail_audit');
    sql.exec('DROP TRIGGER IF EXISTS c04_full_audit');
    sql.exec('DROP TRIGGER IF EXISTS c04_kill_audit');
    dbServer.delete(patientsToAmbulatories).run();
    dbServer.delete(patients).run();
    dbServer.delete(ambulatories).run();
    dbServer.insert(ambulatories).values([
        { id: 'c04-a', name: 'Ambulatorio A sintetico', type: 'live' },
        { id: 'c04-b', name: 'Ambulatorio B sintetico', type: 'live' },
    ]).run();
    dbServer.insert(patients).values({ id: 'c04-patient', firstName: 'Ada', lastName: 'Sintetica',
        taxCode: 'C04SYNTHETIC', ambulatoryId: 'c04-a', version: 3 }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId: 'c04-patient', ambulatoryId: 'c04-a' }).run();
    state.webAllowed = true; state.v1Allowed = true; state.v1ActorLocal = true;
}

async function put(route: typeof web | typeof v1, body: Record<string, unknown>) {
    return route.PUT(new Request('http://127.0.0.1/api/patients/c04-patient', {
        method: 'PUT', headers: {
            'content-type': 'application/json', 'x-request-id': 'c04-synthetic-request',
            'authorization': route === v1 ? 'Bearer c04-synthetic-local-token' : '',
            'x-actor-ref': 'spoofed-actor', 'x-mediflow-source-surface': 'job',
        },
        body: JSON.stringify(body),
    }), { params: Promise.resolve({ id: 'c04-patient' }) });
}

function patientState() {
    const row = dbServer.select().from(patients).all()[0];
    return { firstName: row.firstName, version: row.version, ambulatoryId: row.ambulatoryId,
        memberships: dbServer.select().from(patientsToAmbulatories).all().map(x => x.ambulatoryId).sort() };
}

function events() {
    return sql.prepare("SELECT * FROM audit_events WHERE subject_ref='c04-patient' ORDER BY rowid").all() as Record<string, unknown>[];
}

function runNodeScript(script: string, directory: string, args: string[] = []) {
    const repo = join(import.meta.dirname, '..');
    return spawnSync(process.execPath, ['--experimental-strip-types', '--import',
        join(repo, 'scripts/register-strip-types-loader.mjs'), script, ...args], {
        cwd: repo, env: { ...process.env, MEDIFLOW_DATA_DIR: directory },
        encoding: 'utf8', timeout: 15000,
    });
}

function isolatedDatabaseState(directory: string) {
    const reopened = new Database(join(directory, 'medical.db'), { readonly: true });
    try {
        return {
            patient: reopened.prepare('SELECT first_name, version, ambulatory_id FROM patients WHERE id=?').get('c04-isolated'),
            memberships: reopened.prepare('SELECT ambulatory_id FROM patients_to_ambulatories WHERE patient_id=? ORDER BY ambulatory_id')
                .all('c04-isolated'),
            eventCount: (reopened.prepare("SELECT count(*) AS n FROM audit_events WHERE subject_ref='c04-isolated'").get() as { n: number }).n,
        };
    } finally { reopened.close(); }
}

function isolatedCrashScript(directory: string) {
    const repo = join(import.meta.dirname, '..');
    const script = join(directory, 'isolated-crash.mjs');
    writeFileSync(script, `import { createRequire } from 'node:module';
const load = createRequire(import.meta.url);
const { dbServer } = load(${JSON.stringify(join(repo, 'lib/db-server.ts'))});
const { updatePatientOperation } = load(${JSON.stringify(join(repo, 'lib/patient-update-operation.ts'))});
const { ambulatories, patients, patientsToAmbulatories } = load(${JSON.stringify(join(repo, 'lib/schema.ts'))});
const mode = process.argv[2];
if (mode !== 'retry') {
  dbServer.insert(ambulatories).values([
    {id:'c04-a',name:'A sintetico',type:'live'}, {id:'c04-b',name:'B sintetico',type:'live'}
  ]).run();
  dbServer.insert(patients).values({id:'c04-isolated',firstName:'Ada',lastName:'Sintetica',
    taxCode:'C04ISOLATED',ambulatoryId:'c04-a',version:3}).run();
  dbServer.insert(patientsToAmbulatories).values({patientId:'c04-isolated',ambulatoryId:'c04-a'}).run();
}
if (mode === 'before-audit') {
  dbServer.$client.function('c04_isolated_kill', () => process.kill(process.pid, 'SIGKILL'));
  dbServer.$client.exec("CREATE TRIGGER c04_isolated_kill_audit BEFORE INSERT ON audit_events BEGIN SELECT c04_isolated_kill(); END");
}
const result = updatePatientOperation({ patientId:'c04-isolated', expectedVersion:3,
  values:{firstName:'Child',ambulatoryId:'c04-b',version:999,updatedAt:new Date()},
  setPrimaryAmbulatory:true,
  audit:{actorType:'user',actorRef:'c04-child',sourceSurface:'web',requestId:'c04-child',flags:['auth:session']}
});
if (mode === 'retry') { console.log(JSON.stringify({status:result.status})); }
else { process.kill(process.pid, 'SIGKILL'); }
`, { mode: 0o600 });
    return script;
}

function networkContext() {
    return {
        request: new Request('http://127.0.0.1/api/network/patients/c04-patient', {
            method: 'PUT', headers: { 'x-request-id': 'c04-network-request' },
        }),
        patientId: 'c04-patient', scopeAmbulatoryId: 'c04-a',
        pairedClient: { clientId: 'c04-synthetic-client' } as never,
        session: { userId: 'c04-synthetic-user' } as never,
    };
}

for (const [name, route] of [['web', web], ['v1', v1]] as const) {
    test(`${name}: required audit insert failure rolls patient and membership back`, async () => {
        reset();
        const before = events().length;
        sql.exec(`CREATE TRIGGER c04_fail_audit BEFORE INSERT ON audit_events
            BEGIN SELECT RAISE(FAIL, 'synthetic audit failure'); END`);
        const response = await put(route, { version: 3, firstName: 'Bea', ambulatoryId: 'c04-b' });
        assert.equal(response.status, 500);
        assert.deepEqual(patientState(), { firstName: 'Ada', version: 3, ambulatoryId: 'c04-a', memberships: ['c04-a'] });
        assert.equal(events().length, before);
    });
}

test('ignored required audit insert cannot return success or commit patient and membership', async () => {
    reset();
    const before = events().length;
    sql.exec('CREATE TRIGGER c04_fail_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(IGNORE); END');
    const response = await put(web, { version: 3, firstName: 'Ignored', ambulatoryId: 'c04-b' });
    assert.equal(response.status, 500);
    assert.deepEqual(patientState(), { firstName: 'Ada', version: 3, ambulatoryId: 'c04-a', memberships: ['c04-a'] });
    assert.equal(events().length, before);
});

for (const [name, route] of [['web', web], ['v1', v1]] as const) {
    test(`${name}: one required sanitized event, no event on invalid/stale/denied`, async () => {
        reset();
        const before = events().length;
        const response = await put(route, {
            version: 3, firstName: 'Bea', notes: 'ENC:synthetic-clinical-sentinel',
            unknownClinicalField: 'synthetic-unknown-sentinel', ambulatoryId: 'c04-b',
            actorRef: 'spoofed-body-actor', sourceSurface: 'spoofed-body-surface',
        });
        assert.equal(response.status, 200);
        assert.deepEqual(patientState(), { firstName: 'Bea', version: 4, ambulatoryId: 'c04-b', memberships: ['c04-a', 'c04-b'] });
        assert.equal(events().length, before + 1);
        const event = events().at(-1)!;
        assert.equal(event.event_type, 'patient.updated');
        assert.equal(event.outcome, 'success');
        assert.equal(event.subject_ref, 'c04-patient');
        assert.equal(event.request_id, 'c04-synthetic-request');
        assert.equal(event.actor_type, name === 'web' ? 'user' : 'system');
        assert.equal(event.actor_ref, name === 'web' ? 'synthetic-user' : 'local-api');
        assert.equal(event.source_surface, name === 'web' ? 'web' : 'api');
        const metadata = JSON.parse(event.redacted_metadata as string) as Record<string, unknown>;
        assert.equal(metadata.resourceVersion, 4);
        assert.deepEqual((metadata.changedFields as string[]).sort(), ['ambulatoryId', 'firstName', 'notes']);
        assert.ok(!JSON.stringify(event).includes('synthetic-clinical-sentinel'));
        assert.ok(!JSON.stringify(event).includes('synthetic-unknown-sentinel'));
        const after = events().length;
        assert.equal((await put(route, { version: 3, firstName: 'Retry' })).status, 409);
        assert.equal((await put(route, { version: 4, birthDate: 'not-a-date' })).status, 400);
        if (name === 'web') state.webAllowed = false;
        else state.v1Allowed = false;
        assert.equal((await put(route, { version: 4, firstName: 'Denied' })).status, 401);
        assert.equal(events().length, after);
        assert.equal(patientState().firstName, 'Bea');

        const reopened = new Database(join(dataDir, 'medical.db'), { readonly: true });
        try {
            assert.equal((reopened.prepare("SELECT count(*) AS n FROM audit_events WHERE subject_ref='c04-patient'").get() as { n: number }).n, after);
        } finally { reopened.close(); }
        assert.throws(() => sql.prepare('UPDATE audit_events SET outcome=? WHERE event_id=?').run('failed', event.event_id));
        assert.throws(() => sql.prepare('DELETE FROM audit_events WHERE event_id=?').run(event.event_id));
    });
}

test('v1 with token and associated session attributes native user, never request spoof', async () => {
    reset();
    state.v1ActorLocal = false;
    const before = events().length;
    assert.equal((await put(v1, { version: 3, firstName: 'Native', actorRef: 'spoofed-body' })).status, 200);
    assert.equal(events().length, before + 1);
    const event = events().at(-1)!;
    assert.equal(event.actor_type, 'user');
    assert.equal(event.actor_ref, 'synthetic-user');
    assert.equal(event.source_surface, 'native');
});

for (const [name, invoke] of [
    ['web', () => put(web, { version: 3, isArchived: false })],
    ['v1', () => put(v1, { version: 3, isArchived: false })],
    ['network', () => updateNetworkScopedPatient(networkContext(), { version: 3, isArchived: false })],
] as const) {
    test(`${name}: restore classification comes from stored pre-update archive state`, async () => {
        reset();
        sql.prepare('UPDATE patients SET is_archived=1, archive_reason=?, archive_note=? WHERE id=?')
            .run('synthetic-reason-sentinel', 'synthetic-note-sentinel', 'c04-patient');
        const before = events().length;
        assert.equal((await invoke()).status, 200);
        assert.equal(events().length, before + 1);
        const event = events().at(-1)!;
        assert.equal(event.event_type, 'patient.restored');
        const metadata = JSON.parse(event.redacted_metadata as string) as Record<string, unknown>;
        assert.deepEqual((metadata.changedFields as string[]).sort(), ['archiveNote', 'archiveReason', 'isArchived']);
        assert.equal(metadata.resourceVersion, 4);
        assert.ok(!JSON.stringify(event).includes('synthetic-reason-sentinel'));
        assert.ok(!JSON.stringify(event).includes('synthetic-note-sentinel'));
        assert.equal((sql.prepare('SELECT is_archived AS archived, version FROM patients WHERE id=?').get('c04-patient') as { archived: number; version: number }).archived, 0);
        assert.deepEqual(sql.prepare('SELECT archive_reason, archive_note FROM patients WHERE id=?').get('c04-patient'),
            { archive_reason: null, archive_note: null });
    });
}

test('network: required event uses paired session and scope, failure rolls back', async () => {
    reset();
    const before = events().length;
    const ok = await updateNetworkScopedPatient(networkContext(), { version: 3, firstName: 'Rete', notes: 'ENC:YWJj:ZGVm' });
    assert.equal(ok.status, 200);
    assert.equal(events().length, before + 1);
    const event = events().at(-1)!;
    assert.equal(event.actor_ref, 'c04-synthetic-user');
    assert.equal(event.source_surface, 'native');
    assert.equal(event.request_id, 'c04-network-request');
    const metadata = JSON.parse(event.redacted_metadata as string) as Record<string, unknown>;
    assert.equal(metadata.resourceVersion, 4);
    assert.deepEqual(metadata.changedFields, ['firstName', 'notes']);
    assert.ok((metadata.flags as string[]).includes('auth:paired-client'));
    assert.ok(!JSON.stringify(event).includes('ENC:YWJj:ZGVm'));
    assert.equal((await updateNetworkScopedPatient(networkContext(), { version: 3, firstName: 'Retry' })).status, 409);
    assert.equal((await updateNetworkScopedPatient(networkContext(), { version: 4, notes: 'plaintext' })).status, 400);
    assert.equal(events().length, before + 1);

    reset();
    const beforeFailure = events().length;
    sql.exec(`CREATE TRIGGER c04_fail_audit BEFORE INSERT ON audit_events
        BEGIN SELECT RAISE(FAIL, 'synthetic audit failure'); END`);
    await assert.rejects(updateNetworkScopedPatient(networkContext(), { version: 3, firstName: 'Blocked' }));
    assert.deepEqual(patientState(), { firstName: 'Ada', version: 3, ambulatoryId: 'c04-a', memberships: ['c04-a'] });
    assert.equal(events().length, beforeFailure);
});

test('core derives committed version and audit version from expectedVersion, not supplied values', () => {
    reset();
    const before = events().length;
    const result = updatePatientOperation({
        patientId: 'c04-patient', expectedVersion: 3,
        values: { firstName: 'Core', version: 999, updatedAt: new Date() },
        setPrimaryAmbulatory: false,
        audit: { actorType: 'user', actorRef: 'c04-host', sourceSurface: 'web',
            requestId: 'c04-core-request', flags: ['auth:session'] },
    });
    assert.equal(result.status, 200);
    assert.equal(patientState().version, 4);
    assert.equal(events().length, before + 1);
    const metadata = JSON.parse(events().at(-1)!.redacted_metadata as string) as Record<string, unknown>;
    assert.equal(metadata.resourceVersion, 4);
    assert.deepEqual(metadata.changedFields, ['firstName']);
});

test('SQLITE_FULL in required audit insert rolls back patient and membership', async () => {
    reset();
    const before = events().length;
    sql.exec('CREATE TABLE IF NOT EXISTS c04_pressure(payload BLOB)');
    sql.exec(`CREATE TRIGGER c04_full_audit BEFORE INSERT ON audit_events
        BEGIN INSERT INTO c04_pressure(payload) VALUES (zeroblob(1048576)); END`);
    const pageCount = (sql.pragma('page_count', { simple: true }) as number);
    const oldLimit = dbServer.$client.pragma('max_page_count', { simple: true }) as number;
    dbServer.$client.pragma(`max_page_count = ${pageCount + 1}`);
    try {
        assert.throws(() => updatePatientOperation({
            patientId: 'c04-patient', expectedVersion: 3,
            values: { firstName: 'Full', ambulatoryId: 'c04-b', version: 999, updatedAt: new Date() },
            setPrimaryAmbulatory: true,
            audit: { actorType: 'user', actorRef: 'c04-host', sourceSurface: 'web',
                requestId: 'c04-full-request', flags: ['auth:session'] },
        }), { code: 'SQLITE_FULL' });
        const response = await put(web, { version: 3, firstName: 'Full', ambulatoryId: 'c04-b' });
        assert.equal(response.status, 500);
        assert.deepEqual(patientState(), { firstName: 'Ada', version: 3, ambulatoryId: 'c04-a', memberships: ['c04-a'] });
        assert.equal(events().length, before);
    } finally {
        dbServer.$client.pragma(`max_page_count = ${oldLimit}`);
        sql.exec('DROP TRIGGER IF EXISTS c04_full_audit');
    }
});

for (const mode of ['before-audit', 'after-commit'] as const) {
    test(`isolated process ${mode}: recovery only after writer death, fresh-process retry`, () => {
        const directory = mkdtempSync(join(tmpdir(), `mediflow-c04-${mode}-`));
        try {
            const script = isolatedCrashScript(directory);
            const child = runNodeScript(script, directory, [mode]);
            assert.equal(child.error, undefined, child.stderr);
            assert.equal(child.signal, 'SIGKILL', child.stderr);
            const recovered = isolatedDatabaseState(directory);
            if (mode === 'before-audit') {
                assert.deepEqual(recovered, {
                    patient: { first_name: 'Ada', version: 3, ambulatory_id: 'c04-a' },
                    memberships: [{ ambulatory_id: 'c04-a' }], eventCount: 0,
                });
            } else {
                assert.deepEqual(recovered, {
                    patient: { first_name: 'Child', version: 4, ambulatory_id: 'c04-b' },
                    memberships: [{ ambulatory_id: 'c04-a' }, { ambulatory_id: 'c04-b' }], eventCount: 1,
                });
                const retry = runNodeScript(script, directory, ['retry']);
                assert.equal(retry.status, 0, retry.stderr);
                assert.deepEqual(JSON.parse(retry.stdout.trim()), { status: 409 });
                assert.deepEqual(isolatedDatabaseState(directory), recovered);
            }
        } finally { rmSync(directory, { recursive: true, force: true }); }
    });
}

test('two independent writers for one version yield one success and one required audit event', async () => {
    reset();
    const before = events().length;
    const repo = join(import.meta.dirname, '..');
    const script = join(dataDir, 'competing-writer.mjs');
    writeFileSync(script, `import { createRequire } from 'node:module';
const load = createRequire(import.meta.url);
const { updatePatientOperation } = load(${JSON.stringify(join(repo, 'lib/patient-update-operation.ts'))});
const result = updatePatientOperation({patientId:'c04-patient',expectedVersion:3,
  values:{firstName:process.argv[2],version:4,updatedAt:new Date()},setPrimaryAmbulatory:false,
  audit:{actorType:'user',actorRef:'c04-writer',sourceSurface:'web',requestId:'c04-compete',flags:['auth:session']}});
console.log(JSON.stringify({status:result.status}));
`, { mode: 0o600 });
    async function writer(name: string): Promise<number> {
        return new Promise((resolve, reject) => {
            const child = spawn(process.execPath, ['--experimental-strip-types', '--import',
                join(repo, 'scripts/register-strip-types-loader.mjs'), script, name], {
                cwd: repo, env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir }, timeout: 15000,
            });
            let output = ''; let error = '';
            child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
            child.stderr.setEncoding('utf8').on('data', chunk => { error += chunk; });
            child.on('error', reject);
            child.on('close', code => {
                if (code !== 0) reject(new Error(error || `writer exit ${code}`));
                else resolve((JSON.parse(output.trim()) as { status: number }).status);
            });
        });
    }
    const statuses = await Promise.all([writer('One'), writer('Two')]);
    assert.deepEqual(statuses.sort(), [200, 409]);
    assert.equal(patientState().version, 4);
    assert.equal(events().length, before + 1);
});
