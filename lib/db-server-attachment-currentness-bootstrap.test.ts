/* @Codex */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const ROOT_DIR = process.cwd();
const O1A_MIGRATION = '0029_document_locator_currentness.sql';
const LEGACY_COLUMNS = [
    'id', 'patient_id', 'name', 'type', 'size', 'path', 'data', 'summary_snapshot',
    'parse_evidence_artifact_snapshot', 'ocr_queue_state', 'ocr_queue_reason',
    'ocr_queue_updated_at', 'ocr_replay_artifact_snapshot', 'created_at',
];

function applyMigrationsThroughP0(dbPath: string): void {
    const db = new Database(dbPath);
    try {
        db.pragma('foreign_keys = OFF');
        for (const file of fs.readdirSync(path.join(ROOT_DIR, 'drizzle')).filter((name) => name.endsWith('.sql') && name < O1A_MIGRATION).sort()) {
            db.exec(fs.readFileSync(path.join(ROOT_DIR, 'drizzle', file), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gm, ''));
        }
    } finally {
        db.close();
    }
}

function seedLegacy(dbPath: string): void {
    const db = new Database(dbPath);
    try {
        db.exec(`
            INSERT INTO patients (id, first_name, last_name, tax_code) VALUES
                ('synthetic-patient-a', 'A', 'A', 'SYN-A'), ('synthetic-patient-b', 'B', 'B', 'SYN-B');
            CREATE INDEX attachments_patient_idx ON attachments(patient_id);
            INSERT INTO attachments (
                id, patient_id, name, type, size, path, data, summary_snapshot,
                parse_evidence_artifact_snapshot, ocr_queue_state, ocr_queue_reason,
                ocr_queue_updated_at, ocr_replay_artifact_snapshot, created_at
            ) VALUES
                ('synthetic-attachment-a', 'synthetic-patient-a', 'Synthetic A', 'application/pdf', 10, 'synthetic/a.pdf', 'alpha', 'summary-a', 'evidence-a', 'queued', 'synthetic', 101, 'replay-a', 100),
                ('synthetic-attachment-b', 'synthetic-patient-b', 'Synthetic B', 'text/plain', 20, 'synthetic/b.txt', 'beta', NULL, NULL, NULL, NULL, NULL, NULL, 200),
                ('synthetic-attachment-c', 'synthetic-patient-a', 'Synthetic C', 'image/png', 30, 'synthetic/c.png', NULL, 'summary-c', 'evidence-c', 'done', 'synthetic', 303, 'replay-c', 300);
        `);
    } finally {
        db.close();
    }
}

function bootstrap(dataDir: string): { status: number | null; output: string } {
    const result = spawnSync(process.execPath, [path.join(ROOT_DIR, 'scripts/run-strip-types.mjs'), path.join(ROOT_DIR, 'scripts/db-server-bootstrap-worker.mjs')], {
        cwd: ROOT_DIR,
        encoding: 'utf8',
        env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir },
    });
    return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function withLegacyDatabase(prefix: string, run: (dbPath: string, dataDir: string) => void): void {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const dbPath = path.join(dataDir, 'medical.db');
    try {
        applyMigrationsThroughP0(dbPath);
        seedLegacy(dbPath);
        run(dbPath, dataDir);
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
}

function attachmentSnapshot(dbPath: string): unknown {
    const db = new Database(dbPath, { readonly: true });
    try {
        return {
            schema: db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE tbl_name = 'attachments' ORDER BY type, name").all(),
            columns: db.prepare("SELECT cid, name, type, \"notnull\", dflt_value, pk, hidden FROM pragma_table_xinfo('attachments') ORDER BY cid").all(),
            foreignKeys: db.prepare("SELECT id, seq, \"table\", \"from\", \"to\", on_update, on_delete, match FROM pragma_foreign_key_list('attachments') ORDER BY id, seq").all(),
            indexes: db.prepare("SELECT name, \"unique\", origin, partial FROM pragma_index_list('attachments') ORDER BY name").all(),
            rows: db.prepare('SELECT * FROM attachments ORDER BY id').all(),
        };
    } finally {
        db.close();
    }
}

test('attachment currentness guard upgrades legacy data and is stable across restart', () => withLegacyDatabase('mediflow-currentness-live-', (dbPath, dataDir) => {
    const beforeDb = new Database(dbPath, { readonly: true });
    const before = beforeDb.prepare(`SELECT ${LEGACY_COLUMNS.join(', ')} FROM attachments ORDER BY id`).all();
    beforeDb.close();

    assert.equal(bootstrap(dataDir).status, 0);
    const db = new Database(dbPath, { readonly: true });
    const after = db.prepare(`SELECT ${LEGACY_COLUMNS.join(', ')} FROM attachments ORDER BY id`).all();
    const firstCurrentness = db.prepare('SELECT document_source_ref, document_revision, document_freshness_epoch FROM attachments ORDER BY id').all() as Array<Record<string, unknown>>;
    assert.deepEqual(after, before);
    assert.equal(new Set(firstCurrentness.map((row) => row.document_source_ref)).size, 3);
    for (const row of firstCurrentness) {
        assert.match(row.document_source_ref as string, /^[0-9a-f]{64}$/u);
        assert.equal(row.document_revision, 1);
        assert.equal(row.document_freshness_epoch, 1);
    }
    assert.ok(db.prepare("SELECT 1 FROM pragma_index_list('attachments') WHERE name = 'attachments_patient_idx'").get());
    assert.deepEqual(db.prepare("SELECT \"from\" || '|' || \"table\" AS value FROM pragma_foreign_key_list('attachments')").all(), [{ value: 'patient_id|patients' }]);
    db.close();

    assert.equal(bootstrap(dataDir).status, 0);
    const restarted = new Database(dbPath, { readonly: true });
    assert.deepEqual(restarted.prepare('SELECT document_source_ref, document_revision, document_freshness_epoch FROM attachments ORDER BY id').all(), firstCurrentness);
    restarted.close();
}));

test('attachment currentness guard rejects partial and non-canonical states without repair', () => {
    for (const state of ['partial', 'noncanonical'] as const) {
        withLegacyDatabase(`mediflow-currentness-${state}-`, (dbPath, dataDir) => {
            const db = new Database(dbPath);
            if (state === 'partial') {
                db.exec('ALTER TABLE attachments ADD COLUMN document_source_ref TEXT;');
            } else {
                db.exec('ALTER TABLE attachments ADD COLUMN document_source_ref TEXT; ALTER TABLE attachments ADD COLUMN document_revision INTEGER; ALTER TABLE attachments ADD COLUMN document_freshness_epoch INTEGER;');
            }
            db.close();

            const result = bootstrap(dataDir);
            assert.notEqual(result.status, 0, result.output);
            const inspect = new Database(dbPath, { readonly: true });
            const columns = inspect.prepare("SELECT name FROM pragma_table_info('attachments') WHERE name LIKE 'document_%' ORDER BY name").all().map((row) => (row as { name: string }).name);
            assert.deepEqual(columns, state === 'partial' ? ['document_source_ref'] : ['document_freshness_epoch', 'document_revision', 'document_source_ref']);
            inspect.close();
        });
    }
});

test('attachment currentness guard rejects drifted legacy fingerprints before rebuild', () => {
    for (const drift of ['extra', 'missing', 'missing-final', 'type', 'index', 'index-collation', 'index-desc', 'constraint', 'deferred-fk', 'generated'] as const) {
        withLegacyDatabase(`mediflow-currentness-legacy-${drift}-`, (dbPath, dataDir) => {
            const db = new Database(dbPath);
            if (drift === 'extra') {
                db.exec("ALTER TABLE attachments ADD COLUMN unexpected_provenance TEXT; UPDATE attachments SET unexpected_provenance = 'preserve-me';");
            } else if (drift === 'missing') {
                db.exec('ALTER TABLE attachments DROP COLUMN summary_snapshot;');
            } else if (drift === 'missing-final') {
                db.exec('ALTER TABLE attachments DROP COLUMN ocr_replay_artifact_snapshot;');
            } else if (drift === 'index') {
                db.exec('DROP INDEX attachments_patient_idx; CREATE INDEX attachments_patient_idx ON attachments(name);');
            } else if (drift === 'index-collation') {
                db.exec('DROP INDEX attachments_patient_idx; CREATE INDEX attachments_patient_idx ON attachments(patient_id COLLATE NOCASE);');
            } else if (drift === 'index-desc') {
                db.exec('DROP INDEX attachments_patient_idx; CREATE INDEX attachments_patient_idx ON attachments(patient_id DESC);');
            } else if (drift === 'type') {
                db.exec(`DROP INDEX attachments_patient_idx; ALTER TABLE attachments RENAME TO attachments_type_drift;
                    CREATE TABLE attachments (
                        id TEXT PRIMARY KEY NOT NULL, patient_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
                        size TEXT NOT NULL, path TEXT NOT NULL, data TEXT, created_at INTEGER DEFAULT (unixepoch()),
                        summary_snapshot TEXT, parse_evidence_artifact_snapshot TEXT, ocr_queue_state TEXT,
                        ocr_queue_reason TEXT, ocr_queue_updated_at INTEGER, ocr_replay_artifact_snapshot TEXT,
                        FOREIGN KEY (patient_id) REFERENCES patients(id) ON UPDATE no action ON DELETE no action
                    ); INSERT INTO attachments SELECT * FROM attachments_type_drift;
                    DROP TABLE attachments_type_drift; CREATE INDEX attachments_patient_idx ON attachments(patient_id);`);
            } else if (drift === 'constraint') {
                db.exec(`DROP INDEX attachments_patient_idx; ALTER TABLE attachments RENAME TO attachments_constraint_drift;
                    CREATE TABLE attachments (
                        id TEXT PRIMARY KEY NOT NULL, patient_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
                        size INTEGER NOT NULL CHECK /* synthetic comment */ (size > 0), path TEXT NOT NULL, data TEXT, created_at INTEGER DEFAULT (unixepoch()),
                        summary_snapshot TEXT, parse_evidence_artifact_snapshot TEXT, ocr_queue_state TEXT,
                        ocr_queue_reason TEXT, ocr_queue_updated_at INTEGER, ocr_replay_artifact_snapshot TEXT,
                        FOREIGN KEY (patient_id) REFERENCES patients(id) ON UPDATE no action ON DELETE no action
                    ); INSERT INTO attachments SELECT * FROM attachments_constraint_drift;
                    DROP TABLE attachments_constraint_drift; CREATE INDEX attachments_patient_idx ON attachments(patient_id);`);
            } else if (drift === 'deferred-fk') {
                db.exec(`DROP INDEX attachments_patient_idx; ALTER TABLE attachments RENAME TO attachments_fk_drift;
                    CREATE TABLE attachments (
                        id TEXT PRIMARY KEY NOT NULL, patient_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
                        size INTEGER NOT NULL, path TEXT NOT NULL, data TEXT, created_at INTEGER DEFAULT (unixepoch()),
                        summary_snapshot TEXT, parse_evidence_artifact_snapshot TEXT, ocr_queue_state TEXT,
                        ocr_queue_reason TEXT, ocr_queue_updated_at INTEGER, ocr_replay_artifact_snapshot TEXT,
                        FOREIGN KEY (patient_id) REFERENCES patients(id) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED
                    ); INSERT INTO attachments SELECT * FROM attachments_fk_drift;
                    DROP TABLE attachments_fk_drift; CREATE INDEX attachments_patient_idx ON attachments(patient_id);`);
            } else {
                db.exec(`DROP INDEX attachments_patient_idx; ALTER TABLE attachments RENAME TO attachments_generated_drift;
                    CREATE TABLE attachments (
                        id TEXT PRIMARY KEY NOT NULL, patient_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
                        size INTEGER NOT NULL, path TEXT NOT NULL, data TEXT, created_at INTEGER DEFAULT (unixepoch()),
                        summary_snapshot TEXT, parse_evidence_artifact_snapshot TEXT, ocr_queue_state TEXT,
                        ocr_queue_reason TEXT, ocr_queue_updated_at INTEGER, ocr_replay_artifact_snapshot TEXT,
                        generated_marker TEXT GENERATED ALWAYS AS (name) VIRTUAL,
                        FOREIGN KEY (patient_id) REFERENCES patients(id) ON UPDATE no action ON DELETE no action
                    ); INSERT INTO attachments (${LEGACY_COLUMNS.join(', ')}) SELECT ${LEGACY_COLUMNS.join(', ')} FROM attachments_generated_drift;
                    DROP TABLE attachments_generated_drift; CREATE INDEX attachments_patient_idx ON attachments(patient_id);`);
            }
            db.close();

            const before = attachmentSnapshot(dbPath);
            const result = bootstrap(dataDir);
            assert.notEqual(result.status, 0, result.output);
            assert.deepEqual(attachmentSnapshot(dbPath), before);
        });
    }
});

test('attachment currentness guard rejects an extra index on canonical O1a state without mutation', () => withLegacyDatabase('mediflow-currentness-extra-index-', (dbPath, dataDir) => {
    assert.equal(bootstrap(dataDir).status, 0);
    const db = new Database(dbPath);
    db.exec('CREATE INDEX unexpected_attachment_idx ON attachments(name);');
    db.close();

    const before = attachmentSnapshot(dbPath);
    const result = bootstrap(dataDir);
    assert.notEqual(result.status, 0, result.output);
    assert.deepEqual(attachmentSnapshot(dbPath), before);
}));

test('attachment currentness guard rolls back malformed legacy data without replacing the source table', () => withLegacyDatabase('mediflow-currentness-malformed-', (dbPath, dataDir) => {
    const db = new Database(dbPath);
    db.exec('DROP INDEX attachments_patient_idx; DROP TABLE attachments;');
    db.exec(`CREATE TABLE attachments (
        id TEXT PRIMARY KEY NOT NULL, patient_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
        size INTEGER NOT NULL, path TEXT, data TEXT, summary_snapshot TEXT, parse_evidence_artifact_snapshot TEXT,
        ocr_queue_state TEXT, ocr_queue_reason TEXT, ocr_queue_updated_at INTEGER,
        ocr_replay_artifact_snapshot TEXT, created_at INTEGER
    ); CREATE INDEX attachments_patient_idx ON attachments(patient_id);
    INSERT INTO attachments (id, patient_id, name, type, size, path) VALUES ('synthetic-malformed', 'synthetic-patient-a', 'Synthetic', 'text/plain', 1, NULL);`);
    db.close();

    const result = bootstrap(dataDir);
    assert.notEqual(result.status, 0, result.output);
    const inspect = new Database(dbPath, { readonly: true });
    assert.deepEqual(inspect.prepare("SELECT name FROM pragma_table_info('attachments') WHERE name LIKE 'document_%'").all(), []);
    assert.deepEqual(inspect.prepare('SELECT id, path FROM attachments').all(), [{ id: 'synthetic-malformed', path: null }]);
    assert.ok(inspect.prepare("SELECT 1 FROM pragma_index_list('attachments') WHERE name = 'attachments_patient_idx'").get());
    inspect.close();
}));
