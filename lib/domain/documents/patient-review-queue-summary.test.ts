/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildPatientReviewQueueSummary,
    type PatientReviewQueueInput,
} from './patient-review-queue-summary';

function baseInput(): PatientReviewQueueInput {
    return {
        insight: { enabled: true, hasSummary: false },
        evidence: [],
        smartImport: { enabled: true, sourceCount: 0 },
        archive: { attachmentsCount: 0, missingTextCount: 0 },
    };
}

test('empty patient produces explicit empty/unavailable states for every row', () => {
    const summary = buildPatientReviewQueueSummary(baseInput());

    assert.equal(summary.rows.length, 4);
    assert.deepEqual(
        summary.rows.map((row) => row.id),
        ['insight', 'evidence', 'smart-import', 'archive'],
    );

    const insight = summary.rows[0];
    assert.equal(insight.state, 'vuoto');
    assert.equal(insight.anchor, '#documenti');

    const evidence = summary.rows[1];
    assert.equal(evidence.state, 'vuoto');
    assert.equal(evidence.anchor, '#documenti');

    // Smart Import panel is not rendered without usable sources: the row must
    // say so ("serve testo") instead of pointing to a missing anchor.
    const smartImport = summary.rows[2];
    assert.equal(smartImport.state, 'serve-testo');
    assert.equal(smartImport.stateLabel, 'Serve testo');
    assert.equal(smartImport.anchor, undefined);
    assert.equal(smartImport.actionLabel, 'Pannello non visibile');

    const archive = summary.rows[3];
    assert.equal(archive.state, 'vuoto');
    assert.equal(archive.anchor, '#documenti');

    // Only the missing-text row asks for action.
    assert.equal(summary.attentionCount, 1);
});

test('disabled kill switches surface as "bloccato" with a visible why', () => {
    const input = baseInput();
    input.insight = { enabled: false, hasSummary: true };
    input.smartImport = { enabled: false, sourceCount: 3 };

    const summary = buildPatientReviewQueueSummary(input);
    const insight = summary.rows[0];
    const smartImport = summary.rows[2];

    assert.equal(insight.state, 'bloccato');
    assert.equal(insight.stateLabel, 'Bloccato');
    assert.match(insight.blockedReason ?? '', /Impostazioni/);
    assert.match(insight.blockedReason ?? '', /non genera né scrive/);

    assert.equal(smartImport.state, 'bloccato');
    assert.equal(smartImport.anchor, '#documenti');
    assert.match(smartImport.blockedReason ?? '', /nessun suggerimento viene scritto/);
});

test('insight row distinguishes saved insight from never-generated state', () => {
    const withSummary = baseInput();
    withSummary.insight = { enabled: true, hasSummary: true };
    assert.equal(buildPatientReviewQueueSummary(withSummary).rows[0].state, 'disponibile');

    const withoutSummary = baseInput();
    withoutSummary.insight = { enabled: true, hasSummary: false };
    const emptyRow = buildPatientReviewQueueSummary(withoutSummary).rows[0];
    assert.equal(emptyRow.state, 'vuoto');
    assert.match(emptyRow.detail, /solo manualmente/);
});

test('stale insight surfaces as an attention row to regenerate', () => {
    const staleInput = baseInput();
    staleInput.insight = { enabled: true, hasSummary: true, stale: true };
    const summary = buildPatientReviewQueueSummary(staleInput);
    const insight = summary.rows[0];
    assert.equal(insight.state, 'da-rivedere');
    assert.match(insight.detail, /non aggiornato/i);
    // A stale insight must count toward the actionable attention total.
    assert.ok(summary.attentionCount >= 1);
});

test('unreadable saved insight is an attention row, not "disponibile"', () => {
    const input = baseInput();
    // Saved but not renderable by the panel: queue and panel must agree.
    input.insight = { enabled: true, hasSummary: true, readable: false };
    const insight = buildPatientReviewQueueSummary(input).rows[0];
    assert.equal(insight.state, 'da-rivedere');
    assert.match(insight.detail, /non leggibile/i);
});

test('evidence row prioritises non-green quality as "da rivedere"', () => {
    const input = baseInput();
    input.evidence = [
        { qualityLevel: 'green', appliedDiagnosesCount: 0 },
        { qualityLevel: 'yellow', appliedDiagnosesCount: 0 },
        { qualityLevel: 'red', appliedDiagnosesCount: 0 },
        { qualityLevel: undefined, appliedDiagnosesCount: 0 },
    ];

    const evidence = buildPatientReviewQueueSummary(input).rows[1];
    assert.equal(evidence.state, 'da-rivedere');
    assert.equal(evidence.stateLabel, 'Da rivedere');
    assert.match(evidence.detail, /3 referti su 4/);
    assert.match(evidence.detail, /1 con qualità critica/);
});

test('evidence row reports verified referti with applied diagnoses as "già applicato"', () => {
    const input = baseInput();
    input.evidence = [
        { qualityLevel: 'green', appliedDiagnosesCount: 2 },
        { qualityLevel: 'green', appliedDiagnosesCount: 0 },
    ];

    const evidence = buildPatientReviewQueueSummary(input).rows[1];
    assert.equal(evidence.state, 'gia-applicato');
    assert.equal(evidence.stateLabel, 'Già applicato');
    assert.match(evidence.detail, /2 diagnosi già applicate/);
});

test('smart import without analysis stays on-demand and never auto-runs', () => {
    const input = baseInput();
    input.smartImport = { enabled: true, sourceCount: 5 };

    const smartImport = buildPatientReviewQueueSummary(input).rows[2];
    assert.equal(smartImport.state, 'disponibile');
    assert.match(smartImport.detail, /solo su richiesta/);
    assert.equal(smartImport.anchor, '#documenti');
});

test('smart import analysis counts map to review-first states', () => {
    const ready = baseInput();
    ready.smartImport = {
        enabled: true,
        sourceCount: 4,
        analysis: { hasAnalysis: true, reviewable: 2, blocked: 1, ready: 3 },
    };
    const readyRow = buildPatientReviewQueueSummary(ready).rows[2];
    assert.equal(readyRow.state, 'pronto-da-applicare');
    assert.equal(readyRow.stateLabel, 'Pronto da applicare');
    assert.match(readyRow.detail, /3 suggerimenti selezionati/);
    assert.match(readyRow.detail, /2 da rivedere/);
    assert.match(readyRow.detail, /1 bloccati/);
    assert.match(readyRow.blockedReason ?? '', /non li scrive senza correzione manuale/);

    const reviewable = baseInput();
    reviewable.smartImport = {
        enabled: true,
        sourceCount: 4,
        analysis: { hasAnalysis: true, reviewable: 2, blocked: 0, ready: 0 },
    };
    const reviewableRow = buildPatientReviewQueueSummary(reviewable).rows[2];
    assert.equal(reviewableRow.state, 'da-rivedere');
    assert.equal(reviewableRow.blockedReason, undefined);

    const blocked = baseInput();
    blocked.smartImport = {
        enabled: true,
        sourceCount: 4,
        analysis: { hasAnalysis: true, reviewable: 0, blocked: 2, ready: 0 },
    };
    const blockedRow = buildPatientReviewQueueSummary(blocked).rows[2];
    assert.equal(blockedRow.state, 'bloccato');
    assert.match(blockedRow.blockedReason ?? '', /profilo attuale/);

    const drained = baseInput();
    drained.smartImport = {
        enabled: true,
        sourceCount: 4,
        analysis: { hasAnalysis: true, reviewable: 0, blocked: 0, ready: 0 },
    };
    const drainedRow = buildPatientReviewQueueSummary(drained).rows[2];
    assert.equal(drainedRow.state, 'gia-applicato');
});

test('archive row flags attachments without extracted text as "serve testo"', () => {
    const input = baseInput();
    input.archive = { attachmentsCount: 5, missingTextCount: 2 };

    const archive = buildPatientReviewQueueSummary(input).rows[3];
    assert.equal(archive.state, 'serve-testo');
    assert.match(archive.detail, /2 allegati su 5/);
    assert.match(archive.detail, /OCR o sintesi/);

    const complete = baseInput();
    complete.archive = { attachmentsCount: 3, missingTextCount: 0 };
    assert.equal(buildPatientReviewQueueSummary(complete).rows[3].state, 'disponibile');
});

test('attentionCount counts only rows that need clinician action', () => {
    const input: PatientReviewQueueInput = {
        insight: { enabled: false, hasSummary: false },          // bloccato
        evidence: [{ qualityLevel: 'yellow', appliedDiagnosesCount: 0 }], // da-rivedere
        smartImport: {
            enabled: true,
            sourceCount: 2,
            analysis: { hasAnalysis: true, reviewable: 0, blocked: 0, ready: 1 }, // pronto
        },
        archive: { attachmentsCount: 1, missingTextCount: 0 },   // disponibile
    };

    const summary = buildPatientReviewQueueSummary(input);
    assert.equal(summary.attentionCount, 3);

    const calm: PatientReviewQueueInput = {
        insight: { enabled: true, hasSummary: true },
        evidence: [{ qualityLevel: 'green', appliedDiagnosesCount: 0 }],
        smartImport: { enabled: true, sourceCount: 2 },
        archive: { attachmentsCount: 1, missingTextCount: 0 },
    };
    assert.equal(buildPatientReviewQueueSummary(calm).attentionCount, 0);
});
