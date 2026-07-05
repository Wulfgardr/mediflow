/* @Codex WUL-421 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildVisitSessionSummary,
    buildVisitTranscriptDraft,
    collectVisitTranscriptDrugSearchTerms,
} from './visit-transcript-draft';
import type { AifaDrug } from './db';

const SYNTHETIC_DRUG_CATALOG: AifaDrug[] = [
    {
        aic: '000001',
        name: 'METFORMINA DOC',
        activePrinciple: 'metformina',
        packaging: '850 mg compresse',
        atc: 'A10BA02',
    },
    {
        aic: '000002',
        name: 'RAMIPRIL EG',
        activePrinciple: 'ramipril',
        packaging: '5 mg compresse',
        atc: 'C09AA05',
    },
];

test('visit session summary handles pause and resume events without audio persistence', () => {
    const summary = buildVisitSessionSummary([
        { type: 'start', atMs: 0 },
        { type: 'pause', atMs: 10_000 },
        { type: 'resume', atMs: 25_000 },
        { type: 'stop', atMs: 40_000 },
    ]);

    assert.equal(summary.state, 'stopped');
    assert.equal(summary.pauseCount, 1);
    assert.equal(summary.resumeCount, 1);
    assert.equal(summary.pausedMs, 15_000);
    assert.equal(summary.recordedMs, 25_000);
    assert.deepEqual(summary.warnings, []);
});

test('visit transcript draft builds review-first SOAP sections and no clinical writes', () => {
    const result = buildVisitTranscriptDraft({
        transcript: [
            'Il paziente riferisce dispnea da sforzo da tre giorni e tosse secca.',
            'PA 135/80, saturazione 96%, obiettivamente murmure ridotto alle basi.',
            'Quadro compatibile con riacutizzazione respiratoria lieve.',
            'Proseguire monitoraggio domiciliare e controllo a 48 ore.',
        ].join(' '),
    });

    assert.match(result.draftText, /^S:/);
    assert.match(result.draftText, /\n\nO:/);
    assert.match(result.draftText, /\n\nA:/);
    assert.match(result.draftText, /\n\nP:/);
    assert.ok(result.sections.subjective.length > 0);
    assert.ok(result.sections.objective.length > 0);
    assert.ok(result.sections.assessment.length > 0);
    assert.ok(result.sections.plan.length > 0);
    assert.equal(result.safety.reviewRequired, true);
    assert.equal(result.safety.forbiddenAutoWriteCount, 0);
    assert.equal(result.safety.rawAudioPersisted, false);
    assert.deepEqual(result.safety.writesPerformed, []);
});

test('visit transcript draft extracts medication candidates and resolves local catalog names', () => {
    const result = buildVisitTranscriptDraft({
        transcript: 'Il paziente assume metformina 850 mg due volte al giorno. Continua ramipril 5 mg al mattino.',
        drugCatalog: SYNTHETIC_DRUG_CATALOG,
    });

    assert.equal(result.medications.length, 2);
    assert.deepEqual(result.medications.map((item) => item.match?.name), ['METFORMINA DOC', 'RAMIPRIL EG']);
    assert.deepEqual(result.medications.map((item) => item.matchType), ['catalog', 'catalog']);
    assert.ok(result.medications.every((item) => item.canApply === false));
    assert.ok(result.medications.every((item) => /richiede revisione manuale/i.test(item.blockedReason)));
});

test('visit transcript draft separates multiple medications from one clinical sentence', () => {
    const result = buildVisitTranscriptDraft({
        transcript: 'Assume metformina 850 mg due volte al giorno e ramipril 5 mg al mattino.',
        drugCatalog: SYNTHETIC_DRUG_CATALOG,
    });

    assert.equal(result.medications.length, 2);
    assert.deepEqual(result.medications.map((item) => item.drugQuery), ['metformina', 'ramipril']);
    assert.deepEqual(result.medications.map((item) => item.match?.name), ['METFORMINA DOC', 'RAMIPRIL EG']);
});

test('visit transcript exposes bounded drug search terms for the route catalog lookup', () => {
    const terms = collectVisitTranscriptDrugSearchTerms({
        transcript: 'In terapia con metformina 850 mg e ramipril 5 mg, senza variazioni.',
    });

    assert.ok(terms.some((term) => /metformina/i.test(term)));
    assert.ok(terms.some((term) => /ramipril/i.test(term)));
    assert.ok(terms.length <= 12);
});
