/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { openAdmittedSqlite } from '../lib/sqlite-maintenance-admission.mjs';
import Database from 'better-sqlite3';

import { applyDocumentEvidenceArtifactsWithCurrentness } from './document-evidence-backfill-currentness-cas';

function database(): Database.Database {
    const db = new Database(':memory:');
    db.exec(`
        create table attachments (
            id text primary key,
            patient_id text not null,
            parse_evidence_artifact_snapshot text check (parse_evidence_artifact_snapshot <> 'reject'),
            document_source_ref text not null,
            document_revision integer not null,
            document_freshness_epoch integer not null
        );
        insert into attachments values ('attachment-1', 'patient-1', null, '${'a'.repeat(64)}', 3, 5);
        insert into attachments values ('attachment-2', 'patient-1', null, '${'b'.repeat(64)}', 1, 1);
    `);
    return db;
}

const candidate = Object.freeze({
    attachmentId: 'attachment-1',
    patientId: 'patient-1',
    sourceRef: 'a'.repeat(64),
    revision: 3,
    freshnessEpoch: 5,
    encryptedArtifact: 'encrypted-artifact',
});

test('writes evidence with exact currentness CAS and advances the tuple once', () => {
    const db = database();
    try {
        assert.deepEqual(applyDocumentEvidenceArtifactsWithCurrentness(db, [candidate]), {
            attempted: 1,
            written: 1,
            skipped: 0,
        });
        assert.deepEqual(db.prepare(`select parse_evidence_artifact_snapshot as artifact,
            document_revision as revision, document_freshness_epoch as freshnessEpoch
            from attachments where id = 'attachment-1'`).get(), {
            artifact: 'encrypted-artifact',
            revision: 4,
            freshnessEpoch: 6,
        });
        assert.deepEqual(applyDocumentEvidenceArtifactsWithCurrentness(db, [candidate]), {
            attempted: 1,
            written: 0,
            skipped: 1,
        });
    } finally {
        db.close();
    }
});

test('skips stale and wrong-patient candidates without changing evidence', () => {
    const db = database();
    try {
        const stale = { ...candidate, revision: 2 };
        const wrongPatient = { ...candidate, patientId: 'patient-2' };
        assert.deepEqual(applyDocumentEvidenceArtifactsWithCurrentness(db, [stale, wrongPatient]), {
            attempted: 2,
            written: 0,
            skipped: 2,
        });
        assert.deepEqual(db.prepare(`select parse_evidence_artifact_snapshot as artifact,
            document_revision as revision, document_freshness_epoch as freshnessEpoch
            from attachments where id = 'attachment-1'`).get(), {
            artifact: null,
            revision: 3,
            freshnessEpoch: 5,
        });
    } finally {
        db.close();
    }
});

test('rejects currentness overflow before opening a transaction or writing evidence', () => {
    const db = database();
    try {
        db.prepare(`update attachments set document_revision = ?, document_freshness_epoch = ?
            where id = 'attachment-1'`).run(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
        const overflow = {
            ...candidate,
            revision: Number.MAX_SAFE_INTEGER,
            freshnessEpoch: Number.MAX_SAFE_INTEGER,
        };
        assert.throws(
            () => applyDocumentEvidenceArtifactsWithCurrentness(db, [overflow]),
            /cannot be advanced safely/u,
        );
        assert.deepEqual(db.prepare(`select parse_evidence_artifact_snapshot as artifact,
            document_revision as revision, document_freshness_epoch as freshnessEpoch
            from attachments where id = 'attachment-1'`).get(), {
            artifact: null,
            revision: Number.MAX_SAFE_INTEGER,
            freshnessEpoch: Number.MAX_SAFE_INTEGER,
        });
    } finally {
        db.close();
    }
});

test('rolls back the complete batch when one update fails', () => {
    const db = database();
    try {
        const rejected = {
            ...candidate,
            attachmentId: 'attachment-2',
            sourceRef: 'b'.repeat(64),
            revision: 1,
            freshnessEpoch: 1,
            encryptedArtifact: 'reject',
        };
        assert.throws(() => applyDocumentEvidenceArtifactsWithCurrentness(db, [candidate, rejected]));
        assert.deepEqual(db.prepare(`select parse_evidence_artifact_snapshot as artifact,
            document_revision as revision, document_freshness_epoch as freshnessEpoch
            from attachments where id = 'attachment-1'`).get(), {
            artifact: null,
            revision: 3,
            freshnessEpoch: 5,
        });
    } finally {
        db.close();
    }
});


test('offline backfill refuses a live archive lease before backup or writes', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'mediflow-backfill-offline-'));
    const filename = path.join(directory, 'medical.db');
    const backup = path.join(directory, 'backup.db');
    const live = openAdmittedSqlite(filename, { role: 'synthetic-live-web' });
    try {
        live.database.exec("CREATE TABLE sentinel (value TEXT); INSERT INTO sentinel VALUES ('unchanged')");
        const result = spawnSync(process.execPath, ['scripts/run-strip-types.mjs',
            'scripts/document-evidence-backfill-live-db.ts', '--db', filename,
            '--apply', '--confirm-apply', 'DOCUMENT_EVIDENCE_ARTIFACTS_ONLY', '--backup-out', backup], {
            cwd: process.cwd(), env: { ...process.env, MEDIFLOW_PIN: 'synthetic-pin' }, encoding: 'utf8', timeout: 15_000,
        });
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /leases did not drain|SQLITE_MAINTENANCE_HOLD/);
        assert.equal(existsSync(backup), false);
        assert.deepEqual(live.database.prepare('SELECT value FROM sentinel').get(), { value: 'unchanged' });
    } finally {
        live.closeSync();
        rmSync(directory, { recursive: true, force: true });
    }
});
