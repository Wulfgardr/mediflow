import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { initializeSqliteSchema } from './sqlite-schema';
import { CURRENT_SQLITE_SCHEMA_VERSION, openVersionedSqliteDatabase } from './sqlite-schema-open';
import { assertAmbulatoryCommandPredecessorRecoverySchema } from './ambulatory-destructive-command-recovery-schema';

test('v15 admission preserves its original and migrates to the current version with empty registration authority', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-schema-'));
    const file = path.join(root, 'medical.db');
    try {
        const predecessor = new Database(file);
        initializeSqliteSchema(predecessor);
        predecessor.exec('DROP TABLE entry_revisions; DROP TABLE agent_unlock_grants; DROP TABLE agent_registrations');
        predecessor.pragma('user_version=15');
        assertAmbulatoryCommandPredecessorRecoverySchema(predecessor);
        predecessor.close();
        const migrated = openVersionedSqliteDatabase(file);
        try {
            assert.equal(migrated.pragma('user_version', { simple: true }), CURRENT_SQLITE_SCHEMA_VERSION);
            assert.equal(migrated.prepare('SELECT count(*) FROM agent_registrations').pluck().get(), 0);
            assert.equal(migrated.prepare('SELECT count(*) FROM agent_unlock_grants').pluck().get(), 0);
        } finally { migrated.close(); }
        const copies = fs.readdirSync(root).filter(name => name.startsWith('medical.db.schema-original-v15-'));
        assert.equal(copies.length, 1);
        const original = new Database(path.join(root, copies[0]), { readonly: true });
        try { assertAmbulatoryCommandPredecessorRecoverySchema(original); }
        finally { original.close(); }
        openVersionedSqliteDatabase(file).close();
        assert.equal(fs.readdirSync(root).filter(name => name.startsWith('medical.db.schema-original-')).length, 1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
