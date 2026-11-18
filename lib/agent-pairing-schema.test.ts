import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeSqliteSchema } from './sqlite-schema';
import { openVersionedSqliteDatabase } from './sqlite-schema-open';

function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'mediflow-pairing-migration-')), file = join(root, 'medical.db');
    const database = new Database(file); initializeSqliteSchema(database);
    database.exec('DROP TABLE agent_unlock_grants; DROP TABLE agent_registrations; DROP TABLE IF EXISTS agent_cassettes; DROP TABLE IF EXISTS agent_clients; DROP TABLE IF EXISTS agent_pairing_requests; PRAGMA user_version=13');
    database.prepare("INSERT INTO users(id,username,password_hash,encrypted_master_key,salt) VALUES ('synthetic-pairing-migration','synthetic-pairing-migration','synthetic-hash','synthetic-wrap','synthetic-salt')").run();
    const generation = (database.prepare('SELECT generation FROM archive_generation').get() as { generation: string }).generation;
    database.prepare(`INSERT INTO agent_mandates(id,actor_ref,archive_generation,operations,provider,allows_clinical_egress,public_key,wrapped_private_key,created_at,expires_at)
        VALUES ('synthetic-original-mandate','synthetic-pairing-migration',?,'["visita.nota"]','local',0,'synthetic-public','ENC:synthetic-wrapped-private',1,1000)`).run(generation);
    const before = database.prepare('SELECT * FROM agent_mandates').all(); database.close();
    return { root, file, before, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
test('opening schema13 preserves the mandate and verified original before adding pairing storage, then reopens without DDL', () => {
    const f = fixture();
    try {
        const opened = openVersionedSqliteDatabase(f.file);
        assert.ok(opened.prepare("SELECT 1 FROM sqlite_schema WHERE name='agent_clients'").get());
        assert.ok(opened.prepare("SELECT 1 FROM sqlite_schema WHERE name='agent_pairing_requests'").get());
        assert.deepEqual(opened.prepare('SELECT * FROM agent_mandates').all(), f.before); opened.close();
        const originals = readdirSync(f.root).filter(name => name.includes('.schema-original-v13-')); assert.equal(originals.length, 1);
        const original = new Database(join(f.root, originals[0]), { readonly: true });
        assert.equal(original.pragma('user_version', { simple: true }), 13);
        assert.equal(original.prepare("SELECT 1 FROM sqlite_schema WHERE name='agent_clients'").get(), undefined);
        assert.deepEqual(original.prepare('SELECT * FROM agent_mandates').all(), f.before); original.close();
        const reopened = openVersionedSqliteDatabase(f.file, file => {
            const connection = new Database(file), exec = connection.exec.bind(connection), prepare = connection.prepare.bind(connection);
            connection.exec = ((sql: string) => { assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP)\b/iu); return exec(sql); }) as typeof connection.exec;
            connection.prepare = ((sql: string) => { assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP)\b/iu); return prepare(sql); }) as typeof connection.prepare;
            return connection;
        }); reopened.close();
    } finally { f.cleanup(); }
});
test('failure after the second pairing table rolls back both tables and leaves schema13 recoverable', () => {
    const f = fixture();
    try {
        assert.throws(() => openVersionedSqliteDatabase(f.file, file => {
            const connection = new Database(file), exec = connection.exec.bind(connection);
            connection.exec = ((sql: string) => { const result = exec(sql); if (sql.includes('CREATE TABLE IF NOT EXISTS agent_clients')) throw new Error('SYNTHETIC_PAIRING_DDL_FAILURE'); return result; }) as typeof connection.exec;
            return connection;
        }), /SYNTHETIC_PAIRING_DDL_FAILURE/);
        const old = new Database(f.file);
        assert.equal(old.pragma('user_version', { simple: true }), 13);
        assert.equal(old.prepare("SELECT 1 FROM sqlite_schema WHERE name GLOB 'agent_*' AND name!='agent_mandates'").get(), undefined);
        assert.deepEqual(old.prepare('SELECT * FROM agent_mandates').all(), f.before); old.close();
        const retried = openVersionedSqliteDatabase(f.file); assert.ok(retried.prepare("SELECT 1 FROM sqlite_schema WHERE name='agent_clients'").get()); retried.close();
    } finally { f.cleanup(); }
});
