// Real SISS handlers, synthetic SQLite and an authenticated session seam.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import Database from 'better-sqlite3';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-c05-siss-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const previousToken = process.env.MEDIFLOW_LOCAL_API_TOKEN;
process.env.MEDIFLOW_LOCAL_API_TOKEN = 'c05-siss-synthetic-token';
const state = { session: { id: 'synthetic-web-session', userId: 'synthetic-web-admin',
    role: 'admin', authChannel: 'web' } as Record<string, unknown> | null };
const stateKey = Symbol.for(`c05-siss-auth-${dataDir}`);
(globalThis as unknown as Record<symbol, typeof state>)[stateKey] = state;
const authPath = join(dataDir, 'auth.cjs');
writeFileSync(authPath, `const state=globalThis[Symbol.for(${JSON.stringify(`c05-siss-auth-${dataDir}`)})];
exports.requireSession=async()=>state.session;
exports.unauthorizedResponse=()=>Response.json({error:'Unauthorized'},{status:401});
exports.forbiddenResponse=()=>Response.json({error:'Forbidden'},{status:403});`, { mode: 0o600 });
const { registerHooks } = load('node:module') as {
    registerHooks: (hooks: { resolve: (specifier: string, context: unknown,
        next: (specifier: string, context: unknown) => { url: string }) => { url: string; shortCircuit?: boolean } }) => { deregister: () => void };
};
const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@/lib/security/server-auth') return { url: pathToFileURL(authPath).href, shortCircuit: true };
    return next(specifier, context);
} });
const { dbServer } = load('./db-server.ts') as typeof import('./db-server.ts');
const { patients, sissHandoffEvents } = load('./schema.ts') as typeof import('./schema.ts');
const createRoute = load('../app/api/siss-handoffs/route.ts') as typeof import('../app/api/siss-handoffs/route.ts');
const itemRoute = load('../app/api/siss-handoffs/[id]/route.ts') as typeof import('../app/api/siss-handoffs/[id]/route.ts');
const sql = new Database(join(dataDir, 'medical.db'));

test.after(() => {
    sql.close(); dbServer.$client.close(); hooks.deregister();
    if (previousToken === undefined) delete process.env.MEDIFLOW_LOCAL_API_TOKEN;
    else process.env.MEDIFLOW_LOCAL_API_TOKEN = previousToken;
    delete (globalThis as unknown as Record<symbol, typeof state>)[stateKey];
    rmSync(dataDir, { recursive: true, force: true });
});

function reset() {
    sql.exec('DROP TRIGGER IF EXISTS siss_audit_fault; DELETE FROM siss_handoff_events; DELETE FROM patients;');
    dbServer.insert(patients).values({ id: 'synthetic-patient', firstName: 'Synthetic', lastName: 'Patient', taxCode: 'SYNTHETICSISS' }).run();
}
function seed() {
    dbServer.insert(sissHandoffEvents).values({ id: 'synthetic-handoff', patientId: 'synthetic-patient',
        action: 'menu.open', moduleLabel: 'Menu SISS', startedAt: new Date('2026-01-01T00:00:00Z'),
        outcome: 'started', notes: 'ENC:synthetic:notes', reason: 'ENC:synthetic:reason' }).run();
}
function snapshot() {
    const fresh = new Database(join(dataDir, 'medical.db'), { readonly: true });
    try {
        return { handoffs: fresh.prepare('SELECT * FROM siss_handoff_events ORDER BY id').all(),
            audit: fresh.prepare('SELECT * FROM audit_events ORDER BY rowid').all() };
    } finally { fresh.close(); }
}
function invoke(method: 'POST' | 'PUT' | 'DELETE', raw?: string, id = 'synthetic-handoff') {
    const request = new Request('http://localhost/api/siss-handoffs', { method,
        headers: { 'content-type': 'application/json', 'authorization': 'Bearer c05-siss-synthetic-token',
            'x-request-id': 'synthetic-siss-request' }, ...(raw === undefined ? {} : { body: raw }) });
    return method === 'POST' ? createRoute.POST(request) : itemRoute[method](request, { params: Promise.resolve({ id }) });
}
const precondition = { patientId: 'synthetic-patient', version: 1 };
const writeBody = (changes = {}) => JSON.stringify({ ...precondition, ...changes });
const createBody = JSON.stringify({ id: 'synthetic-handoff', patientId: 'synthetic-patient', action: 'menu.open', notes: 'ENC:synthetic:notes' });

for (const method of ['POST', 'PUT', 'DELETE'] as const) {
    test(`${method}: required audit failure rolls back real SQLite mutation`, async () => {
        reset(); if (method !== 'POST') seed();
        const before = snapshot();
        sql.exec("CREATE TRIGGER siss_audit_fault BEFORE INSERT ON audit_events BEGIN SELECT RAISE(FAIL, 'synthetic audit failure'); END");
        try {
            const response = await invoke(method, method === 'POST' ? createBody : writeBody({ notes: 'ENC:synthetic:updated' }));
            assert.equal(response.status, 500);
            assert.deepEqual(snapshot(), before);
        } finally { sql.exec('DROP TRIGGER siss_audit_fault'); }
    });
    test(`${method}: mutation commits with one session-attributed audit`, async () => {
        reset(); if (method !== 'POST') seed();
        const auditCount = snapshot().audit.length;
        const response = await invoke(method, method === 'POST' ? createBody : writeBody({ notes: null, completedAt: '' }));
        assert.equal(response.status, method === 'POST' ? 201 : 200);
        assert.deepEqual(await response.json(), method === 'POST' ? { id: 'synthetic-handoff', version: 1 } : method === 'PUT' ? { success: true, version: 2 } : { success: true });
        const after = snapshot();
        assert.equal(after.handoffs.length, method === 'DELETE' ? 0 : 1);
        if (method === 'PUT') {
            const row = after.handoffs[0] as Record<string, unknown>;
            assert.equal(row.notes, null); assert.equal(row.completed_at, null);
            assert.equal(row.reason, 'ENC:synthetic:reason');
        }
        assert.equal(after.audit.length, auditCount + 1);
        const audit = after.audit.at(-1) as Record<string, unknown>;
        assert.equal(audit.event_type, `siss.handoff.${{ POST: 'created', PUT: 'updated', DELETE: 'deleted' }[method]}`);
        assert.equal(audit.actor_ref, 'synthetic-web-admin');
        assert.equal(audit.actor_type, 'user');
        assert.equal(audit.subject_ref, 'synthetic-handoff');
        assert.equal(audit.outcome, 'success');
        assert.ok(JSON.parse(audit.redacted_metadata as string).flags.includes('auth:session'));
        assert.equal(audit.source_surface, 'web');
        assert.equal(audit.request_id, 'synthetic-siss-request');
    });
}

test('POST duplicate ID and absent/deleted patients have no effects', async () => {
    reset(); seed();
    const before = snapshot();
    assert.equal((await invoke('POST', createBody)).status, 409);
    assert.deepEqual(snapshot(), before);
    for (const patientId of ['missing-patient', 'synthetic-patient']) {
        sql.prepare('UPDATE patients SET deleted_at=1 WHERE id=?').run('synthetic-patient');
        const response = await invoke('POST', JSON.stringify({ id: 'new-handoff', patientId, action: 'menu.open' }));
        assert.equal(response.status, 404);
        assert.deepEqual(snapshot(), before);
    }
});

test('PUT/DELETE missing handoff have no effects', async () => {
    reset(); const before = snapshot();
    for (const method of ['PUT', 'DELETE'] as const) {
        assert.equal((await invoke(method, writeBody())).status, 404);
        assert.deepEqual(snapshot(), before);
    }
});

for (const method of ['POST', 'PUT', 'DELETE'] as const) {
    test(`${method}: malformed, non-object and oversized JSON rejected without effects`, async () => {
        reset(); seed(); const before = snapshot();
        for (const raw of ['null', '[]', '{', JSON.stringify({ notes: 'x'.repeat(262144) })]) {
            const response = await invoke(method, raw);
            assert.equal(response.status, raw.length > 262144 ? 413 : 400);
            assert.deepEqual(snapshot(), before);
        }
    });
}


test('observed patient and version fence writes, stale replay and delete replay without effects', async () => {
    reset(); seed();
    for (const method of ['PUT', 'DELETE'] as const) {
        for (const [changes, status] of [[{ patientId: 'other-patient' }, 404], [{ version: 2 }, 409]] as const) {
            const before = snapshot();
            assert.equal((await invoke(method, writeBody(changes))).status, status);
            assert.deepEqual(snapshot(), before);
        }
    }
    assert.equal((await invoke('PUT', writeBody({ notes: 'updated' }))).status, 200);
    const afterUpdate = snapshot();
    assert.equal((await invoke('PUT', writeBody({ notes: 'replay' }))).status, 409);
    assert.equal((await invoke('DELETE', writeBody())).status, 409);
    assert.deepEqual(snapshot(), afterUpdate);
    const listed = await createRoute.GET(new Request('http://localhost/api/siss-handoffs?patientId=synthetic-patient'));
    assert.equal((await listed.json())[0].version, 2);
    assert.equal((await invoke('DELETE', writeBody({ version: 2 }))).status, 200);
    const afterDelete = snapshot();
    assert.equal((await invoke('DELETE', writeBody({ version: 2 }))).status, 404);
    assert.deepEqual(snapshot(), afterDelete);
});

test('shared precondition parser requires a patient and positive safe integer without coercion', () => {
    const { sissHandoffWritePreconditionSchema: schema } = load('./api-schemas/siss-handoffs.ts');
    for (const version of [undefined, null, 0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
        assert.equal(schema.safeParse({ patientId: 'synthetic-patient', version }).success, false);
    }
    for (const patientId of [undefined, null, '', ' ']) {
        assert.equal(schema.safeParse({ patientId, version: 1 }).success, false);
    }
    assert.equal(schema.safeParse(precondition).success, true);
});

test('route rejects missing preconditions; authentication precedes malformed JSON', async () => {
    reset(); seed(); const before = snapshot();
    assert.equal((await invoke('PUT', '{}')).status, 400);
    assert.equal((await invoke('DELETE')).status, 400);
    const session = state.session;
    state.session = null;
    try {
        for (const method of ['POST', 'PUT', 'DELETE'] as const) assert.equal((await invoke(method, '{')).status, 401);
    } finally { state.session = session; }
    assert.deepEqual(snapshot(), before);
});

test('host owns create version and preserves existing update policy for deleted parents', async () => {
    reset();
    assert.equal((await invoke('POST', JSON.stringify({ ...JSON.parse(createBody), version: 42 }))).status, 201);
    assert.equal((snapshot().handoffs[0] as { version: number }).version, 1);
    sql.prepare('UPDATE patients SET deleted_at=1 WHERE id=?').run('synthetic-patient');
    assert.equal((await invoke('PUT', writeBody({ notes: null }))).status, 200);
});

test('fresh and legacy bootstraps converge on version 1 without losing rows or values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mediflow-siss-migration-'));
    const bootstrap = () => spawnSync(process.execPath, ['scripts/run-strip-types.mjs', 'scripts/db-server-bootstrap-worker.mjs'], {
        cwd: process.cwd(), env: { ...process.env, MEDIFLOW_DATA_DIR: dir }, encoding: 'utf8',
    });
    try {
        let result = bootstrap(); assert.equal(result.status, 0, result.stderr);
        const db = new Database(join(dir, 'medical.db'));
        try {
            db.prepare("INSERT INTO patients (id, first_name, last_name, tax_code) VALUES ('synthetic-parent', 'A', 'Synthetic', 'SYNTHETIC')").run();
            db.prepare("INSERT INTO siss_handoff_events (id, patient_id, action, module_label, started_at, notes) VALUES ('synthetic-row', 'synthetic-parent', 'menu.open', 'Menu', 123, 'preserved')").run();
            const fresh = db.prepare('SELECT * FROM siss_handoff_events').get() as Record<string, unknown>;
            assert.equal(fresh.version, 1);
            db.exec('ALTER TABLE siss_handoff_events DROP COLUMN version');
            result = bootstrap(); assert.equal(result.status, 0, result.stderr);
            assert.deepEqual(db.prepare('SELECT * FROM siss_handoff_events').get(), fresh);
            result = bootstrap(); assert.equal(result.status, 0, result.stderr);
            assert.deepEqual(db.prepare('SELECT * FROM siss_handoff_events').get(), fresh);
        } finally { db.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('client captures the displayed precondition and never refreshes or retries it', async t => {
    const { db, captureSissHandoffWritePrecondition } = load('./db.ts') as typeof import('./db.ts');
    const calls: Array<{ method: string; body: unknown }> = [];
    t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
        calls.push({ method: options.method!, body: JSON.parse(options.body as string) });
        return Response.json({ error: 'Changed' }, { status: 409 });
    });
    await assert.rejects(db.sissHandoffs.update('synthetic-handoff', { outcome: 'completed' }));
    await assert.rejects(db.sissHandoffs.delete('synthetic-handoff'));
    assert.equal(calls.length, 0);
    const displayed = { id: 'synthetic-handoff', ...precondition };
    const sissPrecondition = captureSissHandoffWritePrecondition(displayed);
    displayed.version = 2;
    displayed.patientId = 'different-patient';
    await assert.rejects(db.sissHandoffs.update(displayed.id, { outcome: 'completed' }, { sissPrecondition }), /cambiato/);
    await assert.rejects(db.sissHandoffs.delete(displayed.id, { sissPrecondition, version: 2 }));
    assert.deepEqual(calls, [
        { method: 'PUT', body: { outcome: 'completed', ...precondition } },
        { method: 'DELETE', body: precondition },
    ]);
});
