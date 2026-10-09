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
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-membership-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const authFile = join(dataDir, 'auth.cjs');
writeFileSync(authFile, `exports.requireSession=async()=>({id:'synthetic-session',userId:'synthetic-member-user',role:'admin'});
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
const routes = {
    assign: load('../app/api/patients/assign/route.ts') as typeof import('../app/api/patients/assign/route.ts'),
    unassign: load('../app/api/patients/unassign/route.ts') as typeof import('../app/api/patients/unassign/route.ts'),
};
const sql = new Database(join(dataDir, 'medical.db'));
type Operation = keyof typeof routes;
let sequence = 0;
let ids: string[];
let requestId: string;
function reset(operation: Operation) {
    sql.exec('DROP TRIGGER IF EXISTS membership_audit_fault');
    dbServer.delete(patientsToAmbulatories).run();
    dbServer.delete(patients).run();
    dbServer.delete(ambulatories).run();
    sequence += 1;
    ids = [`member-${sequence}-a`, `member-${sequence}-b`];
    requestId = `synthetic-membership-${sequence}`;
    dbServer.insert(ambulatories).values([
        { id: 'primary', name: 'Primary synthetic' }, { id: 'target', name: 'Target synthetic' },
    ]).run();
    dbServer.insert(patients).values(ids.map(id => ({ id, firstName: 'Ada', lastName: 'Synthetic', taxCode: id,
        ambulatoryId: 'primary', version: 1 }))).run();
    dbServer.insert(patientsToAmbulatories).values(ids.map(patientId => ({ patientId, ambulatoryId: 'primary' }))).run();
    if (operation === 'unassign') dbServer.insert(patientsToAmbulatories)
        .values(ids.map(patientId => ({ patientId, ambulatoryId: 'target' }))).run();
}
function snapshot() {
    const reopened = new Database(join(dataDir, 'medical.db'), { readonly: true });
    try {
        return {
            patients: reopened.prepare('SELECT * FROM patients ORDER BY id').all(),
            memberships: reopened.prepare('SELECT * FROM patients_to_ambulatories ORDER BY patient_id, ambulatory_id').all(),
            events: reopened.prepare('SELECT * FROM audit_events ORDER BY rowid').all() as Array<Record<string, unknown>>,
        };
    } finally { reopened.close(); }
}
function payload(operation: Operation, values: Record<string, unknown> = {}) {
    return { patientIds: ids, [operation === 'assign' ? 'targetAmbulatoryId' : 'ambulatoryId']: 'target', ...values };
}
function request(operation: Operation, body = JSON.stringify(payload(operation))) {
    return routes[operation].POST(new Request(`http://127.0.0.1/api/patients/${operation}`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': requestId,
            'x-mediflow-source-surface': 'job', 'x-actor-ref': 'spoofed' }, body,
    }));
}
test.after(() => {
    sql.close(); dbServer.$client.close(); hooks.deregister();
    rmSync(dataDir, { recursive: true, force: true });
});
for (const operation of ['assign', 'unassign'] as const) {
    for (const fault of ['FAIL', 'IGNORE'] as const) {
        test(`${operation}: second audit ${fault} rolls back the whole batch`, async () => {
            reset(operation);
            const before = snapshot();
            sql.exec(`CREATE TRIGGER membership_audit_fault BEFORE INSERT ON audit_events
                WHEN NEW.subject_ref = '${ids[1]}' BEGIN SELECT RAISE(${fault}${fault === 'FAIL' ? ", 'synthetic second audit fault'" : ''}); END`);
            const response = await request(operation);
            const after = snapshot();
            assert.deepEqual(after, before, 'no partial membership change or orphan first audit after reopening');
            assert.equal(response.status, 500);
        });
    }
    test(`${operation}: actual changes audit host identity; mixed no-op and replay preserve primary`, async () => {
        reset(operation);
        // First patient already has the requested state; only the second changes.
        if (operation === 'assign') sql.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES (?, ?)').run(ids[0], 'target');
        else sql.prepare('DELETE FROM patients_to_ambulatories WHERE patient_id=? AND ambulatory_id=?').run(ids[0], 'target');
        const before = snapshot();
        const response = await request(operation, JSON.stringify(payload(operation, { patientIds: [...ids, ids[1]],
            actorRef: 'spoofed', notes: 'CLINICAL_SENTINEL' })));
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { success: true, count: 2, ...(operation === 'unassign' ? { ambulatoryId: 'target' } : {}) });
        const after = snapshot();
        assert.deepEqual(after.patients, before.patients, 'primary and version unchanged');
        const events = after.events.slice(before.events.length);
        assert.equal(events.length, 1);
        const event = events[0];
        assert.equal(event.event_type, 'patient.updated');
        assert.equal(event.outcome, 'success');
        assert.equal(event.subject_type, 'patient');
        assert.equal(event.subject_ref, ids[1]);
        assert.equal(event.actor_type, 'user');
        assert.equal(event.actor_ref, 'synthetic-member-user');
        assert.equal(event.source_surface, 'web');
        assert.equal(event.request_id, requestId);
        assert.deepEqual(JSON.parse(event.redacted_metadata as string), {
            changedFields: ['ambulatoryMemberships'], flags: [`membership:${operation}ed`, 'auth:session'],
        });
        assert.equal((sql.prepare('SELECT count(*) AS n FROM patients_to_ambulatories WHERE ambulatory_id=?').get('target') as { n: number }).n,
            operation === 'assign' ? 2 : 0);
        assert.equal((await request(operation)).status, 200);
        assert.deepEqual(snapshot(), after, 'replay has no mutation or false audit');
    });
    test(`${operation}: missing target or mixed missing/deleted patient rejects without effects`, async () => {
        reset(operation);
        for (const body of [
            payload(operation, { [operation === 'assign' ? 'targetAmbulatoryId' : 'ambulatoryId']: 'missing' }),
            payload(operation, { patientIds: [ids[0], 'missing'] }),
        ]) {
            const before = snapshot();
            assert.equal((await request(operation, JSON.stringify(body))).status, 404);
            assert.deepEqual(snapshot(), before);
        }
        sql.prepare('UPDATE patients SET deleted_at=1 WHERE id=?').run(ids[1]);
        const before = snapshot();
        assert.equal((await request(operation)).status, 404);
        assert.deepEqual(snapshot(), before);
    });
}
test('membership input: malformed/object/schema and byte-limit errors precede mutations', async () => {
    reset('assign');
    const before = snapshot();
    for (const body of ['{', 'null', '[]', JSON.stringify(payload('assign', { patientIds: [1] })),
        JSON.stringify(payload('assign', { targetAmbulatoryId: '' }))]) {
        assert.equal((await request('assign', body)).status, 400);
        assert.deepEqual(snapshot(), before);
    }
    for (const operation of ['assign', 'unassign'] as const) {
        assert.equal((await request(operation, ' '.repeat(262_145))).status, 413);
        assert.deepEqual(snapshot(), before);
    }
});
