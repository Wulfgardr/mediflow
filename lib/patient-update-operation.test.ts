/* @Codex: WUL-718 synthetic SQLite and real patient PUT routes; auth seams only. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import Database from 'better-sqlite3';
import { ambulatories, patients, patientsToAmbulatories } from './schema';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-c03-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const authState = { webAllowed: true, v1Allowed: true };
const authKey = Symbol.for(`mediflow-c03-auth-${dataDir}`);
(globalThis as unknown as Record<symbol, typeof authState>)[authKey] = authState;
const { registerHooks } = load('node:module') as {
    registerHooks: (hooks: { resolve: (specifier: string, context: unknown,
        next: (specifier: string, context: unknown) => { url: string }) => { url: string; shortCircuit?: boolean } }) => { deregister: () => void };
};
const authPath = join(dataDir, 'auth-seam.cjs');
writeFileSync(authPath, `const state=globalThis[Symbol.for(${JSON.stringify(`mediflow-c03-auth-${dataDir}`)})];
exports.requireSession=async()=>state.webAllowed?({userId:'synthetic-user',role:'admin'}):null;
exports.unauthorizedResponse=()=>Response.json({error:'Unauthorized'},{status:401});
exports.requireLocalApiActorSession=async()=>({userId:'synthetic-user',role:'admin'});`, { mode: 0o600 });
const tokenPath = join(dataDir, 'token-seam.cjs');
writeFileSync(tokenPath, `const state=globalThis[Symbol.for(${JSON.stringify(`mediflow-c03-auth-${dataDir}`)})];
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
const sql = new Database(join(dataDir, 'medical.db'));

test.after(() => {
    sql.close();
    dbServer.$client.close();
    hooks.deregister();
    delete (globalThis as unknown as Record<symbol, typeof authState>)[authKey];
    rmSync(dataDir, { recursive: true, force: true });
});

function reset() {
    authState.webAllowed = true;
    authState.v1Allowed = true;
    sql.exec('DROP TRIGGER IF EXISTS c03_fail_membership');
    dbServer.delete(patientsToAmbulatories).run();
    dbServer.delete(patients).run();
    dbServer.delete(ambulatories).run();
    dbServer.insert(ambulatories).values([
        { id: 'c03-a', name: 'Ambulatorio sintetico A', type: 'live' },
        { id: 'c03-b', name: 'Ambulatorio sintetico B', type: 'live' },
    ]).run();
    dbServer.insert(patients).values({
        id: 'c03-patient', firstName: 'Ada', lastName: 'Sintetica', taxCode: 'C03SYNTHETIC',
        ambulatoryId: 'c03-a', version: 3,
    }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId: 'c03-patient', ambulatoryId: 'c03-a' }).run();
}

async function put(route: typeof web | typeof v1, body: Record<string, unknown>) {
    return route.PUT(new Request('http://127.0.0.1/api/patients/c03-patient', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ id: 'c03-patient' }) });
}

function snapshot() {
    const patient = dbServer.select().from(patients).all()[0];
    const memberships = dbServer.select().from(patientsToAmbulatories).all().map(x => x.ambulatoryId).sort();
    return { firstName: patient?.firstName, version: patient?.version,
        ambulatoryId: patient?.ambulatoryId, memberships };
}

function networkContext(scopeAmbulatoryId = 'c03-a') {
    return {
        request: new Request('http://127.0.0.1/api/v1/network/patients/c03-patient'),
        patientId: 'c03-patient', scopeAmbulatoryId,
        pairedClient: { clientId: 'synthetic-client' } as never,
        session: { userId: 'synthetic-user' } as never,
    };
}

for (const [name, route] of [['web', web], ['v1', v1]] as const) {
    test(`${name}: failed membership write rolls patient, primary and version back`, async () => {
        reset();
        sql.exec(`CREATE TRIGGER c03_fail_membership BEFORE INSERT ON patients_to_ambulatories
            WHEN NEW.ambulatory_id = 'c03-b' BEGIN SELECT RAISE(FAIL, 'synthetic membership failure'); END`);
        const response = await put(route, { version: 3, firstName: 'Bea', ambulatoryId: 'c03-b' });
        assert.equal(response.status, 500);
        const row = dbServer.select().from(patients).all()[0];
        assert.equal(row.firstName, 'Ada');
        assert.equal(row.version, 3);
        assert.equal(row.ambulatoryId, 'c03-a');
        assert.deepEqual(dbServer.select().from(patientsToAmbulatories).all().map(x => x.ambulatoryId), ['c03-a']);
    });

    test(`${name}: success once, unrelated memberships retained and retry conflicts`, async () => {
        reset();
        const first = await put(route, { version: 3, firstName: 'Bea', ambulatoryId: 'c03-b' });
        assert.equal(first.status, 200);
        assert.deepEqual(snapshot(), { firstName: 'Bea', version: 4, ambulatoryId: 'c03-b', memberships: ['c03-a', 'c03-b'] });
        const retry = await put(route, { version: 3, firstName: 'Carla', ambulatoryId: 'c03-b' });
        assert.equal(retry.status, 409);
        assert.equal((await retry.json()).code, 'VERSION_CONFLICT');
        assert.deepEqual(snapshot(), { firstName: 'Bea', version: 4, ambulatoryId: 'c03-b', memberships: ['c03-a', 'c03-b'] });
    });

    test(`${name}: explicit null clears primary without deleting memberships`, async () => {
        reset();
        dbServer.insert(patientsToAmbulatories).values({ patientId: 'c03-patient', ambulatoryId: 'c03-b' }).run();
        const response = await put(route, { version: 3, ambulatoryId: null });
        assert.equal(response.status, 200);
        assert.deepEqual(snapshot(), { firstName: 'Ada', version: 4, ambulatoryId: null, memberships: ['c03-a', 'c03-b'] });
    });

    test(`${name}: archived patient can be reactivated without changing sealed fields or memberships`, async () => {
        reset();
        dbServer.insert(patientsToAmbulatories).values({ patientId: 'c03-patient', ambulatoryId: 'c03-b' }).run();
        dbServer.update(patients).set({ isArchived: true, phone: 'ENC:iv:synthetic', archiveReason: 'ENC:iv:reason' }).run();
        const response = await put(route, { version: 3, isArchived: false });
        assert.equal(response.status, 200);
        const row = dbServer.select().from(patients).all()[0];
        assert.equal(row.isArchived, false);
        assert.equal(row.archiveReason, null); // Existing unarchive normalizer semantics.
        assert.equal(row.phone, 'ENC:iv:synthetic');
        assert.deepEqual(snapshot(), { firstName: 'Ada', version: 4, ambulatoryId: 'c03-a', memberships: ['c03-a', 'c03-b'] });
    });

    test(`${name}: denied, missing, deleted, invalid and stale writes have no effect`, async () => {
        reset();
        authState[name === 'web' ? 'webAllowed' : 'v1Allowed'] = false;
        assert.equal((await put(route, { version: 3, firstName: 'Denied' })).status, 401);
        authState.webAllowed = true; authState.v1Allowed = true;
        const missing = await route.PUT(new Request('http://127.0.0.1/missing', {
            method: 'PUT', body: JSON.stringify({ version: 3, firstName: 'Missing' }),
        }), { params: Promise.resolve({ id: 'missing' }) });
        assert.equal(missing.status, 404);
        assert.equal((await put(route, { version: 3, birthDate: 'not-a-date' })).status, 400);
        assert.equal((await put(route, { version: 2, firstName: 'Stale' })).status, 409);
        assert.deepEqual(snapshot(), { firstName: 'Ada', version: 3, ambulatoryId: 'c03-a', memberships: ['c03-a'] });
        dbServer.update(patients).set({ deletedAt: new Date() }).run();
        assert.equal((await put(route, { version: 3, firstName: 'Deleted' })).status, 404);
        assert.equal(snapshot().firstName, 'Ada');
    });
}

test('same-version Web and v1 competing calls have one winner and one conflict', async () => {
    reset();
    const results = await Promise.all([
        put(web, { version: 3, firstName: 'Web' }),
        put(v1, { version: 3, firstName: 'V1' }),
    ]);
    assert.deepEqual(results.map(x => x.status).sort(), [200, 409]);
    assert.equal(snapshot().version, 4);
    assert(['Web', 'V1'].includes(snapshot().firstName ?? ''));
});

test('second SQLite process commits first; immediate transaction reads its version and returns 409', async () => {
    reset();
    const worker = `const Database=require(process.argv[1]);
const db=new Database(process.argv[2]);
db.exec('BEGIN IMMEDIATE');
db.prepare("UPDATE patients SET first_name='Other',version=4 WHERE id='c03-patient'").run();
process.stdout.write('READY\\n');
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);
db.exec('COMMIT');db.close();`;
    const child = spawn(process.execPath, ['-e', worker, load.resolve('better-sqlite3'), join(dataDir, 'medical.db')],
        { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    try {
        await new Promise<void>((resolve, reject) => {
            child.stdout.once('data', chunk => String(chunk).includes('READY') ? resolve() : reject(new Error(String(chunk))));
            child.once('error', reject);
            child.once('exit', code => reject(new Error(`writer exited before lock signal: ${code} ${stderr}`)));
        });
        const response = await put(web, { version: 3, firstName: 'TooLate' });
        assert.equal(response.status, 409);
        assert.equal((await response.json()).currentVersion, 4);
        assert.deepEqual(snapshot(), { firstName: 'Other', version: 4, ambulatoryId: 'c03-a', memberships: ['c03-a'] });
        if (child.exitCode === null && child.signalCode === null) {
            await new Promise<void>(resolve => child.once('exit', () => resolve()));
        }
        assert.equal(child.exitCode, 0, stderr);
    } finally {
        if (child.exitCode === null && child.signalCode === null) {
            child.kill();
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Synthetic writer did not exit after kill')), 5000);
                child.once('exit', () => { clearTimeout(timer); resolve(); });
            });
        }
    }
});

test('network scope, seal boundary and membership failure retain shared commit semantics', async () => {
    reset();
    assert.equal((await updateNetworkScopedPatient(networkContext('c03-b'), { version: 3, firstName: 'Out' })).status, 404);
    assert.equal((await updateNetworkScopedPatient(networkContext(), { version: 3, notes: 'plaintext' })).status, 400);
    assert.equal((await updateNetworkScopedPatient(networkContext(), { version: 3, ambulatoryId: 'c03-b' })).status, 403);
    assert.deepEqual(snapshot(), { firstName: 'Ada', version: 3, ambulatoryId: 'c03-a', memberships: ['c03-a'] });
    dbServer.insert(patientsToAmbulatories).values({ patientId: 'c03-patient', ambulatoryId: 'c03-b' }).run();
    sql.exec(`CREATE TRIGGER c03_fail_membership BEFORE INSERT ON patients_to_ambulatories
        WHEN NEW.ambulatory_id = 'c03-a' BEGIN SELECT RAISE(FAIL, 'synthetic membership failure'); END`);
    await assert.rejects(updateNetworkScopedPatient(networkContext(), {
        version: 3, firstName: 'WouldPartiallyCommit', ambulatoryId: 'c03-a',
    }), /synthetic membership failure/);
    assert.deepEqual(snapshot(), { firstName: 'Ada', version: 3, ambulatoryId: 'c03-a', memberships: ['c03-a', 'c03-b'] });
    sql.exec('DROP TRIGGER c03_fail_membership');
    const accepted = await updateNetworkScopedPatient(networkContext(), { version: 3, firstName: 'Net', ambulatoryId: 'c03-a' });
    assert.equal(accepted.status, 200);
    assert.equal((await updateNetworkScopedPatient(networkContext(), { version: 3, firstName: 'Retry' })).status, 409);
    assert.deepEqual(snapshot(), { firstName: 'Net', version: 4, ambulatoryId: 'c03-a', memberships: ['c03-a', 'c03-b'] });
});

test('network scoped archived-to-active transition retains sealed fields and all memberships', async () => {
    reset();
    dbServer.insert(patientsToAmbulatories).values({ patientId: 'c03-patient', ambulatoryId: 'c03-b' }).run();
    dbServer.update(patients).set({ isArchived: true, phone: 'ENC:iv:synthetic', archiveReason: 'ENC:iv:reason' }).run();
    const result = await updateNetworkScopedPatient(networkContext(), { version: 3, isArchived: false });
    assert.equal(result.status, 200);
    const row = dbServer.select().from(patients).all()[0];
    assert.equal(row.isArchived, false);
    assert.equal(row.archiveReason, null);
    assert.equal(row.phone, 'ENC:iv:synthetic');
    assert.deepEqual(snapshot(), { firstName: 'Ada', version: 4, ambulatoryId: 'c03-a', memberships: ['c03-a', 'c03-b'] });
});
