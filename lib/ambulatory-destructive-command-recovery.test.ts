import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { openVersionedSqliteDatabase } from './sqlite-schema-open';
import { initializeSqliteSchema } from './sqlite-schema';
import { schemaSnapshot } from './sqlite-schema-shape';
import { assertAmbulatoryCommandPredecessorRecoverySchema } from './ambulatory-destructive-command-recovery-schema';

const canonical = new Map([
    [4, 'a998dad7b46c831f283032144f43cd690f68e962b199256ecd68c11736f867ed'],
    [5, '33ce371c41f4cb51033af18ef9a0f06bf8c81a248bca29f18b21d3db9f24ea46'],
]);
for (const version of [4, 5]) {
    function predecessor() {
        const db = new Database(':memory:'); initializeSqliteSchema(db);
        db.exec('DROP TABLE ambulatory_destructive_commands');
        if (version === 4) db.exec('DROP TABLE therapy_status_commands');
        db.pragma(`user_version=${version}`); return db;
    }
    test(`immutable canonical${version} fingerprint and read-only predecessor admission`, () => {
        const db = predecessor();
        try {
            assert.equal(createHash('sha256').update(JSON.stringify(schemaSnapshot(db))).digest('hex'), canonical.get(version));
            const before = db.serialize(); assertAmbulatoryCommandPredecessorRecoverySchema(db);
            assert.deepEqual(db.serialize(), before);
        } finally { db.close(); }
    });
    for (const mutation of ['column', 'index', 'trigger', 'table', 'view', 'false-version'] as const) test(`canonical${version} denies ${mutation} before migration`, () => {
        const db = predecessor();
        try {
            if (mutation === 'column') db.exec('ALTER TABLE therapies ADD COLUMN drift TEXT');
            if (mutation === 'index') db.exec('CREATE INDEX drift ON therapies(status)');
            if (mutation === 'trigger') db.exec('CREATE TRIGGER drift BEFORE UPDATE ON therapies BEGIN SELECT RAISE(IGNORE); END');
            if (mutation === 'table') db.exec('CREATE TABLE drift(id TEXT)');
            if (mutation === 'view') db.exec('CREATE VIEW drift AS SELECT id FROM therapies');
            if (mutation === 'false-version') db.pragma('user_version=3');
            const before = db.serialize(); assert.throws(() => assertAmbulatoryCommandPredecessorRecoverySchema(db));
            assert.deepEqual(db.serialize(), before);
        } finally { db.close(); }
    });
}
test('false predecessor stamps cannot hide later or missing terminal ledgers', () => {
    for (const mutation of ['v4-with-v5-ledger', 'v5-with-v6-ledger', 'v5-missing-v5-ledger']) {
        const db = new Database(':memory:'); initializeSqliteSchema(db);
        try {
            if (mutation !== 'v5-with-v6-ledger') db.exec('DROP TABLE ambulatory_destructive_commands');
            if (mutation === 'v5-missing-v5-ledger') db.exec('DROP TABLE therapy_status_commands');
            db.pragma(`user_version=${mutation === 'v4-with-v5-ledger' ? 4 : 5}`);
            assert.throws(() => assertAmbulatoryCommandPredecessorRecoverySchema(db));
        } finally { db.close(); }
    }
});

test('failure after the new v6 DDL rolls back the predecessor ledger, account bytes and stamp', () => {
    const root = mkdtempSync(join(process.env.MEDIFLOW_DATA_DIR!, 'canonical5-rollback-')), file = join(root, 'medical.db');
    const original = openVersionedSqliteDatabase(file);
    original.exec('DROP TABLE ambulatory_destructive_commands; PRAGMA user_version=5;');
    original.prepare("INSERT INTO users(id,username,role,password_hash,encrypted_master_key,salt) VALUES ('synthetic-v5','synthetic-v5','admin','synthetic-hash','v3:synthetic-wrapped-key','synthetic-salt')").run();
    const user = original.prepare("SELECT * FROM users WHERE id='synthetic-v5'").get(); original.close();
    assert.throws(() => openVersionedSqliteDatabase(file, name => {
        const db = new Database(name), execute = db.exec.bind(db);
        db.exec = sql => { const result = execute(sql); if (sql.includes('ambulatory_destructive_commands_no_update')) throw new Error('SYNTHETIC_V6_DDL_FAULT'); return result; };
        return db;
    }), /SYNTHETIC_V6_DDL_FAULT/);
    const after = new Database(file, { readonly: true });
    try {
        assert.equal(after.pragma('user_version', { simple: true }), 5);
        assert.equal(after.prepare("SELECT 1 FROM sqlite_schema WHERE name='ambulatory_destructive_commands'").get(), undefined);
        assert.deepEqual(after.prepare("SELECT * FROM users WHERE id='synthetic-v5'").get(), user);
        assertAmbulatoryCommandPredecessorRecoverySchema(after);
    } finally { after.close(); }
});
