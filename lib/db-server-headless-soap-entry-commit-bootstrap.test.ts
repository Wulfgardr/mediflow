/* @Codex */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

const root = process.cwd();

function applyMigrations(dbPath: string): void {
    const database = new Database(dbPath);
    try {
        for (const file of fs.readdirSync(path.join(root, 'drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
            database.exec(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8')
                .replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
        }
    } finally { database.close(); }
}

function bootstrap(dataDir: string): Promise<{ code: number | null; output: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [
            path.join(root, 'scripts/run-strip-types.mjs'),
            path.join(root, 'scripts/db-server-bootstrap-worker.mjs'),
        ], { cwd: root, env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        child.stdout.on('data', (chunk) => { output += String(chunk); });
        child.stderr.on('data', (chunk) => { output += String(chunk); });
        child.once('error', reject);
        child.once('close', (code) => resolve({ code, output }));
    });
}

test('Headless SOAP commit ledger bootstrap is concurrent, canonical, and fail-closed', { timeout: 30_000 }, async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-h7b-bootstrap-'));
    const dbPath = path.join(dataDir, 'medical.db');
    try {
        applyMigrations(dbPath);
        let database = new Database(dbPath);
        database.exec('DROP TABLE headless_soap_entry_commits');
        database.close();

        const workers = await Promise.all(Array.from({ length: 4 }, () => bootstrap(dataDir)));
        for (const worker of workers) {
            assert.equal(worker.code, 0, worker.output);
            assert.doesNotMatch(worker.output, /locked|busy|duplicate column/i);
        }

        database = new Database(dbPath);
        database.pragma('foreign_keys = ON');
        const columns = database.prepare('PRAGMA table_info(headless_soap_entry_commits)').all()
            .map((row) => (row as { name: string }).name);
        assert.deepEqual(columns, [
            'idempotency_key', 'approval_ref', 'authorization_proof_digest', 'command_id', 'entry_id',
            'audit_event_id', 'receipt_ref', 'binding_snapshot', 'binding_digest', 'entry_digest',
            'audit_snapshot', 'audit_digest', 'receipt_snapshot', 'receipt_digest', 'committed_at',
        ]);
        const indices = database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? ORDER BY name")
            .all('headless_soap_entry_commits').map((row) => (row as { name: string }).name);
        assert.deepEqual(indices, [
            'headless_soap_entry_commits_audit_event_id_unique',
            'headless_soap_entry_commits_command_id_unique',
            'headless_soap_entry_commits_entry_id_unique',
            'headless_soap_entry_commits_receipt_ref_unique',
            'sqlite_autoindex_headless_soap_entry_commits_1',
        ]);
        database.close();

        database = new Database(dbPath);
        database.exec('DROP TABLE headless_soap_entry_commits; CREATE TABLE headless_soap_entry_commits (idempotency_key TEXT PRIMARY KEY)');
        database.close();
        const denied = await bootstrap(dataDir);
        assert.notEqual(denied.code, 0);
        assert.match(denied.output, /Headless SOAP entry commit schema is incompatible\./);
        assert.doesNotMatch(denied.output, /CREATE TABLE|binding_snapshot|audit_snapshot/i);
    } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});
