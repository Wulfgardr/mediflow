import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initializeSqliteSchema } from './sqlite-schema';
import { schemaSnapshot } from './sqlite-schema-shape';
import { upgradeObservationTimestampDefault, upgradeReviewPatientReferenceDefault } from './sqlite-observation-schema-upgrade';

function fixture(file = ':memory:', transform = (ddl: string) => ddl) {
    const canonical = new Database(':memory:');
    initializeSqliteSchema(canonical);
    const db = new Database(file);
    // Synthetic parent tables suffice; observations uses the real canonical DDL and indices.
    db.exec('CREATE TABLE patients (id TEXT PRIMARY KEY); CREATE TABLE service_prescription_items (id TEXT PRIMARY KEY)');
    const ddl = (canonical.prepare("SELECT sql FROM sqlite_schema WHERE name='observations'").get() as { sql: string }).sql;
    db.exec(transform(ddl.replace('updated_at INTEGER DEFAULT (unixepoch())', 'updated_at INTEGER')));
    for (const { sql } of canonical.prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND tbl_name='observations' AND sql IS NOT NULL").all() as { sql: string }[]) db.exec(sql);
    db.pragma('foreign_keys = ON');
    db.exec("INSERT INTO patients VALUES ('synthetic-patient'); INSERT INTO service_prescription_items VALUES ('synthetic-item')");
    const insert = db.prepare(`INSERT INTO observations (id,patient_id,code_system,code,display,unit_system,unit_code,value,observed_at,updated_at,service_prescription_item_id)
        VALUES (?, 'synthetic-patient','synthetic','code','display','synthetic','unit','42',123,?,'synthetic-item')`);
    insert.run('synthetic-null', null); insert.run('synthetic-timestamp', 456);
    return { db, canonical, close() { db.close(); canonical.close(); } };
}
const rows = (db: Database.Database) => db.prepare('SELECT * FROM observations ORDER BY id').all();
const run = (db: Database.Database, canonical: Database.Database) => db.transaction(() => upgradeObservationTimestampDefault(db, canonical)).immediate();

test('memory and reopened disk upgrade preserve every value including NULL and outgoing FKs', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-observation-default-'));
    try {
        for (const file of [':memory:', path.join(directory, 'synthetic.db')]) {
            const f = fixture(file);
            try {
                const before = rows(f.db);
                run(f.db, f.canonical);
                assert.deepEqual(rows(f.db), before);
                assert.deepEqual(schemaSnapshot(f.db).observations, schemaSnapshot(f.canonical).observations);
                assert.deepEqual(f.db.pragma('foreign_key_check'), []);
                assert.equal(f.db.pragma('foreign_keys', { simple: true }), 1);
                const changes = f.db.prepare('SELECT total_changes() AS n').get();
                run(f.db, f.canonical);
                assert.deepEqual(f.db.prepare('SELECT total_changes() AS n').get(), changes);
                if (file !== ':memory:') {
                    const reopened = new Database(file);
                    try { assert.deepEqual(rows(reopened), before); assert.deepEqual(schemaSnapshot(reopened).observations, schemaSnapshot(f.canonical).observations); }
                    finally { reopened.close(); }
                }
            } finally { f.close(); }
        }
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('unknown constraints, triggers, columns, indices, incoming FK and staging collision deny without loss', () => {
    for (const mutation of [
        "CREATE TRIGGER unknown_observation AFTER INSERT ON observations BEGIN SELECT 1; END",
        'ALTER TABLE observations ADD COLUMN unexpected TEXT',
        'CREATE INDEX unknown_observation_idx ON observations(value)',
        'CREATE TABLE dependent (id TEXT PRIMARY KEY, observation_id TEXT REFERENCES observations(id) ON DELETE CASCADE)',
        'CREATE TABLE observations_timestamp_default_upgrade (id TEXT)',
    ]) {
        const f = fixture();
        try {
            f.db.exec(mutation);
            const before = schemaSnapshot(f.db), data = rows(f.db);
            assert.throws(() => run(f.db, f.canonical), /OBSERVATION_TIMESTAMP_SCHEMA_UNSUPPORTED/);
            assert.deepEqual(schemaSnapshot(f.db), before); assert.deepEqual(rows(f.db), data);
        } finally { f.close(); }
    }
});

test('released ALTER TABLE FK without a delete action upgrades without changing stored values', () => {
    const f = fixture(':memory:', ddl => ddl.replace(
        'service_prescription_item_id TEXT REFERENCES service_prescription_items(id) ON DELETE SET NULL',
        'service_prescription_item_id TEXT REFERENCES service_prescription_items(id)'));
    try {
        const before = rows(f.db);
        run(f.db, f.canonical);
        assert.deepEqual(rows(f.db), before);
        assert.deepEqual(schemaSnapshot(f.db).observations, schemaSnapshot(f.canonical).observations);
        f.db.prepare("DELETE FROM service_prescription_items WHERE id='synthetic-item'").run();
        assert.equal(f.db.prepare('SELECT count(*) FROM observations WHERE service_prescription_item_id IS NULL').pluck().get(), 2);
        assert.deepEqual(f.db.pragma('foreign_key_check'), []);
    } finally { f.close(); }
});

test('unknown CHECK on an existing column is not discarded', () => {
    const f = fixture(':memory:', ddl => ddl.replace('value TEXT NOT NULL', "value TEXT NOT NULL CHECK (length(value) > 0)"));
    try {
        const before = schemaSnapshot(f.db), data = rows(f.db);
        assert.throws(() => run(f.db, f.canonical), /OBSERVATION_TIMESTAMP_SCHEMA_UNSUPPORTED/);
        assert.deepEqual(schemaSnapshot(f.db), before); assert.deepEqual(rows(f.db), data);
    } finally { f.close(); }
});

test('outer transaction error rolls back the completed rebuild and original data', () => {
    const f = fixture();
    try {
        const before = schemaSnapshot(f.db), data = rows(f.db);
        assert.throws(() => f.db.transaction(() => {
            upgradeObservationTimestampDefault(f.db, f.canonical);
            throw new Error('synthetic-outer-fault');
        }).immediate(), /synthetic-outer-fault/);
        assert.deepEqual(schemaSnapshot(f.db), before); assert.deepEqual(rows(f.db), data);
        assert.deepEqual(f.db.pragma('foreign_key_check'), []);
    } finally { f.close(); }
});

test('legacy upgrade requires an outer transaction and enabled FK enforcement', () => {
    const f = fixture();
    try {
        const before = schemaSnapshot(f.db);
        assert.throws(() => upgradeObservationTimestampDefault(f.db, f.canonical), /OBSERVATION_TIMESTAMP_SCHEMA_UNSUPPORTED/);
        f.db.pragma('foreign_keys = OFF');
        assert.throws(() => run(f.db, f.canonical), /OBSERVATION_TIMESTAMP_SCHEMA_UNSUPPORTED/);
        assert.deepEqual(schemaSnapshot(f.db), before);
    } finally { f.close(); }
});

test('released patient_ref default converges while preserving sealed reviews and refusing child rows', () => {
    const canonical = new Database(':memory:'); initializeSqliteSchema(canonical);
    const ddl = (canonical.prepare("SELECT sql FROM sqlite_schema WHERE name='durable_review_records'").get() as { sql: string }).sql;
    for (const incompatible of ['', 'ALTER TABLE durable_review_records ADD COLUMN unexpected TEXT', 'child']) {
        const db = new Database(':memory:'); db.pragma('foreign_keys=ON');
        db.exec(ddl.replace('patient_ref TEXT NOT NULL,', "patient_ref TEXT NOT NULL DEFAULT '',"));
        db.exec("INSERT INTO durable_review_records(id,review_id,review_revision,receipt_ref,provenance_ref,receipt_binding,provenance_binding,presentation_version,sealed_ciphertext,sealed_digest) VALUES ('synthetic-id','synthetic-review',1,'r','p','r','p','v','synthetic-sealed','synthetic-digest')");
        if (incompatible === 'child') {
            db.exec((canonical.prepare("SELECT sql FROM sqlite_schema WHERE name='durable_review_patient_links'").get() as { sql: string }).sql);
            // A populated known child also blocks the rebuild before any DROP.
            db.exec("CREATE TABLE patients(id TEXT PRIMARY KEY); INSERT INTO patients VALUES ('synthetic-patient')");
            db.prepare('INSERT INTO durable_review_patient_links(review_id,patient_id,created_at,updated_at) VALUES (?,?,?,?)').run('synthetic-review','synthetic-patient',123,123);
        } else if (incompatible) db.exec(incompatible);
        const before = db.prepare('SELECT * FROM durable_review_records').all(), shape = schemaSnapshot(db);
        try {
            const upgrade = () => db.transaction(() => upgradeReviewPatientReferenceDefault(db,canonical)).immediate();
            if (incompatible) { assert.throws(upgrade,/REVIEW_PATIENT_REFERENCE_SCHEMA_UNSUPPORTED/); assert.deepEqual(schemaSnapshot(db),shape); }
            else { upgrade(); assert.deepEqual(schemaSnapshot(db).durable_review_records,schemaSnapshot(canonical).durable_review_records); }
            assert.deepEqual(db.prepare('SELECT * FROM durable_review_records').all(),before);
        } finally { db.close(); }
    }
    canonical.close();
});
