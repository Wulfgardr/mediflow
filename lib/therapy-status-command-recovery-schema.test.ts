import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { initializeSqliteSchema } from './sqlite-schema';
import { schemaSnapshot } from './sqlite-schema-shape';
import { assertTherapyCommandPredecessorRecoverySchema } from './therapy-status-command-recovery-schema';

function predecessor() {
    const db = new Database(':memory:'); initializeSqliteSchema(db);
    db.exec('DROP TABLE ambulatory_destructive_commands; DROP TABLE therapy_status_commands; PRAGMA user_version=4;'); return db;
}
test('canonical v4 remains admitted against its immutable fingerprint without changing bytes', () => {
    const db = predecessor();
    try {
        assert.equal(createHash('sha256').update(JSON.stringify(schemaSnapshot(db))).digest('hex'),
            'a998dad7b46c831f283032144f43cd690f68e962b199256ecd68c11736f867ed');
        const before = db.serialize(); assertTherapyCommandPredecessorRecoverySchema(db);
        assert.deepEqual(db.serialize(), before);
    } finally { db.close(); }
});
for (const mutation of ['extra-table', 'column', 'index', 'trigger', 'view', 'false-version', 'missing-ledger-v5'] as const)
test(`predecessor v4 denies ${mutation} without changing bytes`, () => {
    const db = predecessor();
    try {
        if (mutation === 'extra-table') db.exec('CREATE TABLE synthetic_extension(value TEXT)');
        if (mutation === 'column') db.exec('ALTER TABLE therapies ADD COLUMN synthetic_drift TEXT');
        if (mutation === 'index') db.exec('CREATE INDEX synthetic_drift ON therapies(status)');
        if (mutation === 'trigger') db.exec('CREATE TRIGGER synthetic_drift BEFORE UPDATE ON therapies BEGIN SELECT RAISE(IGNORE); END');
        if (mutation === 'view') db.exec('CREATE VIEW synthetic_drift AS SELECT id FROM therapies');
        if (mutation === 'false-version') db.pragma('user_version=3');
        if (mutation === 'missing-ledger-v5') db.pragma('user_version=5');
        const before = db.serialize(); assert.throws(() => assertTherapyCommandPredecessorRecoverySchema(db));
        assert.deepEqual(db.serialize(), before);
    } finally { db.close(); }
});
