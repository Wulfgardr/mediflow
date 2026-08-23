import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION_NAME = '0029_document_locator_currentness.sql';
const LEGACY_COLUMNS = [
    'id', 'patient_id', 'name', 'type', 'size', 'path', 'data', 'summary_snapshot',
    'parse_evidence_artifact_snapshot', 'ocr_queue_state', 'ocr_queue_reason',
    'ocr_queue_updated_at', 'ocr_replay_artifact_snapshot', 'created_at',
];

function migrationSql() {
    return fs.readFileSync(path.join(ROOT_DIR, 'drizzle', MIGRATION_NAME), 'utf8');
}

function applyThroughP0(db) {
    const files = fs.readdirSync(path.join(ROOT_DIR, 'drizzle'))
        .filter((file) => file.endsWith('.sql') && file < MIGRATION_NAME)
        .sort((left, right) => left.localeCompare(right));
    for (const file of files) db.exec(fs.readFileSync(path.join(ROOT_DIR, 'drizzle', file), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
    db.exec('CREATE INDEX attachments_patient_idx ON attachments(patient_id);');
    db.exec(`INSERT INTO patients (id, first_name, last_name, tax_code) VALUES ('synthetic-patient-a', 'A', 'A', 'SYN-A'), ('synthetic-patient-b', 'B', 'B', 'SYN-B');`);
}

function seedLegacyRows(db) {
    db.exec(`
        INSERT INTO attachments (
            id, patient_id, name, type, size, path, data, summary_snapshot,
            parse_evidence_artifact_snapshot, ocr_queue_state, ocr_queue_reason,
            ocr_queue_updated_at, ocr_replay_artifact_snapshot, created_at
        ) VALUES
            ('synthetic-attachment-a', 'synthetic-patient-a', 'Synthetic A', 'application/pdf', 10, 'synthetic/a.pdf', 'alpha', 'summary-a', 'evidence-a', 'queued', 'synthetic', 101, 'replay-a', 100),
            ('synthetic-attachment-b', 'synthetic-patient-b', 'Synthetic B', 'text/plain', 20, 'synthetic/b.txt', 'beta', NULL, NULL, NULL, NULL, NULL, NULL, 200),
            ('synthetic-attachment-c', 'synthetic-patient-a', 'Synthetic C', 'image/png', 30, 'synthetic/c.png', NULL, 'summary-c', 'evidence-c', 'done', 'synthetic', 303, 'replay-c', 300);
    `);
}

function withDatabase(prefix, run) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const db = new Database(path.join(dir, 'medical.db'));
    try {
        return run(db);
    } finally {
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('O1a rebuilds fresh-baseline attachments with opaque currentness fields', () => withDatabase('mediflow-0029-currentness-', (db) => {
    applyThroughP0(db);
    seedLegacyRows(db);
    const before = db.prepare(`SELECT ${LEGACY_COLUMNS.join(', ')} FROM attachments ORDER BY id`).all();

    db.exec(migrationSql());

    const after = db.prepare(`SELECT ${LEGACY_COLUMNS.join(', ')} FROM attachments ORDER BY id`).all();
    assert.deepEqual(after, before);
    const currentness = db.prepare('SELECT document_source_ref, document_revision, document_freshness_epoch FROM attachments ORDER BY id').all();
    assert.equal(currentness.length, 3);
    assert.equal(new Set(currentness.map((row) => row.document_source_ref)).size, 3);
    for (const row of currentness) {
        assert.match(row.document_source_ref, /^[0-9a-f]{64}$/u);
        assert.equal(row.document_revision, 1);
        assert.equal(row.document_freshness_epoch, 1);
    }
    assert.ok(db.prepare("SELECT 1 FROM pragma_index_list('attachments') WHERE name = 'attachments_patient_idx'").get());
    assert.deepEqual(db.prepare("SELECT \"from\" || '|' || \"table\" AS value FROM pragma_foreign_key_list('attachments')").all(), [{ value: 'patient_id|patients' }]);

    db.pragma('foreign_keys = ON');
    const sourceRef = currentness[0].document_source_ref;
    for (const values of [
        "'missing-ref', 'synthetic-patient-a', 'Synthetic', 'text/plain', 1, 'synthetic', NULL, 1, 1",
        `'duplicate-ref', 'synthetic-patient-a', 'Synthetic', 'text/plain', 1, 'synthetic', '${sourceRef}', 1, 1`,
        "'zero-revision', 'synthetic-patient-a', 'Synthetic', 'text/plain', 1, 'synthetic', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 0, 1",
        "'zero-epoch', 'synthetic-patient-a', 'Synthetic', 'text/plain', 1, 'synthetic', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 1, 0",
        "'bad-fk', 'missing-patient', 'Synthetic', 'text/plain', 1, 'synthetic', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 1, 1",
    ]) {
        assert.throws(() => db.exec(`INSERT INTO attachments (id, patient_id, name, type, size, path, document_source_ref, document_revision, document_freshness_epoch) VALUES (${values});`));
    }
}));

test('O1a rolls back the rebuild when legacy data violates preserved constraints', () => withDatabase('mediflow-0029-rollback-', (db) => {
    applyThroughP0(db);
    db.exec('DROP INDEX attachments_patient_idx; DROP TABLE attachments;');
    db.exec(`CREATE TABLE attachments (
        id TEXT PRIMARY KEY NOT NULL, patient_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
        size INTEGER NOT NULL, path TEXT, data TEXT, summary_snapshot TEXT, parse_evidence_artifact_snapshot TEXT,
        ocr_queue_state TEXT, ocr_queue_reason TEXT, ocr_queue_updated_at INTEGER,
        ocr_replay_artifact_snapshot TEXT, created_at INTEGER
    ); CREATE INDEX attachments_patient_idx ON attachments(patient_id);
    INSERT INTO attachments (id, patient_id, name, type, size, path) VALUES ('synthetic-malformed', 'synthetic-patient-a', 'Synthetic', 'text/plain', 1, NULL);`);

    assert.throws(() => db.exec(migrationSql()));
    assert.deepEqual(db.prepare("SELECT name FROM pragma_table_info('attachments') WHERE name LIKE 'document_%'").all(), []);
    assert.deepEqual(db.prepare('SELECT id, path FROM attachments').all(), [{ id: 'synthetic-malformed', path: null }]);
    assert.ok(db.prepare("SELECT 1 FROM pragma_index_list('attachments') WHERE name = 'attachments_patient_idx'").get());
}));
