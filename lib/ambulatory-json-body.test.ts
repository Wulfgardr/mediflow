import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import Database from 'better-sqlite3';

// Real route, SQLite, and audit writer. Only session admission is replaced.
const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-ambulatory-body-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const authFile = join(dataDir, 'auth.cjs');
const admission = { role: 'admin' as string | null };
const stateKey = Symbol.for(dataDir);
(globalThis as unknown as Record<symbol, typeof admission>)[stateKey] = admission;
writeFileSync(authFile, `exports.requireSession=async()=>{const role=globalThis[Symbol.for(${JSON.stringify(dataDir)})].role;return role?{id:'synthetic-session',userId:'synthetic-user',role}:null;};
exports.forbiddenResponse=()=>Response.json({error:'Forbidden'},{status:403});
exports.unauthorizedResponse=()=>Response.json({error:'Unauthorized'},{status:401});`);
const { registerHooks } = load('node:module') as {
    registerHooks: (hooks: { resolve: (specifier: string, context: unknown,
        next: (specifier: string, context: unknown) => { url: string }) => { url: string; shortCircuit?: boolean } }) => { deregister: () => void };
};
const hooks = registerHooks({ resolve(specifier, context, next) {
    return specifier === '@/lib/security/server-auth'
        ? { url: pathToFileURL(authFile).href, shortCircuit: true } : next(specifier, context);
} });
const { dbServer } = load('./db-server.ts') as typeof import('./db-server.ts');
const { ambulatories, patients, patientsToAmbulatories } = load('./schema.ts') as typeof import('./schema.ts');
const create = load('../app/api/ambulatories/route.ts') as typeof import('../app/api/ambulatories/route.ts');
const item = load('../app/api/ambulatories/[id]/route.ts') as typeof import('../app/api/ambulatories/[id]/route.ts');
const clear = load('../app/api/ambulatories/clear/route.ts') as typeof import('../app/api/ambulatories/clear/route.ts');
const sql = new Database(join(dataDir, 'medical.db'));
const CAP = 4 * 1024 * 1024;
type Operation = 'create' | 'update' | 'delete' | 'clear';
function call(operation: Operation, body?: string, id = 'synthetic-amb', headers: Record<string, string> = {}) {
    const request = new Request('http://127.0.0.1/api/ambulatories', {
        method: operation === 'update' ? 'PUT' : operation === 'delete' ? 'DELETE' : 'POST',
        headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body }),
    });
    const context = { params: Promise.resolve({ id }) };
    return operation === 'create' ? create.POST(request) : operation === 'clear' ? clear.POST(request)
        : operation === 'update' ? item.PUT(request, context) : item.DELETE(request, context);
}
function snapshot() {
    const reopened = new Database(join(dataDir, 'medical.db'), { readonly: true });
    try { return ['ambulatories', 'patients', 'patients_to_ambulatories', 'audit_events'].map(table =>
        reopened.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    } finally { reopened.close(); }
}
dbServer.insert(ambulatories).values({ id: 'synthetic-amb', name: 'Synthetic', type: 'test',
    address: 'Synthetic address', description: 'Synthetic description', isDefault: true, version: 1 }).run();
dbServer.insert(patients).values({ id: 'synthetic-patient', firstName: 'Ada', lastName: 'Synthetic', taxCode: 'SYN',
    ambulatoryId: 'synthetic-amb' }).run();
dbServer.insert(patientsToAmbulatories).values({ patientId: 'synthetic-patient', ambulatoryId: 'synthetic-amb' }).run();
test.after(() => {
    sql.close(); dbServer.$client.close(); hooks.deregister();
    delete (globalThis as unknown as Record<symbol, typeof admission>)[stateKey];
    rmSync(dataDir, { recursive: true, force: true });
});
test('all four Web adapters reject null without effects', async () => {
    const before = snapshot();
    for (const operation of ['create', 'update', 'delete', 'clear'] as const) {
        assert.equal((await call(operation, 'null')).status, 400, operation);
        assert.deepEqual(snapshot(), before);
    }
});
test('Web malformed JSON returns 400 before effects', async () => {
    const before = snapshot();
    assert.equal((await call('update', '{')).status, 400);
    assert.deepEqual(snapshot(), before);
});
test('shared Web envelope and field validation reject array, scalar, wrong type and excessive bytes', async () => {
    const before = snapshot();
    for (const body of ['[]', 'true', JSON.stringify({ version: 1, address: 42 })]) {
        assert.equal((await call('update', body)).status, 400);
        assert.deepEqual(snapshot(), before);
    }
    const response = await call('update', ' '.repeat(CAP + 1));
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: 'JSON payload too large', code: 'JSON_BODY_TOO_LARGE' });
    assert.deepEqual(snapshot(), before);
});
test('DELETE absent/empty body retains missing-version error; null is invalid JSON', async () => {
    const before = snapshot();
    for (const body of [undefined, '', '  ']) {
        const response = await call('delete', body);
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { error: 'Version is required' });
    }
    assert.deepEqual(snapshot(), before);
});
test('auth and admin gates precede envelope errors; writer preserves version/not-found priority', async () => {
    const before = snapshot();
    try {
        admission.role = null;
        assert.equal((await call('update', 'null', 'missing', { 'content-length': String(CAP + 1) })).status, 401);
        admission.role = 'doctor';
        assert.equal((await call('clear', 'null', 'missing', { 'content-length': String(CAP + 1) })).status, 403);
    } finally { admission.role = 'admin'; }
    assert.equal((await call('update', JSON.stringify({ version: 1, address: 42 }), 'missing')).status, 404);
    const response = await call('update', JSON.stringify({ address: 42 }), 'missing');
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Version is required' });
    assert.deepEqual(snapshot(), before);
});
test('at-cap valid request preserves omitted address and explicit null clears description', async () => {
    const body = JSON.stringify({ version: 1, description: null });
    const response = await call('update', body + ' '.repeat(CAP - Buffer.byteLength(body)));
    assert.equal(response.status, 200);
    const row = sql.prepare('SELECT address, description, version FROM ambulatories WHERE id=?').get('synthetic-amb');
    assert.deepEqual(row, { address: 'Synthetic address', description: null, version: 2 });
});


test('Web create forwards invalid field rejection without changing data or audit', async () => {
    const before = snapshot();
    const response = await call('create', JSON.stringify({ name: 'Synthetic create', id: 42, isDefault: true }));
    assert.equal(response.status, 400);
    assert.deepEqual(snapshot(), before);
});
