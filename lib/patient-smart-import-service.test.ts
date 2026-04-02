import test from 'node:test';
import assert from 'node:assert/strict';
import { type AifaDrug, type Therapy } from './db';
import {
    buildDiagnosisSearchQueries,
    buildTherapyReview,
    hasDrugDosageConflict,
    rankDrugMatch,
    selectTherapyCatalogMatch,
    type TherapyReviewCandidate,
} from './patient-smart-import-matching';

test('smart import diagnosis search queries keep explicit code first and add textual fallbacks', () => {
    const queries = buildDiagnosisSearchQueries({
        label: 'Diabete mellito tipo 2',
        icdQuery: 'type 2 diabetes mellitus',
        confidence: 'high',
        evidence: 'Diagnosi nota in follow-up diabetologico',
        sourceId: 'entry:1',
        explicitCode: '5A11',
    });

    assert.deepEqual(queries, ['5A11', 'type 2 diabetes mellitus', 'Diabete mellito tipo 2']);
});

test('smart import catalog match prefers AIFA candidate whose packaging matches extracted dosage', () => {
    const suggestion = {
        drugMention: 'Bisoprololo 1,25 mg',
        drugQuery: 'Bisoprololo',
        activePrinciple: 'Bisoprololo',
        dosage: '1,25 mg 1 cp',
        confidence: 'high' as const,
        evidence: 'Passare a bisoprololo 1,25 mg dopo rivalutazione pressoria',
        sourceId: 'entry:1',
    };
    const wrongDose: AifaDrug = {
        aic: 'AIC-5MG',
        name: 'Bisoprololo EG',
        activePrinciple: 'Bisoprololo',
        packaging: '5 mg compresse',
        atc: 'C07AB07',
    };
    const correctDose: AifaDrug = {
        aic: 'AIC-125MG',
        name: 'Bisoprololo EG',
        activePrinciple: 'Bisoprololo',
        packaging: '1,25 mg compresse',
        atc: 'C07AB07',
    };

    const selected = selectTherapyCatalogMatch(suggestion, [wrongDose, correctDose]);

    assert.equal(hasDrugDosageConflict(wrongDose, suggestion), true);
    assert.equal(hasDrugDosageConflict(correctDose, suggestion), false);
    assert.equal(selected?.aic, 'AIC-125MG');
    assert.ok(
        rankDrugMatch(correctDose, suggestion)
        > rankDrugMatch(wrongDose, suggestion)
    );
});

test('smart import catalog match rejects dosage-specific therapy when only conflicting AIFA strengths are available', () => {
    const suggestion = {
        drugMention: 'Metformina 500 mg',
        drugQuery: 'Metformina 500 mg',
        activePrinciple: 'Metformina',
        dosage: '500 mg x 2/die',
        confidence: 'high' as const,
        evidence: 'Metformina 500 mg due volte al giorno',
        sourceId: 'entry:2',
    };
    const onlyWrongDose: AifaDrug = {
        aic: 'AIC-1000MG',
        name: 'Glucophage',
        activePrinciple: 'Metformina cloridrato',
        packaging: '1000 mg compresse rivestite',
        atc: 'A10BA02',
    };

    const selected = selectTherapyCatalogMatch(suggestion, [onlyWrongDose]);

    assert.equal(hasDrugDosageConflict(onlyWrongDose, suggestion), true);
    assert.equal(selected, undefined);
});

test('smart import review marks same therapy with different dosage as update instead of new', () => {
    const existing: Therapy[] = [
        {
            id: 'therapy-1',
            patientId: 'patient-1',
            drugName: 'Bisoprololo EG',
            activePrinciple: 'Bisoprololo',
            dosage: '2,5 mg 1 cp',
            status: 'active',
            createdAt: new Date('2026-04-01T08:00:00Z'),
            updatedAt: new Date('2026-04-01T08:00:00Z'),
            startDate: new Date('2026-03-20T08:00:00Z'),
        },
    ];

    const suggestion: TherapyReviewCandidate = {
        drugMention: 'Bisoprololo',
        activePrinciple: 'Bisoprololo',
        dosage: '1,25 mg 1 cp',
        therapyState: 'active',
        matchType: 'catalog',
        match: {
            aic: 'AIC-125MG',
            name: 'Bisoprololo EG',
            activePrinciple: 'Bisoprololo',
        },
        canApply: true,
    };

    const review = buildTherapyReview(existing, suggestion);

    assert.equal(review.state, 'update');
    assert.match(review.summary, /aggiornamento/i);
    assert.match(review.comparison || '', /2,5 mg 1 cp/i);
});
