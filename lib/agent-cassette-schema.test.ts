import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeSqliteSchema } from './sqlite-schema';
import { openVersionedSqliteDatabase } from './sqlite-schema-open';

function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'mediflow-cassette-migration-')), file = join(root, 'medical.db');
    const database = new Database(file); initializeSqliteSchema(database);
    database.exec('DROP TABLE IF EXISTS agent_cassettes; PRAGMA user_version=14');
    database.prepare("INSERT INTO users(id,username,password_hash,encrypted_master_key,salt) VALUES ('synthetic-cassette-migration','synthetic-cassette-migration','synthetic-hash','synthetic-wrap','synthetic-salt')").run();
    const before = database.prepare('SELECT * FROM users').all(); database.close();
    return { root, file, before, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
test('schema14 gains cassette storage only after a verified recoverable original and reopens without DDL', () => {
    const f = fixture();
    try {
        const opened = openVersionedSqliteDatabase(f.file);
        assert.ok(opened.prepare("SELECT 1 FROM sqlite_schema WHERE name='agent_cassettes'").get());
        assert.deepEqual(opened.prepare('SELECT * FROM users').all(), f.before); opened.close();
        const originals = readdirSync(f.root).filter(name => name.includes('.schema-original-v14-')); assert.equal(originals.length, 1);
        const original = new Database(join(f.root, originals[0]), { readonly: true });
        assert.equal(original.pragma('user_version', { simple: true }), 14);
        assert.equal(original.prepare("SELECT 1 FROM sqlite_schema WHERE name='agent_cassettes'").get(), undefined);
        assert.deepEqual(original.prepare('SELECT * FROM users').all(), f.before); original.close();
        const reopened = openVersionedSqliteDatabase(f.file, file => {
            const connection = new Database(file), exec = connection.exec.bind(connection), prepare = connection.prepare.bind(connection);
            connection.exec = ((sql: string) => { assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP)\b/iu); return exec(sql); }) as typeof connection.exec;
            connection.prepare = ((sql: string) => { assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP)\b/iu); return prepare(sql); }) as typeof connection.prepare;
            return connection;
        }); reopened.close();
    } finally { f.cleanup(); }
});
test('cassette migration failure rolls back DDL and preserves schema14 for a successful retry', () => {
    const f = fixture();
    try {
        assert.throws(() => openVersionedSqliteDatabase(f.file, file => {
            const connection = new Database(file), exec = connection.exec.bind(connection);
            connection.exec = ((sql: string) => { const result = exec(sql); if (sql.includes('CREATE TABLE IF NOT EXISTS agent_cassettes')) throw new Error('SYNTHETIC_CASSETTE_DDL_FAILURE'); return result; }) as typeof connection.exec;
            return connection;
        }), /SYNTHETIC_CASSETTE_DDL_FAILURE/);
        const old = new Database(f.file);
        assert.equal(old.pragma('user_version', { simple: true }), 14);
        assert.equal(old.prepare("SELECT 1 FROM sqlite_schema WHERE name='agent_cassettes'").get(), undefined);
        assert.deepEqual(old.prepare('SELECT * FROM users').all(), f.before); old.close();
        const retried = openVersionedSqliteDatabase(f.file); assert.ok(retried.prepare("SELECT 1 FROM sqlite_schema WHERE name='agent_cassettes'").get()); retried.close();
    } finally { f.cleanup(); }
});
