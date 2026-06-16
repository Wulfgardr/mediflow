/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildDocumentSourceProvenanceAuditReport,
} from './document-source-provenance-audit';

test('buildDocumentSourceProvenanceAuditReport classifies stored binaries before fallback sources', () => {
    const report = buildDocumentSourceProvenanceAuditReport([
        {
            id: 'att-stored',
            patientId: 'patient-a',
            fileName: 'referto.pdf',
            mimeType: 'application/pdf',
            storedBinaryBytes: 120_000,
            summarySnapshotChars: 120,
        },
    ]);

    assert.equal(report.safety.readOnly, true);
    assert.equal(report.safety.writesAttempted, 0);
    assert.equal(report.safety.rawTextIncluded, false);
    assert.equal(report.items[0].category, 'stored_binary');
    assert.equal(report.items[0].nextStep, 'use_existing_stored_binary_for_reviewable_planner');
});

test('buildDocumentSourceProvenanceAuditReport keeps summary-only rows separate from archive recovery', () => {
    const report = buildDocumentSourceProvenanceAuditReport([
        {
            id: 'att-summary',
            patientId: 'patient-a',
            fileName: 'relazione.pdf',
            summarySnapshotChars: 80,
            archiveCandidates: [
                { matchKind: 'filename', patientScoped: true, collisionCount: 1 },
            ],
        },
    ]);

    assert.equal(report.items[0].category, 'summary_only');
    assert.equal(report.items[0].nextStep, 'summary_only_reviewable_backfill_candidate');
});

test('buildDocumentSourceProvenanceAuditReport accepts one strong patient-scoped archive candidate', () => {
    const report = buildDocumentSourceProvenanceAuditReport([
        {
            id: 'att-archive',
            patientId: 'patient-a',
            fileName: 'dimissione.pdf',
            archiveCandidates: [
                { matchKind: 'filename', patientScoped: true, collisionCount: 1 },
            ],
        },
    ]);

    assert.equal(report.items[0].category, 'archive_match_candidate');
    assert.equal(report.items[0].nextStep, 'review_archive_match_then_reuse_wul_202_gate');
    assert.equal(report.items[0].evidence.safeArchiveCandidateCount, 1);
});

test('buildDocumentSourceProvenanceAuditReport excludes ambiguous or weak archive candidates', () => {
    const report = buildDocumentSourceProvenanceAuditReport([
        {
            id: 'att-ambiguous-collision',
            patientId: 'patient-a',
            fileName: 'referto.pdf',
            archiveCandidates: [
                { matchKind: 'filename', patientScoped: true, collisionCount: 2 },
            ],
        },
        {
            id: 'att-ambiguous-size',
            patientId: 'patient-a',
            fileName: 'referto.pdf',
            archiveCandidates: [
                { matchKind: 'byte_size', patientScoped: true, collisionCount: 1 },
            ],
        },
        {
            id: 'att-ambiguous-scope',
            patientId: 'patient-a',
            fileName: 'referto.pdf',
            archiveCandidates: [
                { matchKind: 'hash', patientScoped: false, collisionCount: 1 },
            ],
        },
    ]);

    assert.deepEqual(report.items.map((item) => item.category), [
        'ambiguous',
        'ambiguous',
        'ambiguous',
    ]);
    assert.equal(report.totals.ambiguous, 3);
});

test('buildDocumentSourceProvenanceAuditReport marks rows unrecoverable without any usable source', () => {
    const report = buildDocumentSourceProvenanceAuditReport([
        {
            id: 'att-empty',
            patientId: 'patient-a',
            fileName: 'vuoto.jpg',
            summarySnapshotChars: 0,
            hasStoredBinary: false,
        },
        {
            id: 'att-summary-unknown-length',
            patientId: 'patient-a',
            fileName: 'unknown-summary.pdf',
            hasSummarySnapshot: true,
        },
    ]);

    assert.equal(report.items[0].category, 'unrecoverable');
    assert.equal(report.items[0].nextStep, 'mark_unrecoverable_without_new_source');
    assert.equal(report.items[1].category, 'unrecoverable');
    assert.equal(report.totals.unrecoverable, 2);
});
