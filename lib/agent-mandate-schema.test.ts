import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initializeSqliteSchema } from './sqlite-schema';
import { openVersionedSqliteDatabase, CURRENT_SQLITE_SCHEMA_VERSION } from './sqlite-schema-open';

test('opening schema12 adds mandate storage only after preserving a recoverable original and never runs DDL on reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mediflow-mandate-schema-'));
    const file = join(directory, 'medical.db');
    try {
        const old = new Database(file);
        initializeSqliteSchema(old);
        old.exec('DROP TABLE agent_unlock_grants; DROP TABLE agent_registrations; DROP TABLE IF EXISTS agent_cassettes; DROP TABLE IF EXISTS agent_clients; DROP TABLE IF EXISTS agent_pairing_requests; DROP TABLE IF EXISTS agent_mandates');
        old.pragma('user_version=12');
        old.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('synthetic-mandate-schema', 'preserved');
        old.close();
        const opened = openVersionedSqliteDatabase(file);
        try {
            assert.equal(opened.pragma('user_version', { simple: true }), CURRENT_SQLITE_SCHEMA_VERSION);
            assert.ok(opened.prepare("SELECT 1 FROM sqlite_schema WHERE name='agent_mandates'").get());
            assert.equal(opened.prepare("SELECT value FROM settings WHERE key='synthetic-mandate-schema'").pluck().get(), 'preserved');
        } finally { opened.close(); }
        const originals = readdirSync(directory).filter(name => name.includes('.schema-original-v12-'));
        assert.equal(originals.length, 1);
        const original = new Database(join(directory, originals[0]), { readonly: true });
        try {
            assert.equal(original.pragma('user_version', { simple: true }), 12);
            assert.equal(original.prepare("SELECT 1 FROM sqlite_schema WHERE name='agent_mandates'").get(), undefined);
        } finally { original.close(); }
        const reopened = openVersionedSqliteDatabase(file, path => {
            const connection = new Database(path), exec = connection.exec.bind(connection), prepare = connection.prepare.bind(connection);
            connection.exec = ((sql: string) => { assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP)\b/iu); return exec(sql); }) as typeof connection.exec;
            connection.prepare = ((sql: string) => { assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP)\b/iu); return prepare(sql); }) as typeof connection.prepare;
            return connection;
        });
        reopened.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('a failed mandate DDL leaves schema12 and its data unchanged and retry can migrate', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mediflow-mandate-rollback-'));
    const file = join(directory, 'medical.db');
    try {
        const old = new Database(file);
        initializeSqliteSchema(old); old.exec('DROP TABLE agent_unlock_grants; DROP TABLE agent_registrations; DROP TABLE IF EXISTS agent_cassettes; DROP TABLE IF EXISTS agent_clients; DROP TABLE IF EXISTS agent_pairing_requests; DROP TABLE IF EXISTS agent_mandates'); old.pragma('user_version=12');
        const before = old.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all(); old.close();
        assert.throws(() => openVersionedSqliteDatabase(file, path => {
            const connection = new Database(path), exec = connection.exec.bind(connection);
            connection.exec = ((sql: string) => {
                const result = exec(sql);
                if (sql.includes('CREATE TABLE IF NOT EXISTS agent_mandates')) throw new Error('SYNTHETIC_MANDATE_DDL_FAILURE');
                return result;
            }) as typeof connection.exec;
            return connection;
        }), /SYNTHETIC_MANDATE_DDL_FAILURE/);
        const unchanged = new Database(file);
        assert.equal(unchanged.pragma('user_version', { simple: true }), 12);
        assert.deepEqual(unchanged.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all(), before);
        unchanged.close();
        const retried = openVersionedSqliteDatabase(file);
        assert.equal(retried.pragma('user_version', { simple: true }), CURRENT_SQLITE_SCHEMA_VERSION); retried.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
