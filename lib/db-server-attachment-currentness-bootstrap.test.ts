/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const ROOT = process.cwd();
const RUNNER = path.join(ROOT, 'scripts/run-strip-types.mjs');
const WORKER = path.join(ROOT, 'scripts/db-server-bootstrap-worker.mjs');
const columns = 'id, patient_id, name, type, size, path, data, created_at, summary_snapshot, parse_evidence_artifact_snapshot, ocr_queue_state, ocr_queue_reason, ocr_queue_updated_at, ocr_replay_artifact_snapshot';
const row = ['attachment.synthetic.1', 'patient.synthetic.1', 'referto.pdf', 'application/pdf', 41, 'attachments/referto.pdf', 'data:application/pdf;base64,c3ludGhldGlj', 1700000000, 'summary', 'evidence', 'queued', 'synthetic', 1700000001, 'replay'];

function prepare(dataDir: string, seed = true): string {
    const dbPath = path.join(dataDir, 'medical.db');
    const db = new Database(dbPath);
    db.pragma('foreign_keys = OFF');
    for (const name of fs.readdirSync(path.join(ROOT, 'drizzle')).filter((file) => file.endsWith('.sql')).sort()) {
        db.exec(fs.readFileSync(path.join(ROOT, 'drizzle', name), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gm, ''));
    }
    if (seed) {
        db.prepare("INSERT INTO patients (id, first_name, last_name, tax_code) VALUES ('patient.synthetic.1', 'Ada', 'Synthetic', 'SYNTHETIC00000000')").run();
        db.prepare(`INSERT INTO attachments (${columns}) VALUES (${row.map(() => '?').join(', ')})`).run(...row);
    }
    db.close();
    return dbPath;
}

function bootstrap(dataDir: string, env: Partial<NodeJS.ProcessEnv> = {}) {
    return spawnSync(process.execPath, [RUNNER, WORKER], {
        cwd: ROOT, env: { ...process.env, ...env, MEDIFLOW_DATA_DIR: dataDir }, encoding: 'utf8',
    });
}

function bootstrapAsync(dataDir: string): Promise<{ code: number | null; output: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [RUNNER, WORKER], {
            cwd: ROOT, env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = ''; child.stdout.on('data', (part) => { output += String(part); }); child.stderr.on('data', (part) => { output += String(part); });
        child.once('error', reject); child.once('close', (code) => resolve({ code, output }));
    });
}

function attachmentSnapshot(dbPath: string) {
    const db = new Database(dbPath);
    try {
        return JSON.stringify({
            objects: db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE tbl_name = 'attachments' OR lower(name) = 'attachments_currentness_legacy' ORDER BY type, name").all(),
            rows: db.prepare('SELECT * FROM attachments ORDER BY id').all(),
        });
    } finally { db.close(); }
}

function tempCase(): { dataDir: string; dbPath: string } {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-o1b-'));
    return { dataDir, dbPath: prepare(dataDir) };
}

test('migrates only the legacy P0 fingerprint and replays canonical source currentness without writes', () => {
    const current = tempCase();
    try {
        const first = bootstrap(current.dataDir); assert.equal(first.status, 0, first.stderr);
        const db = new Database(current.dbPath); let before: string;
        try {
            const migrated = db.prepare(`SELECT ${columns}, document_source_ref, document_revision, document_freshness_epoch FROM attachments`).get() as Record<string, unknown>;
            assert.deepEqual(Object.values(migrated).slice(0, 14), row);
            assert.match(migrated.document_source_ref as string, /^[0-9a-f]{64}$/u);
            assert.equal(migrated.document_revision, 1); assert.equal(migrated.document_freshness_epoch, 1);
            db.prepare("UPDATE attachments SET document_source_ref = ?, document_revision = 7, document_freshness_epoch = 9 WHERE id = ?").run('a'.repeat(64), row[0]);
            before = attachmentSnapshot(current.dbPath);
        } finally { db.close(); }
        const replay = bootstrap(current.dataDir); assert.equal(replay.status, 0, replay.stderr);
        assert.equal(attachmentSnapshot(current.dbPath), before);
    } finally { fs.rmSync(current.dataDir, { recursive: true, force: true }); }
});

test('rejects partial, drifting, generic, triggered, indexed, and stale attachment fingerprints before rename', () => {
    const cases: Array<[string, (db: Database.Database) => void]> = [
        ['partial', (db) => db.exec('ALTER TABLE attachments ADD COLUMN document_source_ref TEXT')],
        ['generic', (db) => db.exec('ALTER TABLE attachments ADD COLUMN generic TEXT')],
        ['trigger', (db) => db.exec('CREATE TRIGGER attachments_drift AFTER INSERT ON attachments BEGIN SELECT 1; END')],
        ['index', (db) => db.exec('CREATE INDEX attachments_drift_idx ON attachments(name)')],
        ['quoted index', (db) => db.exec('CREATE INDEX "attachments_drift_\'; SELECT 1; --" ON attachments(name)')],
        ['unicode index', (db) => db.exec('CREATE INDEX "attachments_drift_\u2066;()" ON attachments(name)')],
        ['stale', (db) => db.exec('CREATE TABLE attachments_currentness_legacy (id TEXT)')],
    ];
    for (const [name, mutate] of cases) {
        const current = tempCase();
        try {
            const db = new Database(current.dbPath); mutate(db); db.close();
            const before = attachmentSnapshot(current.dbPath); const result = bootstrap(current.dataDir);
            assert.notEqual(result.status, 0, name); assert.match(`${result.stdout}${result.stderr}`, /ATTACHMENT_CURRENTNESS_MIGRATION_UNSUPPORTED/u);
            assert.doesNotMatch(`${result.stdout}${result.stderr}`, /attachments_drift_|CREATE INDEX|SELECT 1/u, name);
            assert.equal(attachmentSnapshot(current.dbPath), before, name);
            const reopened = new Database(current.dbPath); try { reopened.transaction(() => undefined).immediate(); } finally { reopened.close(); }
        } finally { fs.rmSync(current.dataDir, { recursive: true, force: true }); }
    }
});

test('rolls back malformed canonical and orphan legacy data without leaving a renamed table', () => {
    const orphan = tempCase();
    try {
        const db = new Database(orphan.dbPath); db.pragma('foreign_keys = OFF');
        db.prepare(`INSERT INTO attachments (${columns}) VALUES (${row.map(() => '?').join(', ')})`).run(...row.map((value, index) => index === 0 ? 'attachment.synthetic.orphan' : index === 1 ? 'patient.orphan' : value)); db.close();
        const before = attachmentSnapshot(orphan.dbPath); const result = bootstrap(orphan.dataDir);
        assert.notEqual(result.status, 0); assert.match(`${result.stdout}${result.stderr}`, /ATTACHMENT_CURRENTNESS_MIGRATION_UNSUPPORTED/u);
        assert.equal(attachmentSnapshot(orphan.dbPath), before);
    } finally { fs.rmSync(orphan.dataDir, { recursive: true, force: true }); }
    const canonical = tempCase();
    try {
        assert.equal(bootstrap(canonical.dataDir).status, 0);
        const db = new Database(canonical.dbPath); db.pragma('ignore_check_constraints = ON'); db.prepare("UPDATE attachments SET document_source_ref = 'UPPERCASE'").run(); db.close();
        const before = attachmentSnapshot(canonical.dbPath); const result = bootstrap(canonical.dataDir);
        assert.notEqual(result.status, 0); assert.match(`${result.stdout}${result.stderr}`, /ATTACHMENT_CURRENTNESS_MIGRATION_UNSUPPORTED/u);
        assert.equal(attachmentSnapshot(canonical.dbPath), before);
    } finally { fs.rmSync(canonical.dataDir, { recursive: true, force: true }); }
});

test('production build bootstrap leaves persistent attachment storage unopened and unchanged', () => {
    const current = tempCase();
    try {
        const db = new Database(current.dbPath);
        db.exec('ALTER TABLE attachments ADD COLUMN unsupported_build_fixture TEXT');
        db.close();
        const before = attachmentSnapshot(current.dbPath);

        const result = bootstrap(current.dataDir, { NEXT_PHASE: 'phase-production-build' });

        assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
        assert.match(result.stdout, /\[db-bootstrap-worker\] ready/u);
        assert.equal(attachmentSnapshot(current.dbPath), before);
    } finally { fs.rmSync(current.dataDir, { recursive: true, force: true }); }
});

test('serializes concurrent O1b workers without busy errors or duplicate renames', { timeout: 30_000 }, async () => {
    const current = tempCase();
    try {
        const results = await Promise.all(Array.from({ length: 9 }, () => bootstrapAsync(current.dataDir)));
        for (const result of results) { assert.equal(result.code, 0, result.output); assert.doesNotMatch(result.output, /SQLITE_BUSY|locked|duplicate/i); }
        const db = new Database(current.dbPath); try {
            assert.equal((db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE lower(name) = 'attachments_currentness_legacy'").get() as { count: number }).count, 0);
            assert.equal((db.prepare('SELECT document_revision FROM attachments').get() as { document_revision: number }).document_revision, 1);
        } finally { db.close(); }
    } finally { fs.rmSync(current.dataDir, { recursive: true, force: true }); }
});

/* @Codex */
// Historical installed schema: currentness exists, but created_at follows OCR
// metadata and the counters have no safe-integer upper-bound constraint.
function historicalCurrentness(dbPath: string): void {
    const db = new Database(dbPath);
    try {
        db.exec(`ALTER TABLE attachments RENAME TO historical_fixture;
            CREATE TABLE attachments (
                id TEXT PRIMARY KEY NOT NULL, patient_id TEXT NOT NULL, name TEXT NOT NULL,
                type TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL, data TEXT,
                summary_snapshot TEXT, parse_evidence_artifact_snapshot TEXT,
                ocr_queue_state TEXT, ocr_queue_reason TEXT, ocr_queue_updated_at INTEGER,
                ocr_replay_artifact_snapshot TEXT, created_at INTEGER DEFAULT (unixepoch()),
                document_source_ref TEXT NOT NULL UNIQUE CHECK (
                    length(document_source_ref) = 64 AND document_source_ref NOT GLOB '*[^0-9a-f]*'
                ),
                document_revision INTEGER NOT NULL CHECK (
                    typeof(document_revision) = 'integer' AND document_revision >= 1
                ),
                document_freshness_epoch INTEGER NOT NULL CHECK (
                    typeof(document_freshness_epoch) = 'integer' AND document_freshness_epoch >= 1
                ),
                FOREIGN KEY (patient_id) REFERENCES patients(id) ON UPDATE NO ACTION ON DELETE NO ACTION
            );
            INSERT INTO attachments (${columns}, document_source_ref, document_revision, document_freshness_epoch)
                SELECT ${columns}, '${'b'.repeat(64)}', 7, 9 FROM historical_fixture;
            DROP TABLE historical_fixture;
            CREATE INDEX attachments_patient_idx ON attachments(patient_id)`);
    } finally { db.close(); }
}

/* @Codex */
test('upgrades historical installed currentness preserving every value and replays without changes', async () => {
    const current = tempCase();
    try {
        historicalCurrentness(current.dbPath);
        const before = JSON.parse(attachmentSnapshot(current.dbPath)).rows;
        const results = await Promise.all(Array.from({ length: 3 }, () => bootstrapAsync(current.dataDir)));
        for (const result of results) assert.equal(result.code, 0, result.output);
        assert.deepEqual(JSON.parse(attachmentSnapshot(current.dbPath)).rows, before);
        const migrated = attachmentSnapshot(current.dbPath);
        assert.equal(bootstrap(current.dataDir).status, 0);
        assert.equal(attachmentSnapshot(current.dbPath), migrated);
        const db = new Database(current.dbPath);
        try {
            for (const counter of ['document_revision', 'document_freshness_epoch']) {
                assert.throws(() => db.exec(`UPDATE attachments SET ${counter} = 9007199254740992`), /CHECK constraint failed/u);
            }
        } finally { db.close(); }
    } finally { fs.rmSync(current.dataDir, { recursive: true, force: true }); }
});

/* @Codex */
test('historical currentness rejects invalid counters and schema drift atomically', () => {
    for (const mutation of [
        'UPDATE attachments SET document_revision = 9007199254740992',
        'UPDATE attachments SET document_freshness_epoch = 9007199254740992',
        "PRAGMA ignore_check_constraints = ON; UPDATE attachments SET document_source_ref = 'invalid'",
        'ALTER TABLE attachments ADD COLUMN unknown_metadata TEXT',
        'CREATE INDEX unexpected_index ON attachments(name)',
    ]) {
        const current = tempCase();
        try {
            historicalCurrentness(current.dbPath);
            const db = new Database(current.dbPath); db.exec(mutation); db.close();
            const before = attachmentSnapshot(current.dbPath);
            const result = bootstrap(current.dataDir);
            assert.notEqual(result.status, 0);
            assert.match(`${result.stdout}${result.stderr}`, /ATTACHMENT_CURRENTNESS_MIGRATION_UNSUPPORTED/u);
            assert.equal(attachmentSnapshot(current.dbPath), before);
        } finally { fs.rmSync(current.dataDir, { recursive: true, force: true }); }
    }
});
