/* @Codex */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const root = process.cwd();

function applyMigrations(dbPath: string): void {
    const db = new Database(dbPath);
    try {
        for (const file of fs.readdirSync(path.join(root, 'drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
            db.exec(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8').replace(/^-->\\s+statement-breakpoint\\s*$/gmu, ''));
        }
    } finally { db.close(); }
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

function inactiveRow(ref: string, actor = 'actor-h2a-s0'): string[] {
    return [ref, actor, 'mediflow.headless-soap-active-role-attestation.v1', 'physician', 'mediflow.clinical_diary.append_soap.v1', 'clinician_confirmed_single_use.v1', 'inactive'];
}

test('Headless SOAP attestation bootstrap is concurrent, canonical, and fail-closed', { timeout: 30_000 }, async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-h2a-s0-'));
    const dbPath = path.join(dataDir, 'medical.db');
    try {
        applyMigrations(dbPath);
        let db = new Database(dbPath);
        db.exec('DROP TABLE headless_soap_active_role_attestations');
        db.close();

        const workers = await Promise.all(Array.from({ length: 5 }, () => bootstrap(dataDir)));
        for (const worker of workers) {
            assert.equal(worker.code, 0, worker.output);
            assert.doesNotMatch(worker.output, /locked|busy|duplicate column/i);
        }

        db = new Database(dbPath);
        db.pragma('foreign_keys = ON');
        db.prepare('INSERT INTO users (id, username, password_hash, encrypted_master_key, salt) VALUES (?, ?, ?, ?, ?)')
            .run('actor-h2a-s0', 'actor-h2a-s0', 'synthetic', 'synthetic', 'synthetic');
        const insert = db.prepare(`INSERT INTO headless_soap_active_role_attestations
            (attestation_ref, actor_ref, schema_version, role, operation_id, policy_version, status, attestation_version) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`);
        insert.run(...inactiveRow('attestation-h2a-s0'));
        assert.throws(() => insert.run(...inactiveRow('wrong-operation-h2a-s0').map((value, index) => index === 4 ? 'wrong.operation' : value)));
        assert.throws(() => insert.run(...inactiveRow('missing-actor-h2a-s0', 'missing-actor')));
        db.close();

        db = new Database(dbPath);
        db.pragma('foreign_keys = OFF');
        db.prepare(`INSERT INTO headless_soap_active_role_attestations
            (attestation_ref, actor_ref, schema_version, role, operation_id, policy_version, status, attestation_version)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1)`).run(...inactiveRow('orphan-h2a-s0', 'missing-actor'));
        db.close();
        const orphan = await bootstrap(dataDir);
        assert.notEqual(orphan.code, 0);
        assert.match(orphan.output, /Headless SOAP active-role attestation schema is incompatible\./);
        db = new Database(dbPath);
        db.prepare('DELETE FROM headless_soap_active_role_attestations WHERE attestation_ref = ?').run('orphan-h2a-s0');
        db.close();

        db = new Database(dbPath);
        db.exec('DROP TABLE headless_soap_active_role_attestations; CREATE TABLE headless_soap_active_role_attestations (attestation_ref TEXT PRIMARY KEY)');
        db.close();
        const denied = await bootstrap(dataDir);
        assert.notEqual(denied.code, 0);
        assert.match(denied.output, /Headless SOAP active-role attestation schema is incompatible\./);
        assert.doesNotMatch(denied.output, /headless_soap_active_role_attestations/i);

        db = new Database(dbPath);
        db.exec('BEGIN IMMEDIATE; CREATE TABLE h2a_s0_reusable_transaction_probe (id INTEGER); ROLLBACK;');
        db.close();
    } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});
