import test from 'node:test';
import assert from 'node:assert/strict';
import { type AifaDrug, type Therapy } from '../../db';
import {
    buildDiagnosisSearchQueries,
    classifyExtractedTherapyState,
    buildTherapyReview,
    hasDrugDosageConflict,
    isNoClinicalNoveltyContext,
    hasUsableTherapyDosage,
    rankDrugCatalogSearchResult,
    rankDrugMatch,
    selectTherapyCatalogMatch,
    sortDrugCatalogSearchResults,
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

test('drug catalog search ranking promotes monotherapy active principle for single-ingredient queries', () => {
    const combinationProduct: AifaDrug = {
        aic: 'AIC-ADI',
        name: 'ADIABIN',
        activePrinciple: 'METFORMINA CLORIDRATO/SITAGLIPTIN',
        packaging: '50 mg/1000 mg compresse rivestite',
        atc: 'A10BD07',
    };
    const metforminProduct: AifaDrug = {
        aic: 'AIC-GLU',
        name: 'GLUCOPHAGE',
        activePrinciple: 'METFORMINA CLORIDRATO',
        packaging: '1000 MG COMPRESSE RIVESTITE',
        atc: 'A10BA02',
    };

    const ranked = sortDrugCatalogSearchResults('Metformina', [combinationProduct, metforminProduct]);

    assert.equal(ranked[0].aic, 'AIC-GLU');
    assert.ok(
        rankDrugCatalogSearchResult('Metformina', metforminProduct)
        > rankDrugCatalogSearchResult('Metformina', combinationProduct)
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

test('smart import catalog match rejects generic AIFA nutrition products when brand identity is missing', () => {
    const suggestion = {
        drugMention: 'Nutridrink',
        drugQuery: 'Nutridrink',
        activePrinciple: 'formula nutrizionale orale',
        dosage: '1 al dì',
        confidence: 'high' as const,
        evidence: 'Nutridrink 1 al dì',
        sourceId: 'entry:3',
    };
    const genericNutritionBag: AifaDrug = {
        aic: 'AIC-FINOMEL',
        name: 'FINOMEL',
        activePrinciple: 'EMULSIONE LIPIDICA PER NUTRIZIONE PARENTERALE',
        packaging: 'sacca 1200 ml',
        atc: 'B05BA10',
    };

    const selected = selectTherapyCatalogMatch(suggestion, [genericNutritionBag]);

    assert.equal(selected, undefined);
});

test('smart import catalog match allows insulin brand when extracted dosage is an administration schedule', () => {
    const suggestion = {
        drugMention: 'Humalog',
        drugQuery: 'Humalog insulin lispro',
        activePrinciple: 'Insulina lispro',
        dosage: '4 U ai pasti principali',
        confidence: 'high' as const,
        evidence: 'Humalog 4 U ai pasti principali',
        sourceId: 'entry:4',
    };
    const humalogPen: AifaDrug = {
        aic: 'AIC-HUMA',
        name: 'HUMALOG',
        activePrinciple: 'INSULINA LISPRO',
        packaging: 'KWIKPEN 100 U/ML SOLUZIONE INIETTABILE 5 PENNE PRERIEMPITE 3 ML',
        atc: 'A10AB04',
    };

    const selected = selectTherapyCatalogMatch(suggestion, [humalogPen]);

    assert.equal(hasDrugDosageConflict(humalogPen, suggestion), false);
    assert.equal(selected?.aic, 'AIC-HUMA');
});

test('smart import catalog match rejects combination product when suggestion targets a single ingredient', () => {
    const suggestion = {
        drugMention: 'Metformina',
        drugQuery: 'Metformina',
        activePrinciple: 'Metformina',
        dosage: '1000 mg x2',
        confidence: 'high' as const,
        evidence: 'Metformina 1000 mg x2',
        sourceId: 'entry:5',
    };
    const combinationProduct: AifaDrug = {
        aic: 'AIC-ADI',
        name: 'ADIABIN',
        activePrinciple: 'METFORMINA CLORIDRATO/SITAGLIPTIN',
        packaging: '50 mg/1000 mg compresse rivestite',
        atc: 'A10BD07',
    };

    const selected = selectTherapyCatalogMatch(suggestion, [combinationProduct]);

    assert.equal(selected, undefined);
});

test('smart import catalog match skips rejected combo candidate and falls back to valid monotherapy candidate', () => {
    const suggestion = {
        drugMention: 'Metformina',
        drugQuery: 'Metformina',
        activePrinciple: 'Metformina',
        dosage: '1000 mg x2',
        confidence: 'high' as const,
        evidence: 'Metformina 1000 mg x2',
        sourceId: 'entry:6',
    };
    const combinationProduct: AifaDrug = {
        aic: 'AIC-ADI',
        name: 'ADIABIN',
        activePrinciple: 'METFORMINA CLORIDRATO/SITAGLIPTIN',
        packaging: '50 mg/1000 mg compresse rivestite',
        atc: 'A10BD07',
    };
    const metforminProduct: AifaDrug = {
        aic: 'AIC-GLU',
        name: 'GLUCOPHAGE',
        activePrinciple: 'METFORMINA CLORIDRATO',
        packaging: '1000 MG COMPRESSE RIVESTITE',
        atc: 'A10BA02',
    };

    const selected = selectTherapyCatalogMatch(suggestion, [combinationProduct, metforminProduct]);

    assert.equal(selected?.aic, 'AIC-GLU');
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

test('smart import review marks documented therapy switch as transition even when related therapy exists', () => {
    const existing: Therapy[] = [
        {
            id: 'therapy-2',
            patientId: 'patient-1',
            drugName: 'Ramipril EG',
            activePrinciple: 'Ramipril',
            dosage: '5 mg 1 cp',
            status: 'active',
            createdAt: new Date('2026-04-01T08:00:00Z'),
            updatedAt: new Date('2026-04-01T08:00:00Z'),
            startDate: new Date('2026-03-20T08:00:00Z'),
        },
    ];

    const suggestion: TherapyReviewCandidate = {
        drugMention: 'Ramipril',
        activePrinciple: 'Ramipril',
        dosage: '2,5 mg 1 cp',
        therapyState: 'transition',
        matchType: 'catalog',
        match: {
            aic: 'AIC-RAM-25',
            name: 'Ramipril EG',
            activePrinciple: 'Ramipril',
        },
        canApply: false,
        blockedReason: 'Passaggio terapeutico documentato',
    };

    const review = buildTherapyReview(existing, suggestion);

    assert.equal(review.state, 'transition');
    assert.match(review.summary, /transizione terapeutica/i);
    assert.match(review.comparison || '', /Ramipril EG/i);
});

test('smart import review marks suspended therapy as inactive instead of uncertain', () => {
    const suggestion: TherapyReviewCandidate = {
        drugMention: 'Furosemide',
        activePrinciple: 'Furosemide',
        dosage: '25 mg',
        therapyState: 'inactive',
        matchType: 'catalog',
        match: {
            aic: 'AIC-FUR-25',
            name: 'Lasix',
            activePrinciple: 'Furosemide',
        },
        canApply: false,
        blockedReason: 'Terapia sospesa alla dimissione',
    };

    const review = buildTherapyReview([], suggestion);

    assert.equal(review.state, 'inactive');
    assert.match(review.summary, /sospesa o conclusa/i);
});

test('smart import review keeps manual-only active therapy as consultive and not directly applicable', () => {
    const suggestion: TherapyReviewCandidate = {
        drugMention: 'Nutridrink',
        activePrinciple: 'Formula nutrizionale orale',
        dosage: '1 al di',
        therapyState: 'active',
        matchType: 'manual',
        canApply: false,
        blockedReason: 'Match AIFA da confermare prima dell\'import',
    };

    const review = buildTherapyReview([], suggestion);

    assert.equal(review.state, 'uncertain');
    assert.match(review.summary, /AIFA/i);
});

test('smart import direct-apply dosage guard rejects empty or placeholder dosage strings', () => {
    assert.equal(hasUsableTherapyDosage(undefined), false);
    assert.equal(hasUsableTherapyDosage(''), false);
    assert.equal(hasUsableTherapyDosage('dose da verificare'), false);
    assert.equal(hasUsableTherapyDosage('Posologia da confermare'), false);
    assert.equal(hasUsableTherapyDosage('10 mg 1 cp al mattino'), true);
});

test('smart import detects referral-style continuation context as no clinical novelty', () => {
    assert.equal(
        isNoClinicalNoveltyContext(
            'Richiesta di visita endocrinologica di controllo per ipotiroidismo autoimmune gia noto. '
            + 'Continuare terapia domiciliare come da piano in corso.'
        ),
        true,
    );
});

test('smart import keeps dosage-change notes out of no-clinical-novelty suppression', () => {
    assert.equal(
        isNoClinicalNoveltyContext(
            'Ridotto bisoprololo a 1,25 mg dopo rivalutazione pressoria con modifica posologica documentata.'
        ),
        false,
    );
});

test('smart import promotes outgoing switch therapy from inactive to transition when evidence documents replacement', () => {
    const state = classifyExtractedTherapyState({
        drugMention: 'Bisoprololo',
        drugQuery: 'Bisoprololo',
        activePrinciple: 'Bisoprololo',
        dosage: '1,25 mg',
        motivation: 'Beta-bloccante in uscita',
        reviewNote: 'Sospendere bisoprololo e passare a nebivololo',
        evidence: 'Per ipotensione sospendere bisoprololo 1,25 mg e passare a nebivololo 5 mg 1 cp.',
        therapyState: 'inactive',
    });

    assert.equal(state, 'transition');
});

test('smart import keeps true inactive therapy as inactive when no switch context exists', () => {
    const state = classifyExtractedTherapyState({
        drugMention: 'Furosemide',
        drugQuery: 'Furosemide',
        activePrinciple: 'Furosemide',
        dosage: '25 mg',
        motivation: 'Sospesa alla dimissione',
        reviewNote: 'Terapia sospesa',
        evidence: 'Sospendere furosemide per ipotensione.',
        therapyState: 'inactive',
    });

    assert.equal(state, 'inactive');
});

test('smart import normalizes dosage titration to active when no therapy replacement is documented', () => {
    const state = classifyExtractedTherapyState({
        drugMention: 'Insulina glargine',
        drugQuery: 'Insulina glargine 16 UI',
        activePrinciple: 'Insulina glargine',
        dosage: '16 UI la sera',
        motivation: 'Aumento posologia per controllo glicemico',
        reviewNote: 'Modifica posologia in corso da 12 a 16 UI',
        evidence: 'Aumentare insulina glargine a 16 UI serali.',
        therapyState: 'transition',
    });

    assert.equal(state, 'active');
});

test('smart import normalizes proposed short-horizon therapy to uncertain instead of transition', () => {
    const state = classifyExtractedTherapyState({
        drugMention: 'Quetiapina 25 mg',
        drugQuery: 'quetiapine 25mg',
        activePrinciple: 'quetiapine',
        dosage: '25 mg',
        motivation: 'agitazione serale',
        reviewNote: 'da rivalutare entro 7 giorni',
        evidence: 'proporre Quetiapina 25 mg la sera',
        therapyState: 'transition',
    });

    assert.equal(state, 'uncertain');
});
