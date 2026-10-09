// Real SISS handlers, synthetic SQLite and an authenticated session seam.
import assert from 'node:assert/strict';
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
const createBody = JSON.stringify({ id: 'synthetic-handoff', patientId: 'synthetic-patient', action: 'menu.open', notes: 'ENC:synthetic:notes' });

for (const method of ['POST', 'PUT', 'DELETE'] as const) {
    test(`${method}: required audit failure rolls back real SQLite mutation`, async () => {
        reset(); if (method !== 'POST') seed();
        const before = snapshot();
        sql.exec("CREATE TRIGGER siss_audit_fault BEFORE INSERT ON audit_events BEGIN SELECT RAISE(FAIL, 'synthetic audit failure'); END");
        try {
            const response = await invoke(method, method === 'POST' ? createBody : method === 'PUT' ? '{"notes":"ENC:synthetic:updated"}' : undefined);
            assert.equal(response.status, 500);
            assert.deepEqual(snapshot(), before);
        } finally { sql.exec('DROP TRIGGER siss_audit_fault'); }
    });
    test(`${method}: mutation commits with one session-attributed audit`, async () => {
        reset(); if (method !== 'POST') seed();
        const auditCount = snapshot().audit.length;
        const response = await invoke(method, method === 'POST' ? createBody : method === 'PUT' ? '{"notes":null,"completedAt":""}' : undefined);
        assert.equal(response.status, method === 'POST' ? 201 : 200);
        assert.deepEqual(await response.json(), method === 'POST' ? { id: 'synthetic-handoff' } : { success: true });
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
        assert.equal((await invoke(method, method === 'PUT' ? '{}' : undefined)).status, 404);
        assert.deepEqual(snapshot(), before);
    }
});

for (const method of ['POST', 'PUT'] as const) {
    test(`${method}: malformed, non-object and oversized JSON rejected without effects`, async () => {
        reset(); seed(); const before = snapshot();
        for (const raw of ['null', '[]', '{', JSON.stringify({ notes: 'x'.repeat(262144) })]) {
            const response = await invoke(method, raw);
            assert.equal(response.status, raw.length > 262144 ? 413 : 400);
            assert.deepEqual(snapshot(), before);
        }
    });
}
