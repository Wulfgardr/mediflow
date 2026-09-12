/* @Codex: REAL SQLite (node:sqlite) + exact physical owner. All records synthetic.
 * This driver-port test does not claim Next/Drizzle HTTP or OS qualification. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { PatientCreateContextRegistry, readPatientCreateLane, PATIENT_CREATE_HEADERS } from './security/patient-create-context.ts';
import { createPatientAtPreviewDestination, PatientCreateFenceError, type PatientCreateDatabase, type PatientCreateTransaction } from './patient-create-service.ts';
import type * as Owner from '@mediflow/web-auth-lifecycle-owner';

const load = createRequire(import.meta.url);
const ownerPath = load.resolve(process.env.MEDIFLOW_TEST_OWNER_PATH ?? '@mediflow/web-auth-lifecycle-owner');
const owner = load(ownerPath) as typeof Owner;
assert.equal(JSON.parse(readFileSync(join(dirname(ownerPath), 'package.json'), 'utf8')).version, '0.8.7');
// Use the actual built-in SQLite, not an emulated database. Local typing keeps
// the test compatible with the project's @types/node20 without changing deps.
type SqliteValue = string | number | null;
interface SqliteConnection {
    exec(sql: string): void;
    prepare(sql: string): {
        run(...values: SqliteValue[]): unknown;
        get(...values: SqliteValue[]): Record<string, SqliteValue> | undefined;
        all(...values: SqliteValue[]): Record<string, SqliteValue>[];
    };
    close(): void;
}
const { DatabaseSync } = load('node:sqlite') as { DatabaseSync: new (path: string) => SqliteConnection };
function issue(suffix: string): Owner.WebSessionProjection {
    const control = owner.bootstrapControl(); assert(control);
    const attempt = owner.begin('login', { controlId: control.controlId, ifMatch: control.etag, idempotencyKey: `synthetic-sql-${suffix}` }); assert(attempt);
    const issued = owner.issue(attempt, { id: 'synthetic-sql-user', username: 'synthetic-sql-user', role: 'admin' }); assert(issued);
    const resolved = owner.resolve(issued.sessionId, control.controlId); assert.equal(resolved.status, 'active');
    if (resolved.status !== 'active') throw new Error('Synthetic owner fixture failed');
    return resolved.projection;
}
function sqlFixture() {
    const sql = new DatabaseSync(':memory:');
    sql.exec(`PRAGMA foreign_keys=ON;
        CREATE TABLE ambulatories(id TEXT PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE patients(id TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
            tax_code TEXT NOT NULL, address TEXT, phone TEXT, ambulatory_id TEXT REFERENCES ambulatories(id));
        CREATE TABLE patients_to_ambulatories(patient_id TEXT NOT NULL REFERENCES patients(id),
            ambulatory_id TEXT NOT NULL REFERENCES ambulatories(id), PRIMARY KEY(patient_id,ambulatory_id));
        INSERT INTO ambulatories VALUES('synthetic-A','Ambulatorio sintetico A'),('synthetic-B','Ambulatorio sintetico B');`);
    // Explicit fault seam confined to this test: callbacks are never taken from HTTP.
    let afterPatient: (() => void) | undefined;
    let afterMembership: (() => void) | undefined;
    let beforeOperation: (() => void) | undefined;
    let commits = 0; let rollbacks = 0;
    const tx: PatientCreateTransaction = {
        targetExists: id => Boolean(sql.prepare('SELECT id FROM ambulatories WHERE id=?').get(id)),
        insertPatient: values => {
            sql.prepare('INSERT INTO patients VALUES(?,?,?,?,?,?,?)').run(values.id, values.firstName, values.lastName,
                values.taxCode, values.address ?? null, values.phone ?? null, values.ambulatoryId ?? null);
            afterPatient?.();
        },
        insertMembership: (id, target) => {
            sql.prepare('INSERT INTO patients_to_ambulatories VALUES(?,?)').run(id, target);
            afterMembership?.();
        },
    };
    const database: PatientCreateDatabase = { transaction: operation => {
        sql.exec('BEGIN IMMEDIATE');
        try { beforeOperation?.(); const result = operation(tx); sql.exec('COMMIT'); commits += 1; return result; }
        catch (error) { sql.exec('ROLLBACK'); rollbacks += 1; throw error; }
    } };
    return { sql, database, commits: () => commits, rollbacks: () => rollbacks,
        afterPatient: (fn: () => void) => { afterPatient = fn; },
        afterMembership: (fn: () => void) => { afterMembership = fn; },
        beforeOperation: (fn: () => void) => { beforeOperation = fn; },
        rows: () => ({ patients: sql.prepare('SELECT * FROM patients').all(), membership: sql.prepare('SELECT * FROM patients_to_ambulatories').all() }),
    };
}
const values = { id: 'synthetic-patient', firstName: 'Ada', lastName: 'Sintetica', taxCode: 'SYNTHETIC0000001',
    address: 'ENC:synthetic:opaque', phone: 'ENC:synthetic:opaque', ambulatoryId: 'synthetic-B' };
const target = { id: 'synthetic-A', name: 'Ambulatorio sintetico A' };

test('fenced A with cookie B and body B commits patient AND membership ONLY in A', t => {
    const f = sqlFixture(); t.after(() => f.sql.close()); const session = issue('A-cookie-B'); t.after(() => owner.retire(session, 'dispose'));
    const contexts = new PatientCreateContextRegistry(owner); const preview = contexts.capture(session, target); assert(preview);
    const request = new Request('http://synthetic.invalid/api/patients', { method: 'POST', headers: {
        cookie: 'ambulatory_id=synthetic-B', [PATIENT_CREATE_HEADERS.mode]: 'fixed-preview-v1',
        [PATIENT_CREATE_HEADERS.context]: preview.nonce, [PATIENT_CREATE_HEADERS.target]: preview.ambulatoryId,
    } });
    const lane = readPatientCreateLane(request.headers); assert.equal(lane.kind, 'fenced');
    if (lane.kind !== 'fenced') throw new Error('Fixture lane rejected');
    assert.equal(createPatientAtPreviewDestination(f.database, contexts, session, lane.precondition, values), values.id);
    const rows = f.rows(); assert.equal(rows.patients.length, 1); assert.equal(rows.membership.length, 1);
    assert.equal(rows.patients[0].ambulatory_id, 'synthetic-A'); assert.equal(rows.membership[0].ambulatory_id, 'synthetic-A');
    assert.equal(f.commits(), 1); assert.equal(f.rollbacks(), 0);
});
test('generation retired immediately before the transaction operation leaves zero SQL rows', t => {
    const f = sqlFixture(); t.after(() => f.sql.close()); const session = issue('retired');
    const contexts = new PatientCreateContextRegistry(owner); const preview = contexts.capture(session, target); assert(preview);
    f.beforeOperation(() => { assert.equal(owner.retire(session, 'dispose').outcome, 'completed'); });
    assert.throws(() => createPatientAtPreviewDestination(f.database, contexts, session, preview, values), PatientCreateFenceError);
    assert.deepEqual(f.rows(), { patients: [], membership: [] }); assert.equal(f.commits(), 0); assert.equal(f.rollbacks(), 1);
});
test('same user NEW generation with old precondition cannot insert either SQL row', t => {
    const f = sqlFixture(); t.after(() => f.sql.close()); const first = issue('generation-first'); const next = issue('generation-next');
    t.after(() => { owner.retire(first, 'dispose'); owner.retire(next, 'dispose'); });
    const contexts = new PatientCreateContextRegistry(owner); const preview = contexts.capture(first, target); assert(preview);
    assert.throws(() => createPatientAtPreviewDestination(f.database, contexts, next, preview, values), PatientCreateFenceError);
    assert.deepEqual(f.rows(), { patients: [], membership: [] }); assert.equal(f.commits(), 0);
});
test('physical owner FINAL denial after both INSERTs rolls back the REAL SQLite transaction', t => {
    const f = sqlFixture(); t.after(() => f.sql.close()); const session = issue('post-callback-denial'); t.after(() => owner.retire(session, 'dispose'));
    const contexts = new PatientCreateContextRegistry(owner); const preview = contexts.capture(session, target); assert(preview);
    let inserted = false;
    f.afterMembership(() => {
        // Both writes exist inside this still-uncommitted SQL transaction.
        assert.equal(f.rows().patients.length, 1); assert.equal(f.rows().membership.length, 1); inserted = true;
        // Documented public owner rejects reentrancy, poisoning the OUTER binding.
        // No owner edits, proxies or forged boolean return. Production never runs this hook.
        assert.equal(owner.mintResourcePort(session), null);
    });
    assert.throws(() => createPatientAtPreviewDestination(f.database, contexts, session, preview, values), PatientCreateFenceError);
    assert.equal(inserted, true); assert.equal(f.commits(), 0); assert.equal(f.rollbacks(), 1);
    assert.deepEqual(f.rows(), { patients: [], membership: [] });
});
test('preview TTL expiring after INSERTs also rolls back, not just a failed boolean', t => {
    const f = sqlFixture(); t.after(() => f.sql.close()); const session = issue('ttl-in-transaction'); t.after(() => owner.retire(session, 'dispose'));
    let now = Date.now(); const contexts = new PatientCreateContextRegistry(owner, () => now); const preview = contexts.capture(session, target); assert(preview);
    f.afterMembership(() => { now = preview.expiresAt; });
    assert.throws(() => createPatientAtPreviewDestination(f.database, contexts, session, preview, values), PatientCreateFenceError);
    assert.deepEqual(f.rows(), { patients: [], membership: [] }); assert.equal(f.rollbacks(), 1);
});
test('target deleted after preview never routes to B/default', t => {
    const f = sqlFixture(); t.after(() => f.sql.close()); const session = issue('deleted-target'); t.after(() => owner.retire(session, 'dispose'));
    const contexts = new PatientCreateContextRegistry(owner); const preview = contexts.capture(session, target); assert(preview);
    f.sql.prepare('DELETE FROM ambulatories WHERE id=?').run(target.id);
    assert.throws(() => createPatientAtPreviewDestination(f.database, contexts, session, preview, values), PatientCreateFenceError);
    assert.deepEqual(f.rows(), { patients: [], membership: [] });
});
test('membership constraint failure rolls back the inserted patient and retains existing rows', t => {
    const f = sqlFixture(); t.after(() => f.sql.close()); const session = issue('membership'); t.after(() => owner.retire(session, 'dispose'));
    const contexts = new PatientCreateContextRegistry(owner); const preview = contexts.capture(session, target); assert(preview);
    f.sql.exec(`CREATE TRIGGER synthetic_deny_membership BEFORE INSERT ON patients_to_ambulatories BEGIN SELECT RAISE(ABORT,'synthetic constraint'); END;`);
    assert.throws(() => createPatientAtPreviewDestination(f.database, contexts, session, preview, values));
    assert.deepEqual(f.rows(), { patients: [], membership: [] }); assert.equal(f.rollbacks(), 1);
});
test('retirement AFTER commit is not represented as rollback', t => {
    const f = sqlFixture(); t.after(() => f.sql.close()); const session = issue('after-commit');
    const contexts = new PatientCreateContextRegistry(owner); const preview = contexts.capture(session, target); assert(preview);
    createPatientAtPreviewDestination(f.database, contexts, session, preview, values);
    owner.retire(session, 'dispose');
    assert.equal(f.rows().patients.length, 1); assert.equal(f.rows().membership.length, 1);
    assert.equal(f.commits(), 1); assert.equal(f.rollbacks(), 0);
});
test('duplicate UUID is create-only: no upsert and no loss of the original SQL patient/membership', t => {
    const f = sqlFixture(); t.after(() => f.sql.close()); const session = issue('same-uuid'); t.after(() => owner.retire(session, 'dispose'));
    const contexts = new PatientCreateContextRegistry(owner); const preview = contexts.capture(session, target); assert(preview);
    createPatientAtPreviewDestination(f.database, contexts, session, preview, values);
    const before = f.rows();
    assert.throws(() => createPatientAtPreviewDestination(f.database, contexts, session, preview, { ...values, firstName: 'Do not replace' }));
    assert.deepEqual(f.rows(), before); assert.equal(f.commits(), 1); assert.equal(f.rollbacks(), 1);
});
