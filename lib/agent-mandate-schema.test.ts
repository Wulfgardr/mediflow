import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
        old.exec('DROP TABLE entry_revisions; DROP TABLE agent_unlock_grants; DROP TABLE agent_registrations; DROP TABLE IF EXISTS agent_cassettes; DROP TABLE IF EXISTS agent_clients; DROP TABLE IF EXISTS agent_pairing_requests; DROP TABLE IF EXISTS agent_mandates');
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
        initializeSqliteSchema(old); old.exec('DROP TABLE entry_revisions; DROP TABLE agent_unlock_grants; DROP TABLE agent_registrations; DROP TABLE IF EXISTS agent_cassettes; DROP TABLE IF EXISTS agent_clients; DROP TABLE IF EXISTS agent_pairing_requests; DROP TABLE IF EXISTS agent_mandates'); old.pragma('user_version=12');
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

function seedLegacyV17Archive(file: string) {
    const legacy = new Database(file);
    initializeSqliteSchema(legacy);
    legacy.pragma('foreign_keys = OFF');
    const ddl = (legacy.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='agent_mandates'").get() as { sql: string }).sql;
    legacy.exec('DROP TABLE agent_mandates');
    legacy.exec(ddl.replace('created_at + 86400000', 'created_at + 43200000'));
    legacy.pragma('foreign_keys = ON');
    const now = 1900000000000;
    const actor = 'synthetic-v17-doctor';
    const generation = (legacy.prepare('SELECT generation FROM archive_generation WHERE id=1').pluck().get() as string);
    const mandateId = randomUUID();
    const agentId = randomUUID();
    const visitId = randomUUID();
    legacy.prepare('INSERT INTO users(id,username,role,password_hash,encrypted_master_key,salt) VALUES (?,?,?,?,?,?)')
        .run(actor, actor, 'admin', 'synthetic-hash', 'synthetic-wrapped', 'synthetic-salt');
    legacy.prepare(`INSERT INTO agent_mandates(id,actor_ref,archive_generation,operations,provider,allows_clinical_egress,public_key,wrapped_private_key,created_at,expires_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(mandateId, actor, generation, JSON.stringify(['visita.apri', 'visita.chiudi']), 'openai', 1, 'B' + 'A'.repeat(86) + '=', 'ENC:' + 'A'.repeat(16) + ':' + 'A'.repeat(32), now, now + 43200000);
    legacy.prepare(`INSERT INTO agent_pairing_requests(id,code,name,operations,claim_hash,created_at,expires_at,status,mandate_ref)
        VALUES (?,?,?,?,?,?,?,'approved',?)`)
        .run(agentId, 'ABCD1234', 'Synthetic Codex', JSON.stringify(['visita.apri', 'visita.chiudi']), 'a'.repeat(64), now, now + 300000, mandateId);
    legacy.prepare('INSERT INTO agent_clients(id,mandate_ref,name,operations,token_hash,expires_at) VALUES (?,?,?,?,?,?)')
        .run(agentId, mandateId, 'Synthetic Codex', JSON.stringify(['visita.apri', 'visita.chiudi']), 'b'.repeat(64), now + 43200000);
    legacy.prepare('INSERT INTO agent_registrations(id,template_ref,token_hash,current_mandate_ref) VALUES (?,?,?,?)')
        .run(agentId, mandateId, 'c'.repeat(64), mandateId);
    legacy.prepare('INSERT INTO agent_unlock_grants(mandate_ref,agent_ref,unlock_ref,token_hash) VALUES (?,?,?,?)')
        .run(mandateId, agentId, 'synthetic-unlock', 'd'.repeat(64));
    legacy.prepare(`INSERT INTO agent_cassettes(id,mandate_ref,agent_ref,actor_ref,archive_generation,public_key,wrapped_private_key,model_provider,allows_clinical_egress,anchor_ciphertext,items_ciphertext,status,revision,deposited_at,modified_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'open',1,?,?)`)
        .run(visitId, mandateId, agentId, actor, generation, 'B' + 'A'.repeat(86) + '=', 'ENC:' + 'A'.repeat(16) + ':' + 'A'.repeat(32), 'openai', 1, '{}', '[]', now, now);
    legacy.pragma('user_version = 17');
    legacy.close();
    return { actor, generation, mandateId, agentId, visitId, now };
}

test('opening schema17 migrates agent_mandates duration ceiling to 24h while preserving all dependent rows and FKs', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mediflow-mandate-v17-v18-'));
    const file = join(directory, 'medical.db');
    try {
        const seeded = seedLegacyV17Archive(file);
        const opened = openVersionedSqliteDatabase(file);
        try {
            assert.equal(opened.pragma('user_version', { simple: true }), CURRENT_SQLITE_SCHEMA_VERSION);
            assert.equal(opened.pragma('foreign_keys', { simple: true }), 1);
            assert.deepEqual(opened.pragma('foreign_key_check'), []);
            assert.equal(opened.prepare('SELECT id FROM agent_mandates WHERE id=?').pluck().get(seeded.mandateId), seeded.mandateId);
            assert.equal(opened.prepare('SELECT id FROM agent_registrations WHERE id=?').pluck().get(seeded.agentId), seeded.agentId);
            assert.equal(opened.prepare('SELECT id FROM agent_cassettes WHERE id=?').pluck().get(seeded.visitId), seeded.visitId);
            const twentyFourHours = randomUUID();
            opened.prepare(`INSERT INTO agent_mandates(id,actor_ref,archive_generation,operations,provider,allows_clinical_egress,public_key,wrapped_private_key,created_at,expires_at)
                VALUES (?,?,?,?,?,?,?,?,?,?)`)
                .run(twentyFourHours, seeded.actor, seeded.generation, JSON.stringify(['visita.apri']), 'openai', 1, 'B' + 'A'.repeat(86) + '=', 'ENC:' + 'A'.repeat(16) + ':' + 'A'.repeat(32), seeded.now, seeded.now + 86400000);
            assert.equal(opened.prepare('SELECT expires_at - created_at FROM agent_mandates WHERE id=?').pluck().get(twentyFourHours), 86400000);
            assert.throws(() => opened.prepare(`INSERT INTO agent_mandates(id,actor_ref,archive_generation,operations,provider,allows_clinical_egress,public_key,wrapped_private_key,created_at,expires_at)
                VALUES (?,?,?,?,?,?,?,?,?,?)`)
                .run(randomUUID(), seeded.actor, seeded.generation, JSON.stringify(['visita.apri']), 'openai', 1, 'B' + 'A'.repeat(86) + '=', 'ENC:' + 'A'.repeat(16) + ':' + 'A'.repeat(32), seeded.now, seeded.now + 86400001), /CHECK constraint failed/u);
        } finally { opened.close(); }
        const originals = readdirSync(directory).filter(name => name.includes('.schema-original-v17-'));
        assert.equal(originals.length, 1);
        const reopened = openVersionedSqliteDatabase(file, target => {
            const connection = new Database(target), exec = connection.exec.bind(connection), prepare = connection.prepare.bind(connection);
            connection.exec = ((sql: string) => { assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP)\b/iu); return exec(sql); }) as typeof connection.exec;
            connection.prepare = ((sql: string) => { assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP)\b/iu); return prepare(sql); }) as typeof connection.prepare;
            return connection;
        });
        reopened.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('a failed v17 to v18 mandate duration rebuild rolls back cleanly and permits retry', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mediflow-mandate-v17-rollback-'));
    const file = join(directory, 'medical.db');
    try {
        const seeded = seedLegacyV17Archive(file);
        assert.throws(() => openVersionedSqliteDatabase(file, target => {
            const connection = new Database(target), exec = connection.exec.bind(connection);
            connection.exec = ((sql: string) => {
                const result = exec(sql);
                if (sql.includes('CREATE TABLE "agent_mandates_duration_upgrade"')) throw new Error('SYNTHETIC_MANDATE_UPGRADE_FAILURE');
                return result;
            }) as typeof connection.exec;
            return connection;
        }), /SYNTHETIC_MANDATE_UPGRADE_FAILURE/);
        const afterFailure = new Database(file, { readonly: true });
        try {
            assert.equal(afterFailure.pragma('user_version', { simple: true }), 17);
            assert.equal(afterFailure.prepare('SELECT id FROM agent_mandates WHERE id=?').pluck().get(seeded.mandateId), seeded.mandateId);
            assert.equal(afterFailure.prepare('SELECT id FROM agent_cassettes WHERE id=?').pluck().get(seeded.visitId), seeded.visitId);
        } finally { afterFailure.close(); }
        assert.equal(readdirSync(directory).filter(name => name.includes('.schema-original-v17-')).length, 0);
        const retried = openVersionedSqliteDatabase(file);
        try {
            assert.equal(retried.pragma('user_version', { simple: true }), CURRENT_SQLITE_SCHEMA_VERSION);
            assert.equal(retried.prepare('SELECT id FROM agent_cassettes WHERE id=?').pluck().get(seeded.visitId), seeded.visitId);
        } finally { retried.close(); }
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
