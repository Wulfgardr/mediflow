/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MEDIFLOW_EVIDENCE_QUEUE_SCHEMA_VERSION,
    buildEvidenceQueue,
    getIncludedEvidenceQueueItems,
} from './evidence-queue-contract';
import {
    buildDocumentParseEvidenceArtifact,
    serializeDocumentParseEvidenceArtifact,
} from './document-parse-evidence-artifact';

test('buildEvidenceQueue accepts WUL-152 parse/evidence artifacts as included attachment evidence', () => {
    const artifact = buildDocumentParseEvidenceArtifact({
        documentInsightId: 'insight-1',
        attachmentId: 'attachment-1',
        fileName: 'dimissione.pdf',
        documentDate: '2026-04-10T00:00:00.000Z',
        summary: 'Dimissione con follow-up ortopedico.',
        rawMarkdown: [
            'Indicazioni alla dimissione',
            'Controllo ortopedico tra 7 giorni.',
            'Stato funzionale',
            'Deambulazione con ausilio.',
        ].join('\n'),
        diagnoses: [],
        medications: [],
    });

    const queue = buildEvidenceQueue({
        patientId: 'patient-1',
        generatedAt: '2026-05-03T00:00:00.000Z',
        attachments: [
            {
                id: 'attachment-1',
                patientId: 'patient-1',
                fileName: 'dimissione.pdf',
                createdAt: '2026-04-10T00:00:00.000Z',
                parseEvidenceArtifactSnapshot: serializeDocumentParseEvidenceArtifact(artifact),
            },
        ],
    });

    assert.equal(queue.schemaVersion, MEDIFLOW_EVIDENCE_QUEUE_SCHEMA_VERSION);
    assert.equal(queue.totals.included, 1);
    assert.equal(queue.totals.renderableClaims, 2);
    assert.equal(queue.items[0].source.type, 'attachment_parse_evidence');
    assert.equal(queue.items[0].source.version, artifact.schemaVersion);
    assert.equal(queue.items[0].governance.reason, 'included');
    assert.equal(queue.items[0].renderableClaims[0].citation.sourceId, 'attachment:attachment-1:parse-evidence');
});

test('buildEvidenceQueue keeps summary snapshots as needs-review and non-renderable', () => {
    const queue = buildEvidenceQueue({
        patientId: 'patient-1',
        generatedAt: '2026-05-03T00:00:00.000Z',
        attachments: [
            {
                id: 'attachment-2',
                patientId: 'patient-1',
                fileName: 'relazione.pdf',
                createdAt: '2026-04-11T00:00:00.000Z',
                summarySnapshot: 'Relazione clinica sintetica con indicazioni di follow-up.',
            },
        ],
    });

    assert.equal(queue.items[0].source.type, 'attachment_summary');
    assert.equal(queue.items[0].governance.reason, 'needs_review');
    assert.equal(queue.items[0].governance.freshness, 'recent');
    assert.equal(queue.items[0].renderableClaims.length, 0);
    assert.equal(getIncludedEvidenceQueueItems(queue).length, 0);
});

test('buildEvidenceQueue marks deleted diary entries as superseded and excludes them from renderable claims', () => {
    const queue = buildEvidenceQueue({
        patientId: 'patient-1',
        generatedAt: '2026-05-03T00:00:00.000Z',
        diaryEntries: [
            {
                id: 'entry-current',
                patientId: 'patient-1',
                date: '2026-04-12T00:00:00.000Z',
                content: 'Controllo domiciliare programmato con rivalutazione funzionale.',
                version: 3,
            },
            {
                id: 'entry-deleted',
                patientId: 'patient-1',
                date: '2026-04-01T00:00:00.000Z',
                content: 'Voce annullata.',
                deletedAt: '2026-04-02T00:00:00.000Z',
                version: 4,
            },
        ],
    });

    assert.equal(queue.totals.included, 1);
    assert.equal(queue.totals.superseded, 1);
    assert.equal(queue.items[0].source.type, 'diary_entry');
    assert.equal(queue.items[0].source.version, '3');
    assert.equal(queue.items[0].governance.freshness, 'recent');
    assert.equal(queue.items[0].renderableClaims.length, 1);
    assert.equal(queue.items[1].renderableClaims.length, 0);
});

test('buildEvidenceQueue includes reviewed structured chart data without model calls', () => {
    const queue = buildEvidenceQueue({
        patientId: 'patient-1',
        generatedAt: '2026-05-03T00:00:00.000Z',
        structuredChartItems: [
            {
                id: 'diagnosis-1',
                patientId: 'patient-1',
                sourceType: 'diagnosis',
                updatedAt: '2026-04-13T00:00:00.000Z',
                label: 'Diagnosi strutturata sintetica',
                version: 2,
            },
        ],
    });

    assert.equal(queue.items[0].source.type, 'structured_chart');
    assert.equal(queue.items[0].governance.reason, 'included');
    assert.equal(queue.items[0].governance.freshness, 'recent');
    assert.equal(queue.items[0].renderableClaims[0].kind, 'diagnosis');
});

test('getIncludedEvidenceQueueItems never returns low-signal or needs-review sources', () => {
    const queue = buildEvidenceQueue({
        patientId: 'patient-1',
        generatedAt: '2026-05-03T00:00:00.000Z',
        attachments: [
            {
                id: 'attachment-low-signal',
                patientId: 'patient-1',
                fileName: 'vuoto.pdf',
                createdAt: '2026-04-14T00:00:00.000Z',
                summarySnapshot: 'No',
            },
        ],
        diaryEntries: [
            {
                id: 'entry-low-signal',
                patientId: 'patient-1',
                date: '2026-04-14T00:00:00.000Z',
                content: 'Ok',
            },
        ],
    });

    assert.equal(queue.totals.lowSignal, 2);
    assert.deepEqual(getIncludedEvidenceQueueItems(queue), []);
});
