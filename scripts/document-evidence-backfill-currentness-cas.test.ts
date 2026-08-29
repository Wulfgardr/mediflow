/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
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
