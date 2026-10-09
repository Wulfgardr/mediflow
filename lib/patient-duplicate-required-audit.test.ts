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
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-duplicate-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const authFile = join(dataDir, 'auth.cjs');
writeFileSync(authFile, `exports.requireSession=async()=>({id:'synthetic-session',userId:'synthetic-duplicate-user',role:'admin'});
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
const { POST } = load('../app/api/patients/duplicate/route.ts') as typeof import('../app/api/patients/duplicate/route.ts');
const sql = new Database(join(dataDir, 'medical.db'));
let sequence = 0;
let ids: string[];
let requestId: string;
function reset() {
    sql.exec('DROP TRIGGER IF EXISTS duplicate_audit_fault');
    dbServer.delete(patientsToAmbulatories).run();
    dbServer.delete(patients).run();
    dbServer.delete(ambulatories).run();
    sequence += 1;
    ids = [`duplicate-${sequence}-a`, `duplicate-${sequence}-b`];
    requestId = `synthetic-duplicate-${sequence}`;
    dbServer.insert(ambulatories).values(['source', 'target'].map(id => ({ id, name: `${id} synthetic` }))).run();
    dbServer.insert(patients).values(ids.map((id, index) => ({ id, firstName: 'Ada', lastName: 'Synthetic', taxCode: id,
        ambulatoryId: 'source', version: 7 + index, notes: 'ENC:synthetic:sealed',
        isArchived: index === 1, createdAt: new Date('2020-01-01'), updatedAt: new Date('2020-01-02') }))).run();
    dbServer.insert(patientsToAmbulatories).values(ids.map(patientId => ({ patientId, ambulatoryId: 'source' }))).run();
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
    return { patientIds: ids, targetAmbulatoryId: 'target', ...values };
}
function request(body = JSON.stringify(payload())) {
    return POST(new Request('http://127.0.0.1/api/patients/duplicate', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': requestId,
            'x-mediflow-source-surface': 'job', 'x-actor-ref': 'spoofed' }, body,
    }));
}
test.after(() => {
    sql.close(); dbServer.$client.close(); hooks.deregister();
    rmSync(dataDir, { recursive: true, force: true });
});
for (const fault of ['FAIL', 'IGNORE'] as const) {
    test(`duplicate: second audit ${fault} rolls back all clones, links and first event`, async () => {
        reset();
        const before = snapshot();
        sql.exec(`CREATE TRIGGER duplicate_audit_fault BEFORE INSERT ON audit_events
            WHEN NEW.request_id = '${requestId}' AND EXISTS (SELECT 1 FROM audit_events WHERE request_id=NEW.request_id)
            BEGIN SELECT RAISE(${fault}${fault === 'FAIL' ? ", 'synthetic second audit fault'" : ''}); END`);
        const response = await request();
        assert.deepEqual(snapshot(), before, 'no partial effects after reopening');
        assert.equal(response.status, 500);
    });
}
test('duplicate: two new UUID clones retain original fields/version and get one host-attributed event each', async () => {
    reset();
    const before = snapshot();
    const response = await request(JSON.stringify(payload({ patientIds: [...ids, ids[0]], actorRef: 'spoofed', notes: 'CLINICAL_SENTINEL' })));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, count: 2 });
    const after = snapshot();
    assert.deepEqual(after.patients.filter(p => ids.includes(p.id as string)), before.patients);
    assert.deepEqual(after.memberships.filter(m => ids.includes(m.patient_id as string)), before.memberships);
    const clones = after.patients.filter(p => !ids.includes(p.id as string));
    assert.equal(clones.length, 2);
    const events = after.events.slice(before.events.length);
    assert.equal(events.length, 2);
    for (const clone of clones) {
        assert.match(clone.id as string, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        const original = before.patients.find(p => p.tax_code === clone.tax_code)!;
        assert(original);
        for (const key of Object.keys(original)) {
            if (!['id', 'created_at', 'updated_at', 'ambulatory_id'].includes(key)) assert.deepEqual(clone[key], original[key], key);
        }
        assert.equal(clone.ambulatory_id, 'target');
        assert.notEqual(clone.created_at, original.created_at);
        assert.notEqual(clone.updated_at, original.updated_at);
        assert.deepEqual(after.memberships.filter(m => m.patient_id === clone.id).map(m => m.ambulatory_id), ['target']);
        const cloneEvents = events.filter(e => e.subject_ref === clone.id);
        assert.equal(cloneEvents.length, 1);
        const event = cloneEvents[0];
        assert.equal(event.event_type, 'patient.created');
        assert.equal(event.outcome, 'success');
        assert.equal(event.subject_type, 'patient');
        assert.equal(event.actor_type, 'user');
        assert.equal(event.actor_ref, 'synthetic-duplicate-user');
        assert.equal(event.source_surface, 'web');
        assert.equal(event.request_id, requestId);
        assert.deepEqual(JSON.parse(event.redacted_metadata as string), {
            resourceVersion: original.version, flags: ['patient:duplicated', 'auth:session'],
        });
    }
});
test('duplicate: missing target and missing/deleted patients fail without clones or audit', async () => {
    reset();
    for (const body of [payload({ targetAmbulatoryId: 'missing' }), payload({ patientIds: [ids[0], 'missing'] })]) {
        const before = snapshot();
        assert.equal((await request(JSON.stringify(body))).status, 404);
        assert.deepEqual(snapshot(), before);
    }
    sql.prepare('UPDATE patients SET deleted_at=1 WHERE id=?').run(ids[1]);
    const before = snapshot();
    assert.equal((await request()).status, 404);
    assert.deepEqual(snapshot(), before);
});
test('duplicate: malformed envelope, invalid identifiers and oversized body fail before effects', async () => {
    reset();
    const before = snapshot();
    for (const body of ['{', 'null', '[]', JSON.stringify(payload({ patientIds: [42] })),
        JSON.stringify(payload({ targetAmbulatoryId: '' }))]) {
        assert.equal((await request(body)).status, 400);
        assert.deepEqual(snapshot(), before);
    }
    assert.equal((await request(' '.repeat(262_145))).status, 413);
    assert.deepEqual(snapshot(), before);
});
