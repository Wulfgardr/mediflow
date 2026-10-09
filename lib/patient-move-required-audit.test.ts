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
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-move-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const authFile = join(dataDir, 'auth.cjs');
writeFileSync(authFile, `exports.requireSession=async()=>({id:'synthetic-session',userId:'synthetic-move-user',role:'admin'});
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
const { POST } = load('../app/api/patients/move/route.ts') as typeof import('../app/api/patients/move/route.ts');
const sql = new Database(join(dataDir, 'medical.db'));
let sequence = 0;
let ids: string[];
let requestId: string;
function reset() {
    sql.exec('DROP TRIGGER IF EXISTS move_audit_fault');
    dbServer.delete(patientsToAmbulatories).run();
    dbServer.delete(patients).run();
    dbServer.delete(ambulatories).run();
    sequence += 1;
    ids = [`move-${sequence}-a`, `move-${sequence}-b`];
    requestId = `synthetic-move-${sequence}`;
    dbServer.insert(ambulatories).values(['source', 'target', 'unrelated'].map(id => ({ id, name: `${id} synthetic` }))).run();
    dbServer.insert(patients).values(ids.map(id => ({ id, firstName: 'Ada', lastName: 'Synthetic', taxCode: id,
        ambulatoryId: 'source', version: 1 }))).run();
    dbServer.insert(patientsToAmbulatories).values(ids.flatMap(patientId =>
        ['source', 'unrelated'].map(ambulatoryId => ({ patientId, ambulatoryId })))).run();
}
function snapshot() {
    const reopened = new Database(join(dataDir, 'medical.db'), { readonly: true });
    try {
        return {
            patients: reopened.prepare('SELECT * FROM patients ORDER BY id').all() as Array<Record<string, unknown>>,
            memberships: reopened.prepare('SELECT * FROM patients_to_ambulatories ORDER BY patient_id, ambulatory_id').all() as Array<Record<string, unknown>>,
            events: reopened.prepare('SELECT * FROM audit_events ORDER BY rowid').all() as Array<Record<string, unknown>>,
        };
    } finally { reopened.close(); }
}
function payload(values: Record<string, unknown> = {}) {
    return { patientIds: ids, patientVersions: Object.fromEntries(ids.map(id => [id, 1])),
        targetAmbulatoryId: 'target', sourceAmbulatoryId: 'source', ...values };
}
function request(body = JSON.stringify(payload())) {
    return POST(new Request('http://127.0.0.1/api/patients/move', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': requestId,
            'x-mediflow-source-surface': 'job', 'x-actor-ref': 'spoofed' }, body,
    }));
}
test.after(() => {
    sql.close(); dbServer.$client.close(); hooks.deregister();
    rmSync(dataDir, { recursive: true, force: true });
});
for (const fault of ['FAIL', 'IGNORE'] as const) {
    test(`move: second audit ${fault} rolls back primary, versions, memberships and first event`, async () => {
        reset();
        const before = snapshot();
        sql.exec(`CREATE TRIGGER move_audit_fault BEFORE INSERT ON audit_events
            WHEN NEW.subject_ref = '${ids[1]}' BEGIN SELECT RAISE(${fault}${fault === 'FAIL' ? ", 'synthetic second audit fault'" : ''}); END`);
        const response = await request();
        assert.deepEqual(snapshot(), before, 'no partial effects after reopening');
        assert.equal(response.status, 500);
    });
}
for (const removeSource of [true, false]) {
    test(`move: two patients commit with host audit; remove source=${removeSource}; stale replay has no effects`, async () => {
        reset();
        const before = snapshot();
        const body = JSON.stringify(payload({ sourceAmbulatoryId: removeSource ? 'source' : undefined,
            actorRef: 'spoofed', notes: 'CLINICAL_SENTINEL' }));
        const response = await request(body);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { success: true, count: 2, targetAmbulatoryId: 'target',
            sourceAmbulatoryId: removeSource ? 'source' : null, patientVersions: Object.fromEntries(ids.map(id => [id, 2])) });
        const after = snapshot();
        assert.deepEqual(after.patients.map(p => [p.id, p.ambulatory_id, p.version]), ids.map(id => [id, 'target', 2]));
        for (const id of ids) assert.deepEqual(after.memberships.filter(m => m.patient_id === id).map(m => m.ambulatory_id),
            removeSource ? ['target', 'unrelated'] : ['source', 'target', 'unrelated']);
        const events = after.events.slice(before.events.length);
        assert.equal(events.length, 2);
        assert.deepEqual(events.map(e => e.subject_ref).sort(), ids);
        for (const event of events) {
            assert.equal(event.event_type, 'patient.updated');
            assert.equal(event.outcome, 'success');
            assert.equal(event.subject_type, 'patient');
            assert.equal(event.actor_type, 'user');
            assert.equal(event.actor_ref, 'synthetic-move-user');
            assert.equal(event.source_surface, 'web');
            assert.equal(event.request_id, requestId);
            assert.deepEqual(JSON.parse(event.redacted_metadata as string), {
                changedFields: ['ambulatoryId', 'ambulatoryMemberships'], resourceVersion: 2,
                flags: ['membership:moved', 'auth:session'],
            });
        }
        assert.equal((await request(body)).status, 409);
        assert.deepEqual(snapshot(), after);
    });
}
test('move: one stale version prevents the entire batch', async () => {
    reset();
    const before = snapshot();
    const response = await request(JSON.stringify(payload({ patientVersions: { [ids[0]]: 1, [ids[1]]: 2 } })));
    assert.equal(response.status, 409);
    assert.deepEqual(snapshot(), before);
});
test('move: missing target and missing/deleted patients fail before effects', async () => {
    reset();
    for (const body of [payload({ targetAmbulatoryId: 'missing' }), payload({ patientIds: [ids[0], 'missing'],
        patientVersions: { [ids[0]]: 1, missing: 1 } })]) {
        const before = snapshot();
        assert.equal((await request(JSON.stringify(body))).status, 404);
        assert.deepEqual(snapshot(), before);
    }
    sql.prepare('UPDATE patients SET deleted_at=1 WHERE id=?').run(ids[1]);
    const before = snapshot();
    assert.equal((await request()).status, 404);
    assert.deepEqual(snapshot(), before);
});
test('move: malformed JSON, invalid versions and oversized input fail before effects', async () => {
    reset();
    const before = snapshot();
    for (const body of ['{', 'null', '[]', JSON.stringify(payload({ patientVersions: {} })),
        JSON.stringify(payload({ patientVersions: { [ids[0]]: 1, [ids[1]]: '1' } }))]) {
        assert.equal((await request(body)).status, 400);
        assert.deepEqual(snapshot(), before);
    }
    assert.equal((await request(' '.repeat(262_145))).status, 413);
    assert.deepEqual(snapshot(), before);
});
