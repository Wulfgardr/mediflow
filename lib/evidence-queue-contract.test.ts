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
    assert.ok(queue.items[0].renderableClaims.length >= 1);
    assert.equal(queue.items[1].renderableClaims.length, 0);
});

test('buildEvidenceQueue projects diary entries as citable retrieval-only evidence', () => {
    const content = [
        'Nega febbre o dispnea alla rivalutazione telefonica.',
        'Controllo programmato tra sette giorni con diario dei sintomi.',
    ].join(' ');
    const queue = buildEvidenceQueue({
        patientId: 'patient-1',
        generatedAt: '2026-05-03T00:00:00.000Z',
        diaryEntries: [
            {
                id: 'entry-follow-up',
                patientId: 'patient-1',
                type: 'phone',
                title: 'Follow-up sintetico',
                date: '2026-04-20T00:00:00.000Z',
                content,
                version: 5,
            },
        ],
    });

    const item = queue.items[0];
    assert.equal(item.source.id, 'diary:entry-follow-up');
    assert.equal(item.source.type, 'diary_entry');
    assert.equal(item.governance.reason, 'included');
    assert.ok(item.renderableClaims.some((claim) => claim.kind === 'diary_negation'));
    assert.ok(item.renderableClaims.some((claim) => claim.kind === 'diary_follow_up'));
    assert.ok(item.renderableClaims.some((claim) => claim.kind === 'diary_plan'));

    for (const claim of item.renderableClaims) {
        assert.equal(typeof claim.citation.offsetStart, 'number');
        assert.equal(typeof claim.citation.offsetEnd, 'number');
        assert.equal(claim.citation.sourceId, 'diary:entry-follow-up');
        assert.equal(
            content.slice(claim.citation.offsetStart as number, claim.citation.offsetEnd as number).trim(),
            claim.citation.snippet,
        );
    }
});

test('buildEvidenceQueue suppresses older diary evidence within the same retrieval domain', () => {
    const queue = buildEvidenceQueue({
        patientId: 'patient-1',
        generatedAt: '2026-05-03T00:00:00.000Z',
        diaryEntries: [
            {
                id: 'entry-old',
                patientId: 'patient-1',
                type: 'visit',
                date: '2026-03-01T00:00:00.000Z',
                content: 'Piano precedente: controllo mensile del sintomo sintetico.',
                domainKey: 'synthetic-follow-up-domain',
            },
            {
                id: 'entry-new',
                patientId: 'patient-1',
                type: 'visit',
                date: '2026-04-10T00:00:00.000Z',
                content: 'Piano aggiornato: rivalutazione tra sette giorni del sintomo sintetico.',
                domainKey: 'synthetic-follow-up-domain',
            },
        ],
    });

    assert.equal(queue.totals.included, 1);
    assert.equal(queue.totals.suppressedStale, 1);
    assert.equal(queue.items[0].id, 'diary:entry-old');
    assert.equal(queue.items[0].governance.reason, 'suppressed_stale');
    assert.equal(queue.items[0].governance.freshness, 'stale');
    assert.equal(queue.items[0].governance.suppressedBySourceId, 'diary:entry-new');
    assert.equal(queue.items[0].renderableClaims.length, 0);
    assert.equal(queue.items[1].governance.reason, 'included');
});

test('buildEvidenceQueue marks old diary entries as historical when they remain retrievable', () => {
    const queue = buildEvidenceQueue({
        patientId: 'patient-1',
        generatedAt: '2026-05-03T00:00:00.000Z',
        diaryEntries: [
            {
                id: 'entry-history',
                patientId: 'patient-1',
                type: 'note',
                date: '2025-01-10T00:00:00.000Z',
                content: 'Nota storica sintetica utile solo come contesto longitudinale.',
                domainKey: 'synthetic-history-domain',
            },
        ],
    });

    assert.equal(queue.items[0].governance.reason, 'included');
    assert.ok(queue.items[0].renderableClaims.some((claim) => claim.kind === 'diary_historical'));
});

test('buildEvidenceQueue diary indexing does not emit structured clinical writes', () => {
    const queue = buildEvidenceQueue({
        patientId: 'patient-1',
        generatedAt: '2026-05-03T00:00:00.000Z',
        diaryEntries: [
            {
                id: 'entry-retrieval-only',
                patientId: 'patient-1',
                type: 'note',
                date: '2026-04-11T00:00:00.000Z',
                content: 'Nota sintetica per retrieval citabile senza promozione strutturata.',
            },
        ],
    });

    assert.equal(queue.items.length, 1);
    assert.equal(queue.items[0].source.type, 'diary_entry');
    assert.equal(queue.items.some((item) => item.source.type === 'structured_chart'), false);
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
