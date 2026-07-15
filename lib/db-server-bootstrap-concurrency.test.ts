/* @Codex */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const ROOT_DIR = process.cwd();
const WORKER_COUNT = 13;

function applyBaseMigrations(dbPath: string): void {
    const db = new Database(dbPath);
    const migrationFiles = fs
        .readdirSync(path.join(ROOT_DIR, 'drizzle'))
        .filter((file) => file.endsWith('.sql'))
        .sort((left, right) => left.localeCompare(right));

    db.pragma('foreign_keys = OFF');
    try {
        for (const fileName of migrationFiles) {
            const sql = fs
                .readFileSync(path.join(ROOT_DIR, 'drizzle', fileName), 'utf8')
                .replace(/^-->\s+statement-breakpoint\s*$/gm, '');
            if (sql.trim().length > 0) db.exec(sql);
        }
    } finally {
        db.close();
    }
}

function runBootstrapWorker(dataDir: string): Promise<{ code: number | null; output: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            [
                path.join(ROOT_DIR, 'scripts/run-strip-types.mjs'),
                path.join(ROOT_DIR, 'scripts/db-server-bootstrap-worker.mjs'),
            ],
            {
                cwd: ROOT_DIR,
                env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir },
                stdio: ['ignore', 'pipe', 'pipe'],
            },
        );
        let output = '';
        child.stdout.on('data', (chunk) => { output += String(chunk); });
        child.stderr.on('data', (chunk) => { output += String(chunk); });
        child.once('error', reject);
        child.once('close', (code) => resolve({ code, output }));
    });
}

test('schema guards serialize across Next-style build workers', { timeout: 30_000 }, async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-db-bootstrap-'));
    const dbPath = path.join(dataDir, 'medical.db');

    try {
        applyBaseMigrations(dbPath);
        const results = await Promise.all(
            Array.from({ length: WORKER_COUNT }, () => runBootstrapWorker(dataDir)),
        );

        for (const [index, result] of results.entries()) {
            assert.equal(result.code, 0, `worker ${index} failed:\n${result.output}`);
            assert.doesNotMatch(result.output, /SQLITE_BUSY|database is locked|duplicate column/i);
        }

        const db = new Database(dbPath, { readonly: true, fileMustExist: true });
        try {
            const patientColumns = db
                .prepare('PRAGMA table_info(patients)')
                .all()
                .map((row) => (row as { name: string }).name);
            assert.ok(patientColumns.includes('monitoring_profile'));
        } finally {
            db.close();
        }
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});
