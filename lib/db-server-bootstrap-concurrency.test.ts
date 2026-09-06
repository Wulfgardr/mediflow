/* @Codex */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { bootstrapEmptySqliteDatabase } from './sqlite-new-database-bootstrap';

const ROOT_DIR = process.cwd();
const WORKER_COUNT = 13;
const FRESH_BOOT_TABLES = [
    'ambulatories',
    'users',
    'patients',
    'patients_to_ambulatories',
    'entries',
    'therapies',
    'checkups',
    'attachments',
    'headless_soap_active_role_attestations',
    'headless_checkup_active_role_attestations',
] as const;

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

/* @Codex */
test('new-database bootstrap refuses a non-empty unknown schema', () => {
    const db = new Database(':memory:');
    try {
        db.exec('CREATE TABLE external_sentinel (id TEXT PRIMARY KEY NOT NULL)');
        assert.equal(bootstrapEmptySqliteDatabase(db), false);
        assert.equal(
            db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ambulatories'").get(),
            undefined,
        );
    } finally {
        db.close();
    }
});

/* @Codex */
test('new-database bootstrap preserves application tables with a sqlite-like prefix', () => {
    const db = new Database(':memory:');
    try {
        db.exec('CREATE TABLE sqliteXsentinel (id TEXT PRIMARY KEY NOT NULL)');
        assert.equal(bootstrapEmptySqliteDatabase(db), false);
        assert.deepEqual(
            db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all(),
            [{ name: 'sqliteXsentinel' }],
        );
    } finally {
        db.close();
    }
});

/* @Codex */
test('fresh data directory bootstraps the base schema before runtime guards', { timeout: 30_000 }, async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-db-fresh-bootstrap-'));
    const dbPath = path.join(dataDir, 'medical.db');

    try {
        const result = await runBootstrapWorker(dataDir);
        assert.equal(result.code, 0, result.output);
        assert.doesNotMatch(result.output, /no such table|schema is incompatible|schema is unavailable/i);

        let firstSchema: unknown;
        const db = new Database(dbPath, { readonly: true, fileMustExist: true });
        try {
            const tables = new Set(
                (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
                    .map((row) => row.name),
            );
            for (const table of FRESH_BOOT_TABLES) {
                assert.ok(tables.has(table), `missing fresh-boot table: ${table}`);
                assert.deepEqual(db.prepare(`SELECT count(*) AS count FROM "${table}"`).get(), { count: 0 });
            }
            assert.deepEqual(db.pragma('foreign_key_check'), []);
            firstSchema = db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all();
        } finally {
            db.close();
        }

        const restarted = await runBootstrapWorker(dataDir);
        assert.equal(restarted.code, 0, restarted.output);
        const reopened = new Database(dbPath, { readonly: true, fileMustExist: true });
        try {
            assert.deepEqual(
                reopened.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all(),
                firstSchema,
            );
            for (const table of FRESH_BOOT_TABLES) {
                assert.deepEqual(reopened.prepare(`SELECT count(*) AS count FROM "${table}"`).get(), { count: 0 });
            }
        } finally {
            reopened.close();
        }
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

/* @Codex */
test('concurrent first starts serialize on a genuinely empty database', { timeout: 30_000 }, async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-db-fresh-concurrent-'));
    try {
        const results = await Promise.all(
            Array.from({ length: WORKER_COUNT }, () => runBootstrapWorker(dataDir)),
        );
        for (const [index, result] of results.entries()) {
            assert.equal(result.code, 0, `fresh worker ${index} failed:\n${result.output}`);
            assert.doesNotMatch(result.output, /SQLITE_BUSY|database is locked|duplicate column|no such table/i);
        }
        const db = new Database(path.join(dataDir, 'medical.db'), { readonly: true, fileMustExist: true });
        try {
            for (const table of FRESH_BOOT_TABLES) {
                assert.deepEqual(db.prepare(`SELECT count(*) AS count FROM "${table}"`).get(), { count: 0 });
            }
            assert.deepEqual(db.pragma('foreign_key_check'), []);
        } finally {
            db.close();
        }
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

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
