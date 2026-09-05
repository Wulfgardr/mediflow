import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION_NAME = '0028_attachments_runtime_columns.sql';
const EXPECTED_COLUMNS = new Map([
    ['summary_snapshot', 'TEXT'],
    ['parse_evidence_artifact_snapshot', 'TEXT'],
    ['ocr_queue_state', 'TEXT'],
    ['ocr_queue_reason', 'TEXT'],
    ['ocr_queue_updated_at', 'INTEGER'],
    ['ocr_replay_artifact_snapshot', 'TEXT'],
]);

function applyFreshMigrationChain(dbPath) {
    const files = fs.readdirSync(path.join(ROOT_DIR, 'drizzle'))
        .filter((file) => file.endsWith('.sql'))
        .sort((left, right) => left.localeCompare(right));
    assert.ok(files.includes(MIGRATION_NAME), `${MIGRATION_NAME} must exist`);

    const db = new Database(dbPath);
    try {
        db.pragma('foreign_keys = OFF');
        for (const file of files) {
            if (file === MIGRATION_NAME) {
                db.exec('CREATE INDEX attachments_patient_idx ON attachments(patient_id);');
            }
            db.exec(fs.readFileSync(path.join(ROOT_DIR, 'drizzle', file), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
        }
    } finally {
        db.close();
    }
}

test('P0 normalizes the fresh attachments SQL baseline without changing existing columns or indices', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-0028-runtime-columns-'));
    const dbPath = path.join(dir, 'medical.db');
    try {
        applyFreshMigrationChain(dbPath);
        const db = new Database(dbPath, { readonly: true });
        try {
            const columns = new Map(db.prepare('PRAGMA table_info(attachments)').all().map((column) => [column.name, column.type]));
            for (const [name, type] of EXPECTED_COLUMNS) assert.equal(columns.get(name), type, name);
            for (const name of ['id', 'patient_id', 'name', 'type', 'size', 'path', 'data', 'created_at']) assert.ok(columns.has(name), name);
            assert.ok(db.prepare("SELECT 1 FROM pragma_index_list('attachments') WHERE name = 'attachments_patient_idx'").get());
        } finally {
            db.close();
        }

        const result = spawnSync(process.execPath, [path.join(ROOT_DIR, 'scripts', 'check-schema-drift.mjs')], {
            encoding: 'utf8',
            env: { ...process.env, MEDIFLOW_STRIP_TYPES_NODE: process.execPath },
        });
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
