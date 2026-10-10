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
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-purge-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const authFile = join(dataDir, 'auth.cjs');
writeFileSync(authFile, `exports.requireSession=async()=>({id:'synthetic-session',userId:'synthetic-purge-user',role:'admin',authChannel:'web'});
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
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server.ts');
openDbServer();
const { ambulatories, patients, patientsToAmbulatories, entries } = load('./schema.ts') as typeof import('./schema.ts');
const { GET, POST } = load('../app/api/system/purge-patient/route.ts') as typeof import('../app/api/system/purge-patient/route.ts');
const { countPatientCascadeRows, totalPatientCascadeRows } = load('./patient-cascade.ts') as typeof import('./patient-cascade.ts');
const { captureAttachmentExtractionLocatorGeneration, isCurrentAttachmentExtractionLocatorGeneration } =
    load('./domain/documents/attachment-extraction-locator-revocation.ts') as typeof import('./domain/documents/attachment-extraction-locator-revocation.ts');
const sql = new Database(join(dataDir, 'medical.db'));
let sequence = 0;
let patientId: string;
let requestId: string;
function reset(active = false) {
    sql.exec('DROP TRIGGER IF EXISTS purge_audit_fault');
    sql.exec('DROP TRIGGER IF EXISTS retired_id_ignore');
    dbServer.delete(entries).run();
    dbServer.delete(patientsToAmbulatories).run();
    dbServer.delete(patients).run();
    dbServer.delete(ambulatories).run();
    sequence += 1;
    patientId = `purge-${sequence}`;
    requestId = `synthetic-purge-${sequence}`;
    dbServer.insert(ambulatories).values({ id: 'synthetic-amb', name: 'Synthetic' }).run();
    dbServer.insert(patients).values({ id: patientId, firstName: 'Ada', lastName: 'Synthetic', taxCode: patientId,
        ambulatoryId: 'synthetic-amb', version: 7, notes: 'ENC:synthetic:sealed',
        deletedAt: active ? null : new Date('2025-01-01') }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId, ambulatoryId: 'synthetic-amb' }).run();
    dbServer.insert(entries).values({ id: `entry-${patientId}`, patientId, type: 'note',
        date: new Date('2025-01-01'), content: 'ENC:synthetic:entry' }).run();
}
function snapshot() {
    const reopened = new Database(join(dataDir, 'medical.db'), { readonly: true });
    try { return {
        patients: reopened.prepare('SELECT * FROM patients ORDER BY id').all(),
        retired: reopened.prepare('SELECT * FROM patient_retired_ids ORDER BY id').all() as Array<{ id: string }>,
        entries: reopened.prepare('SELECT * FROM entries ORDER BY id').all(),
        memberships: reopened.prepare('SELECT * FROM patients_to_ambulatories ORDER BY patient_id, ambulatory_id').all(),
        events: reopened.prepare('SELECT * FROM audit_events ORDER BY rowid').all() as Array<Record<string, unknown>>,
    }; } finally { reopened.close(); }
}
function request(body = JSON.stringify({ patientId, version: 7 })) {
    return POST(new Request('http://127.0.0.1/api/system/purge-patient', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': requestId,
            'x-mediflow-source-surface': 'job', 'x-actor-ref': 'spoofed' }, body,
    }));
}
test.after(() => {
    sql.close(); dbServer.$client.close(); hooks.deregister();
    rmSync(dataDir, { recursive: true, force: true });
});
for (const fault of ['FAIL', 'IGNORE'] as const) {
    test(`purge: audit ${fault} rolls back patient, clinical child and membership`, async () => {
        reset();
        const before = snapshot();
        const locatorGeneration = captureAttachmentExtractionLocatorGeneration();
        sql.exec(`CREATE TRIGGER purge_audit_fault BEFORE INSERT ON audit_events
            BEGIN SELECT RAISE(${fault}${fault === 'FAIL' ? ", 'synthetic audit fault'" : ''}); END`);
        const response = await request();
        assert.deepEqual(snapshot(), before, 'no erased rows or orphan event after reopening');
        assert.equal(response.status, 500);
        assert.equal(isCurrentAttachmentExtractionLocatorGeneration(locatorGeneration), false,
            'rollback restores data but conservatively does not reactivate extraction authority');
    });
}
test('purge: tombstone and children removed with one host-attributed count event; replay is inert', async () => {
    reset();
    const before = snapshot();
    const childRowCounts = countPatientCascadeRows(dbServer, patientId);
    assert.equal(childRowCounts.entries, 1);
    assert.equal(childRowCounts.patientsToAmbulatories, 1);
    const response = await request(JSON.stringify({ patientId, version: 7, actorRef: 'spoofed', notes: 'CLINICAL_SENTINEL' }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, patientId, childRowCounts,
        totalChildRows: totalPatientCascadeRows(childRowCounts) });
    const after = snapshot();
    assert.equal(after.patients.length, 0);
    assert.equal(after.retired.some(row => row.id === patientId), true);
    assert.equal(after.entries.length, 0);
    assert.equal(after.memberships.length, 0);
    const events = after.events.slice(before.events.length);
    assert.equal(events.length, 1);
    const event = events[0];
    assert.equal(event.event_type, 'patient.purged');
    assert.equal(event.outcome, 'success');
    assert.equal(event.subject_type, 'patient');
    assert.equal(event.subject_ref, patientId);
    assert.equal(event.actor_type, 'user');
    assert.equal(event.actor_ref, 'synthetic-purge-user');
    assert.equal(event.source_surface, 'web');
    assert.equal(event.request_id, requestId);
    assert.deepEqual(JSON.parse(event.redacted_metadata as string), {
        counts: totalPatientCascadeRows(childRowCounts),
        flags: [...Object.entries(childRowCounts).map(([table, count]) => `purged:${table}:${count}`), 'auth:session'],
    });
    const locatorGeneration = captureAttachmentExtractionLocatorGeneration();
    assert.equal((await request()).status, 404);
    assert.deepEqual(snapshot(), after);
    assert.equal(isCurrentAttachmentExtractionLocatorGeneration(locatorGeneration), true);
});
test('purge: active and missing patients preserve rows, events and locator authority', async () => {
    reset(true);
    const before = snapshot();
    const locatorGeneration = captureAttachmentExtractionLocatorGeneration();
    assert.equal((await request()).status, 409);
    assert.equal((await request(JSON.stringify({ patientId: 'missing', version: 7 }))).status, 404);
    assert.deepEqual(snapshot(), before);
    assert.equal(isCurrentAttachmentExtractionLocatorGeneration(locatorGeneration), true);
});
test('purge: malformed envelope, wrong identifier type and oversized body fail before effects', async () => {
    reset();
    const before = snapshot();
    const locatorGeneration = captureAttachmentExtractionLocatorGeneration();
    for (const body of ['{', 'null', '[]', JSON.stringify({ patientId: 42 }), JSON.stringify({ patientId: '' })]) {
        assert.equal((await request(body)).status, 400);
        assert.deepEqual(snapshot(), before);
    }
    assert.equal((await request(' '.repeat(65_537))).status, 413);
    assert.deepEqual(snapshot(), before);
    assert.equal(isCurrentAttachmentExtractionLocatorGeneration(locatorGeneration), true);
});


test('purge rejects an observed stale version before cascade or locator revocation', async () => {
    reset();
    const preview = await GET(new Request(`http://127.0.0.1/api/system/purge-patient?patientId=${patientId}`));
    assert.equal(preview.status, 200);
    const observed = await preview.json();
    assert.equal(observed.version, 7);
    sql.prepare('UPDATE patients SET version=8 WHERE id=?').run(patientId);
    const before = snapshot();
    const locatorGeneration = captureAttachmentExtractionLocatorGeneration();
    assert.equal((await request(JSON.stringify({ patientId: observed.patientId, version: observed.version }))).status, 409);
    assert.deepEqual(snapshot(), before);
    assert.equal(isCurrentAttachmentExtractionLocatorGeneration(locatorGeneration), true);
});


test('purge preview reports lifecycle/version/counts without effects and requires a positive safe version', async () => {
    reset();
    const before = snapshot();
    const locatorGeneration = captureAttachmentExtractionLocatorGeneration();
    const preview = await GET(new Request(`http://127.0.0.1/api/system/purge-patient?patientId=${patientId}`));
    assert.equal(preview.status, 200);
    const body = await preview.json();
    assert.equal(body.patientId, patientId);
    assert.equal(body.version, 7);
    assert.equal(body.deletedAt, '2025-01-01T00:00:00.000Z');
    assert.equal(body.patientState, 'soft-deleted');
    assert.deepEqual(body.childRowCounts, countPatientCascadeRows(dbServer, patientId));
    for (const version of [undefined, null, '7', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        assert.equal((await request(JSON.stringify({ patientId, version }))).status, 400);
        assert.deepEqual(snapshot(), before);
        assert.equal(isCurrentAttachmentExtractionLocatorGeneration(locatorGeneration), true);
    }
    assert.equal((await request(JSON.stringify({ patientId: body.patientId, version: body.version }))).status, 200);
    const after = snapshot();
    const afterLocator = captureAttachmentExtractionLocatorGeneration();
    assert.equal((await request(JSON.stringify({ patientId: body.patientId, version: body.version }))).status, 404);
    assert.deepEqual(snapshot(), after);
    assert.equal(isCurrentAttachmentExtractionLocatorGeneration(afterLocator), true);
});
test('purge permits MAX safe version without increment and preview describes active patients without authorizing purge', async () => {
    reset(true);
    const response = await GET(new Request(`http://127.0.0.1/api/system/purge-patient?patientId=${patientId}`));
    const body = await response.json();
    assert.equal(body.patientState, 'active');
    assert.equal(body.deletedAt, null);
    assert.equal((await request(JSON.stringify({ patientId, version: body.version }))).status, 409);
    reset();
    sql.prepare('UPDATE patients SET version=? WHERE id=?').run(Number.MAX_SAFE_INTEGER, patientId);
    assert.equal((await request(JSON.stringify({ patientId, version: Number.MAX_SAFE_INTEGER }))).status, 200);
});


test('purge denies ignored retirement but accepts an already retired historical identity', async () => {
    reset();
    const before = snapshot();
    sql.exec('CREATE TRIGGER retired_id_ignore BEFORE INSERT ON patient_retired_ids BEGIN SELECT RAISE(IGNORE); END');
    assert.equal((await request()).status, 500);
    assert.deepEqual(snapshot(), before);
    sql.exec('DROP TRIGGER retired_id_ignore');
    sql.prepare('INSERT INTO patient_retired_ids (id) VALUES (?)').run(patientId);
    assert.equal((await request()).status, 200);
    assert.equal(snapshot().retired.filter(row => row.id === patientId).length, 1);
});
