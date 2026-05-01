/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildDocumentEvidenceBackfillPlan,
} from './document-evidence-backfill';
import {
    buildDocumentParseEvidenceArtifact,
    serializeDocumentParseEvidenceArtifact,
} from './document-parse-evidence-artifact';

test('buildDocumentEvidenceBackfillPlan creates reviewable candidates from summaries without existing artifacts', () => {
    const plan = buildDocumentEvidenceBackfillPlan([
        {
            id: 'attachment-1',
            patientId: 'patient-1',
            fileName: 'dimissione.pdf',
            createdAt: '2026-03-20T00:00:00.000Z',
            summarySnapshot: [
                'Indicazioni alla dimissione: controllo ortopedico tra 7 giorni.',
                'ADI infermieristica da proseguire.',
                'Familiarita: madre con carcinoma mammario.',
            ].join(' '),
            qualityStatus: 'green',
        },
    ]);

    assert.equal(plan.totals.attachments, 1);
    assert.equal(plan.totals.candidates, 1);
    assert.equal(plan.totals.candidateSuppressed, 1);
    assert.equal(plan.items[0].decision, 'create_from_summary');
    assert.equal(plan.items[0].textSource, 'summarySnapshot');
    assert.ok(plan.items[0].candidateArtifact);
    assert.deepEqual(
        plan.items[0].candidateMetrics?.factKinds,
        ['care_setting', 'followup'],
    );
});

test('buildDocumentEvidenceBackfillPlan prefers source text over summary text', () => {
    const plan = buildDocumentEvidenceBackfillPlan([
        {
            id: 'attachment-2',
            patientId: 'patient-1',
            fileName: 'relazione.pdf',
            createdAt: '2026-03-21T00:00:00.000Z',
            summarySnapshot: 'Nessuna informazione rilevante trovata.',
            rawMarkdown: 'Controllo pneumologico da programmare. Deambulazione con ausilio.',
        },
    ]);

    assert.equal(plan.items[0].decision, 'create_from_source');
    assert.equal(plan.items[0].textSource, 'rawMarkdown');
    assert.deepEqual(
        plan.items[0].candidateMetrics?.factKinds,
        ['followup', 'functional_status'],
    );
});

test('buildDocumentEvidenceBackfillPlan skips valid existing artifacts by default', () => {
    const artifact = buildDocumentParseEvidenceArtifact({
        documentInsightId: 'insight-1',
        attachmentId: 'attachment-3',
        fileName: 'referto.pdf',
        documentDate: '2026-03-22T00:00:00.000Z',
        summary: 'Controllo cardiologico tra 6 mesi.',
        rawMarkdown: 'Controllo cardiologico tra 6 mesi.',
        diagnoses: [],
        medications: [],
    });

    const plan = buildDocumentEvidenceBackfillPlan([
        {
            id: 'attachment-3',
            patientId: 'patient-1',
            fileName: 'referto.pdf',
            createdAt: '2026-03-22T00:00:00.000Z',
            summarySnapshot: 'Controllo cardiologico tra 6 mesi.',
            parseEvidenceArtifactSnapshot: serializeDocumentParseEvidenceArtifact(artifact),
        },
    ]);

    assert.equal(plan.totals.skippedExisting, 1);
    assert.equal(plan.items[0].decision, 'skip_existing_artifact');
    assert.equal(plan.items[0].candidateArtifact, undefined);
});

test('buildDocumentEvidenceBackfillPlan can rebuild valid artifacts when explicitly requested', () => {
    const artifact = buildDocumentParseEvidenceArtifact({
        documentInsightId: 'insight-2',
        attachmentId: 'attachment-4',
        fileName: 'referto.pdf',
        documentDate: '2026-03-23T00:00:00.000Z',
        summary: 'Controllo cardiologico tra 6 mesi.',
        rawMarkdown: 'Controllo cardiologico tra 6 mesi.',
        diagnoses: [],
        medications: [],
    });

    const plan = buildDocumentEvidenceBackfillPlan([
        {
            id: 'attachment-4',
            patientId: 'patient-1',
            fileName: 'referto.pdf',
            createdAt: '2026-03-23T00:00:00.000Z',
            rawMarkdown: 'Controllo cardiologico tra 6 mesi. Non evidenza di scompenso.',
            parseEvidenceArtifactSnapshot: serializeDocumentParseEvidenceArtifact(artifact),
        },
    ], { rebuildExisting: true });

    assert.equal(plan.totals.candidates, 1);
    assert.equal(plan.items[0].decision, 'create_from_source');
    assert.equal(plan.items[0].candidateMetrics?.suppressedCandidateCount, 1);
});

test('buildDocumentEvidenceBackfillPlan rebuilds invalid artifact snapshots only when usable text exists', () => {
    const [rebuild, skip] = buildDocumentEvidenceBackfillPlan([
        {
            id: 'attachment-5',
            patientId: 'patient-1',
            fileName: 'referto.pdf',
            createdAt: '2026-03-24T00:00:00.000Z',
            summarySnapshot: 'Visita fisiatrica: FKT domiciliare da proseguire.',
            parseEvidenceArtifactSnapshot: '{invalid',
        },
        {
            id: 'attachment-6',
            patientId: 'patient-1',
            fileName: 'vuoto.pdf',
            createdAt: '2026-03-24T00:00:00.000Z',
            summarySnapshot: 'Nessuna informazione rilevante trovata.',
            parseEvidenceArtifactSnapshot: '{invalid',
        },
    ]).items;

    assert.equal(rebuild.decision, 'rebuild_invalid_artifact');
    assert.ok(rebuild.candidateArtifact);
    assert.equal(skip.decision, 'skip_no_usable_text');
    assert.equal(skip.candidateArtifact, undefined);
});
