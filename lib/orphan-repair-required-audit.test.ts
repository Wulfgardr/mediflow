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
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-orphan-repair-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const authFile = join(dataDir, 'auth.cjs');
const admission = { role: 'admin' as string | null };
const stateKey = Symbol.for(dataDir);
(globalThis as unknown as Record<symbol, typeof admission>)[stateKey] = admission;
writeFileSync(authFile, `exports.requireSession=async()=>{const role=globalThis[Symbol.for(${JSON.stringify(dataDir)})].role;return role?{id:'synthetic-session',userId:'synthetic-repair-user',role,authChannel:'web'}:null;};
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
const { ambulatories, patients, patientsToAmbulatories, entries } = load('./schema.ts') as typeof import('./schema.ts');
const { POST } = load('../app/api/system/fix-orphans/route.ts') as typeof import('../app/api/system/fix-orphans/route.ts');
const { countOrphanedClinicalRows, totalPatientCascadeRows } = load('./patient-cascade.ts') as typeof import('./patient-cascade.ts');
const { captureAttachmentExtractionLocatorGeneration, isCurrentAttachmentExtractionLocatorGeneration } =
    load('./domain/documents/attachment-extraction-locator-revocation.ts') as typeof import('./domain/documents/attachment-extraction-locator-revocation.ts');
const sql = new Database(join(dataDir, 'medical.db'));
let sequence = 0;
let ids: string[];
let requestId: string;
function reset() {
    sql.exec('DROP TRIGGER IF EXISTS repair_audit_fault; DROP TRIGGER IF EXISTS repair_purge_fault');
    dbServer.delete(entries).run();
    dbServer.delete(patientsToAmbulatories).run();
    dbServer.delete(patients).run();
    dbServer.delete(ambulatories).run();
    sequence += 1;
    ids = [`repair-${sequence}-a`, `repair-${sequence}-b`];
    requestId = `synthetic-repair-${sequence}`;
    dbServer.insert(patients).values(ids.map((id, index) => ({ id, firstName: 'Ada', lastName: 'Synthetic', taxCode: id,
        version: 7 + index, deletedAt: index ? new Date('2025-01-01') : null }))).run();
    // Historical orphan: create only synthetic legacy data, on this fixture connection.
    sql.pragma('foreign_keys = OFF');
    sql.prepare('INSERT INTO entries (id, patient_id, type, date, content) VALUES (?, ?, ?, ?, ?)')
        .run('orphan-entry', 'missing-patient', 'note', 1, 'ENC:synthetic:entry');
    sql.pragma('foreign_keys = ON');
}
function snapshot() {
    const reopened = new Database(join(dataDir, 'medical.db'), { readonly: true });
    try { return {
        ambulatories: reopened.prepare('SELECT * FROM ambulatories ORDER BY id').all() as Array<Record<string, unknown>>,
        patients: reopened.prepare('SELECT * FROM patients ORDER BY id').all(),
        entries: reopened.prepare('SELECT * FROM entries ORDER BY id').all(),
        memberships: reopened.prepare('SELECT * FROM patients_to_ambulatories ORDER BY patient_id, ambulatory_id').all() as Array<Record<string, unknown>>,
        events: reopened.prepare('SELECT * FROM audit_events ORDER BY rowid').all() as Array<Record<string, unknown>>,
    }; } finally { reopened.close(); }
}
function request(body?: string) {
    return POST(new Request('http://127.0.0.1/api/system/fix-orphans', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': requestId,
            'x-mediflow-source-surface': 'job', 'x-actor-ref': 'spoofed' }, ...(body === undefined ? {} : { body }),
    }));
}
const purgeBody = JSON.stringify({ purgeOrphanedClinicalRows: true, actorRef: 'spoofed', notes: 'CLINICAL_SENTINEL' });
test.after(() => {
    sql.close(); dbServer.$client.close(); hooks.deregister();
    delete (globalThis as unknown as Record<symbol, typeof admission>)[stateKey];
    rmSync(dataDir, { recursive: true, force: true });
});
for (const fault of ['FAIL', 'IGNORE'] as const) {
    test(`repair: last purge audit ${fault} rolls back default, both links, purge and previous events`, async () => {
        reset();
        const before = snapshot();
        const locatorGeneration = captureAttachmentExtractionLocatorGeneration();
        sql.exec(`CREATE TRIGGER repair_audit_fault BEFORE INSERT ON audit_events
            WHEN NEW.event_type='patient.purged' BEGIN SELECT RAISE(${fault}${fault === 'FAIL' ? ", 'synthetic final audit fault'" : ''}); END`);
        const response = await request(purgeBody);
        assert.deepEqual(snapshot(), before, 'whole repair rolled back after reopening');
        assert.equal(response.status, 500);
        assert.equal(isCurrentAttachmentExtractionLocatorGeneration(locatorGeneration), false);
    });
}
test('repair: purge failure rolls back earlier default, links and events', async () => {
    reset();
    const before = snapshot();
    sql.exec("CREATE TRIGGER repair_purge_fault BEFORE DELETE ON entries BEGIN SELECT RAISE(FAIL, 'synthetic purge fault'); END");
    assert.equal((await request(purgeBody)).status, 500);
    assert.deepEqual(snapshot(), before);
});
test('repair: default, two relinks and explicit purge commit with minimal host events; replay is inert', async () => {
    reset();
    const before = snapshot();
    const expectedCounts = countOrphanedClinicalRows(dbServer);
    const response = await request(purgeBody);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.fixed, 2);
    assert.deepEqual(result.purgedOrphanChildRows, expectedCounts);
    assert.equal(result.message, "Created/Used Default Ambulatory and linked 2 orphan patients to 'Sede Principale'. Refresh the page.");
    const after = snapshot();
    assert.deepEqual(after.patients, before.patients, 'includes tombstone; primary and versions preserved');
    assert.equal(after.ambulatories.length, 1);
    assert.equal(after.ambulatories[0].is_default, 1);
    assert.equal(after.ambulatories[0].name, 'Sede Principale');
    assert.deepEqual(after.memberships.map(m => [m.patient_id, m.ambulatory_id]), ids.map(id => [id, after.ambulatories[0].id]));
    assert.equal(after.entries.length, 0);
    const events = after.events.slice(before.events.length);
    assert.deepEqual(events.map(e => e.event_type), ['ambulatory.created', 'patient.updated', 'patient.updated', 'patient.purged']);
    for (const event of events) {
        assert.equal(event.actor_ref, 'synthetic-repair-user');
        assert.equal(event.actor_type, 'user');
        assert.equal(event.source_surface, 'web');
        assert.equal(event.request_id, requestId);
        assert.equal(event.outcome, 'success');
        assert.equal((event.redacted_metadata as string).includes('CLINICAL_SENTINEL'), false);
    }
    assert.equal(events[0].subject_ref, after.ambulatories[0].id);
    assert.deepEqual(JSON.parse(events[0].redacted_metadata as string), { resourceVersion: 1,
        flags: ['fix-orphans:default-created', 'auth:session'] });
    for (const event of events.slice(1, 3)) {
        assert(ids.includes(event.subject_ref as string));
        assert.deepEqual(JSON.parse(event.redacted_metadata as string), {
            changedFields: ['ambulatoryMemberships'], flags: ['membership:relinked', 'auth:session'],
        });
    }
    assert.equal(events[3].subject_ref, null);
    assert.deepEqual(JSON.parse(events[3].redacted_metadata as string), {
        reasonCode: 'fix-orphans', counts: totalPatientCascadeRows(expectedCounts),
        flags: [...Object.entries(expectedCounts).map(([table, count]) => `purged:${table}:${count}`), 'auth:session'],
    });
    const locatorGeneration = captureAttachmentExtractionLocatorGeneration();
    assert.equal((await request(purgeBody)).status, 200);
    assert.deepEqual(snapshot(), after);
    assert.equal(isCurrentAttachmentExtractionLocatorGeneration(locatorGeneration), true);
});
test('repair: absent body and false purge preserve orphan children; default or first target reused', async () => {
    for (const useDefault of [false, true]) {
        reset();
        dbServer.insert(ambulatories).values([{ id: 'first', name: 'First synthetic' },
            { id: 'preferred', name: 'Preferred synthetic', isDefault: useDefault }]).run();
        const response = await request(useDefault ? JSON.stringify({ purgeOrphanedClinicalRows: false }) : undefined);
        assert.equal(response.status, 200);
        const after = snapshot();
        assert.equal(after.ambulatories.length, 2);
        assert.equal(after.entries.length, 1);
        assert(after.memberships.every(m => m.ambulatory_id === (useDefault ? 'preferred' : 'first')));
        const replay = await request();
        assert.deepEqual(await replay.json(), { success: true, fixed: 0, message: 'No orphans found. All patients are linked.' });
        assert.deepEqual(snapshot(), after);
    }
});
test('repair: auth, malformed body, invalid flag and excessive bytes fail before all effects', async () => {
    reset();
    const before = snapshot();
    const locatorGeneration = captureAttachmentExtractionLocatorGeneration();
    try {
        admission.role = null;
        assert.equal((await request('null')).status, 401);
        admission.role = 'doctor';
        assert.equal((await request(purgeBody)).status, 403);
    } finally { admission.role = 'admin'; }
    for (const body of ['{', 'null', '[]', JSON.stringify({ purgeOrphanedClinicalRows: 'true' }),
        JSON.stringify({ purgeOrphanedClinicalRows: null })]) {
        assert.equal((await request(body)).status, 400);
        assert.deepEqual(snapshot(), before);
    }
    assert.equal((await request(' '.repeat(65_537))).status, 413);
    assert.deepEqual(snapshot(), before);
    assert.equal(isCurrentAttachmentExtractionLocatorGeneration(locatorGeneration), true);
});
