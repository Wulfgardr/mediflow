import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { initializeSqliteSchema } from './sqlite-schema';
import { openVersionedSqliteDatabase } from './sqlite-schema-open';
import { captureHostTerritorialPacks, preserveHostTerritorialPacks, initializeTerritorialPacks, readTerritorialPacks, commitTerritorialPackTransition, requireTerritorialPack } from './territorial-pack-store';
import { TERRITORIAL_PACK_SETTING_KEY as KEY, TERRITORIAL_PACK_INITIALIZATION_KEY as INIT, TERRITORIAL_PACK_SCHEMA } from './territorial-packs';

function fixture() {
    const db = new Database(':memory:'); initializeSqliteSchema(db);
    return db;
}
const command = (preset = 'core+it+lom', expectedRevision = 0) => ({ schemaVersion: TERRITORIAL_PACK_SCHEMA, expectedRevision, preset, confirmed: true });
const actor = { actorType: 'system' as const, actorRef: 'local-supervisor', sourceSurface: 'job' as const };
const events = (db: Database.Database) => db.prepare("SELECT * FROM audit_events WHERE event_type LIKE 'territorial.%'").all() as { redacted_metadata: string }[];

test('initialization is host transaction only; existing migration is once, atomic and audited', () => {
    const db = fixture();
    try {
        assert.throws(() => initializeTerritorialPacks(db, 'existing'));
        db.transaction(() => initializeTerritorialPacks(db, 'existing')).immediate();
        assert.equal(readTerritorialPacks(db).preset, 'core+it+lom');
        assert.equal(events(db).length, 1);
        assert.deepEqual(JSON.parse(events(db)[0].redacted_metadata).flags, ['before:core', 'after:core+it+lom', 'origin:existing']);
        db.transaction(() => initializeTerritorialPacks(db, 'existing')).immediate();
        assert.equal(events(db).length, 1);
        commitTerritorialPackTransition(db, command('core', 1), actor, () => {});
        db.transaction(() => initializeTerritorialPacks(db, 'existing')).immediate();
        assert.equal(readTerritorialPacks(db).preset, 'core');
        db.prepare('DELETE FROM settings WHERE key=?').run(KEY);
        db.transaction(() => initializeTerritorialPacks(db, 'existing')).immediate();
        assert.equal(readTerritorialPacks(db).preset, 'core', 'missing capability must never replay migration');
    } finally { db.close(); }
});
test('new and reserved archives stay core on restart; admitted existing versioned and legacy empty archives migrate without clinical rows', () => {
    for (const kind of ['new', 'reservation', 'versioned', 'legacy']) {
        const dir = mkdtempSync(path.join(process.env.MEDIFLOW_DATA_DIR!, 'territorial-origin-'));
        const file = path.join(dir, 'medical.db');
        try {
            if (kind !== 'new') {
                const seed = new Database(file);
                if (kind === 'reservation') seed.pragma('application_id = 1296451154');
                else { initializeSqliteSchema(seed); if (kind === 'versioned') seed.pragma('user_version = 4'); }
                seed.close();
            }
            for (let start = 0; start < 2; start++) {
                const db = openVersionedSqliteDatabase(file);
                try {
                    assert.equal(db.prepare('SELECT count(*) FROM patients').pluck().get(), 0);
                    assert.equal(readTerritorialPacks(db).preset, ['new', 'reservation'].includes(kind) ? 'core' : 'core+it+lom');
                    assert.equal(events(db).length, 1);
                } finally { db.close(); }
            }
        } finally { rmSync(dir, { recursive: true, force: true }); }
    }
});
test('malformed state and initialization markers cannot enable or migrate', () => {
    for (const key of [KEY, INIT]) {
        const db = fixture();
        try {
            db.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run(key, '{');
            db.transaction(() => initializeTerritorialPacks(db, 'existing')).immediate();
            assert.equal(readTerritorialPacks(db).status, 'configuration_error');
            assert.throws(() => db.transaction(() => requireTerritorialPack(db, 'lom')).immediate(), /pack_disabled/);
            assert.equal(events(db).length, 0);
        } finally { db.close(); }
    }
});
test('transition CAS and audit are atomic, including silently ignored writes', () => {
    for (const table of ['audit_events', 'settings']) for (const fault of ['FAIL', 'IGNORE']) {
        const db = fixture();
        try {
            db.transaction(() => initializeTerritorialPacks(db, 'new')).immediate();
            const before = db.prepare('SELECT * FROM settings').all(); const audit = events(db);
            db.exec(`CREATE TRIGGER synthetic_fault BEFORE INSERT ON ${table} BEGIN SELECT RAISE(${fault}${fault === 'FAIL' ? ", 'synthetic'" : ''}); END`);
            assert.throws(() => commitTerritorialPackTransition(db, command(), actor, () => {}));
            assert.deepEqual(db.prepare('SELECT * FROM settings').all(), before);
            assert.deepEqual(events(db), audit);
        } finally { db.close(); }
    }
    const db = fixture();
    try {
        db.transaction(() => initializeTerritorialPacks(db, 'new')).immediate();
        commitTerritorialPackTransition(db, command(), actor, () => {});
        assert.throws(() => commitTerritorialPackTransition(db, command('core'), actor, () => {}), /conflict/);
        assert.equal(readTerritorialPacks(db).preset, 'core+it+lom');
        assert.equal(events(db).length, 2);
        commitTerritorialPackTransition(db, command('core', 1), actor, () => {});
        assert.throws(() => db.transaction(() => requireTerritorialPack(db, 'lom')).immediate(), /pack_disabled/);
    } finally { db.close(); }
});

test('migration rolls back its capability and once marker when the required audit is refused', () => {
    for (const fault of ['FAIL', 'IGNORE']) {
        const db = fixture();
        try {
            db.exec(`CREATE TRIGGER synthetic_migration_fault BEFORE INSERT ON audit_events BEGIN SELECT RAISE(${fault}${fault === 'FAIL' ? ", 'synthetic'" : ''}); END`);
            assert.throws(() => db.transaction(() => initializeTerritorialPacks(db, 'existing')).immediate());
            assert.equal(db.prepare('SELECT count(*) FROM settings WHERE key IN (?,?)').pluck().get(KEY, INIT), 0);
            assert.equal(events(db).length, 0);
            db.exec('DROP TRIGGER synthetic_migration_fault');
            db.transaction(() => initializeTerritorialPacks(db, 'existing')).immediate();
            assert.equal(readTerritorialPacks(db).preset, 'core+it+lom');
            assert.equal(events(db).length, 1);
        } finally { db.close(); }
    }
});

test('replacement preserves host authority atomically when a settings or required audit write fails or is ignored', () => {
    const host = fixture();
    host.transaction(() => initializeTerritorialPacks(host, 'new')).immediate();
    const snapshot = captureHostTerritorialPacks(host)!;
    try {
        for (const table of ['settings', 'audit_events']) for (const fault of ['FAIL', 'IGNORE']) {
            const replacement = fixture();
            try {
                replacement.transaction(() => initializeTerritorialPacks(replacement, 'existing')).immediate();
                const before = replacement.prepare('SELECT * FROM settings ORDER BY key').all();
                const audit = events(replacement);
                replacement.exec(`CREATE TRIGGER synthetic_preservation_fault BEFORE INSERT ON ${table} BEGIN SELECT RAISE(${fault}${fault === 'FAIL' ? ", 'synthetic'" : ''}); END`);
                assert.throws(() => preserveHostTerritorialPacks(replacement, snapshot));
                assert.deepEqual(replacement.prepare('SELECT * FROM settings ORDER BY key').all(), before);
                assert.deepEqual(events(replacement), audit);
            } finally { replacement.close(); }
        }
    } finally { host.close(); }
});
