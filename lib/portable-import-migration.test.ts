import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openVersionedSqliteDatabase, CURRENT_SQLITE_SCHEMA_VERSION } from './sqlite-schema-open';

function original() {
    const parent = process.env.MEDIFLOW_DATA_DIR || tmpdir(); mkdirSync(parent, { recursive: true });
    const root = mkdtempSync(join(parent, 'v6-')), file = join(root, 'medical.db');
    const db = openVersionedSqliteDatabase(file);
    db.exec('DROP TABLE portable_import_origins; PRAGMA user_version=6;');
    db.prepare('INSERT INTO patients(id,first_name,last_name,tax_code,notes) VALUES (?,?,?,?,?)').run('synthetic-upgrade', 'Persona', 'Sintetica', 'SYNTHETIC-UPGRADE', 'ENC:synthetic:preserved');
    db.prepare('INSERT INTO audit_events(event_id,event_type,occurred_at,outcome,actor_type,actor_ref,subject_type,subject_ref,source_surface) VALUES (?,?,1,?,?,?,?,?,?)')
        .run('untrusted-history-marker', 'backup.audit.imported', 'success', 'system', 'claimed-host', 'audit_event', 'arbitrary-local-event', 'web');
    const patients = db.prepare('SELECT * FROM patients').all();db.close();return { root, file, patients };
}
test('v6 upgrades to v7 atomically, keeps a verified original and never derives authority from old markers', () => {
    const f = original(), db = openVersionedSqliteDatabase(f.file);
    assert.equal(db.pragma('user_version', { simple: true }), CURRENT_SQLITE_SCHEMA_VERSION);
    assert.equal(CURRENT_SQLITE_SCHEMA_VERSION, 7);
    assert.deepEqual(db.prepare('SELECT * FROM patients').all(), f.patients);
    assert.deepEqual(db.prepare('SELECT * FROM portable_import_origins').all(), []);
    const copies = readdirSync(f.root).filter(name => name.includes('.schema-original-v6-'));
    assert.equal(copies.length, 1);
    const before = new Database(join(f.root, copies[0]!), { readonly: true });
    assert.equal(before.pragma('user_version', { simple: true }), 6);
    assert.deepEqual(before.prepare('SELECT * FROM patients').all(), f.patients);before.close();
    db.close();openVersionedSqliteDatabase(f.file).close();
    assert.equal(readdirSync(f.root).filter(name => name.includes('.schema-original-v6-')).length, 1);
});
test('a failure after provenance DDL rolls back schema, stamp and clinical rows', () => {
    const f = original();
    assert.throws(() => openVersionedSqliteDatabase(f.file, file => {
        const db = new Database(file), exec = db.exec.bind(db);
        db.exec = source => { const result = exec(source); if (source.includes('portable_import_origins_no_delete')) throw new Error('SYNTHETIC_ORIGIN_DDL_FAILURE'); return result; };
        return db;
    }), /SYNTHETIC_ORIGIN_DDL_FAILURE/);
    const db = new Database(f.file, { readonly: true });
    assert.equal(db.pragma('user_version', { simple: true }), 6);
    assert.deepEqual(db.prepare('SELECT * FROM patients').all(), f.patients);
    assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='portable_import_origins'").get(), undefined);db.close();
});
