import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initializeSqliteSchema } from './sqlite-schema';
import { schemaSnapshot } from './sqlite-schema-shape';
import { upgradeObservationTimestampDefault } from './sqlite-observation-schema-upgrade';

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
