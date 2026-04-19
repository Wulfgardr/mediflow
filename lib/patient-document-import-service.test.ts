/* @Codex */
import test from 'node:test';
/* @Codex */
import assert from 'node:assert/strict';
/* @Codex */
import {
    dedupeTherapyCandidates,
    fallbackTherapyCandidates,
    isPlausibleTherapyCandidate,
    mergeUniqueTherapies,
    reconcileTherapyCandidatesWithDocumentContext,
    shouldRetainReviewTherapy,
} from './patient-document-import-service';
/* @Codex */
import type { ExtractedPatientReviewTherapy } from './pdf-service';
/* @Codex */
import type { SmartImportTherapyExtraction } from './ai-task-contracts';

const DISCHARGE_DOCUMENT = [
    'APR: Ipovisus, Disturbo psichiatrico non meglio precisato, Diabete mellito',
    'Terapia domiciliare: Metformina 1000mg x2, Gliclazide 30mg 1cp ore12',
    'Terapia alla dimissione',
    '- Humalog 4 U ai pasti principali',
    '- Pantoprazolo 40 mg 1 cp 30 minuti prima della colazione per due settimane',
    'RIVALUTAZIONE DIABETOLOGICA PER IMPOSTAZIONE TERAPIA',
].join('\n');

const COLUMBUS_DIMISSIONE_DOCUMENT = [
    'Indicazioni terapeutiche e gestionali alla dimissione.',
    '- Pantorc 20 mg cp: 1 cp prima di colazione',
    '- Blopress 16 mg cp: 1 cp dopo colazione',
    '- Deltacortene dopo colazione secondo schema*',
    '- Dal 14/04/2026 al 28/04/2026: Deltacortene 25 mg cp: 1/2 cp dopo colazione',
    '- Dal 28/04/2026 al 13/05/2026: Deltacortene 5 mg cp: 2 cp dopo colazione',
].join('\n');

test('document import downgrades pre-admission home therapy when discharge therapy resets the same therapeutic area', () => {
    const therapies: ExtractedPatientReviewTherapy[] = [
        {
            drugName: 'Glucophage 1000 mg compresse',
            dosage: '1000 mg x2',
            activePrinciple: 'Metformina cloridrato',
            aic: 'AIC-METF',
            atc: 'A10BA02',
            confidence: 'high',
            therapyState: 'active',
            matchType: 'catalog',
            evidence: 'Metformina 1000mg x2',
            sourceType: 'reviewable_local_match',
        },
        {
            drugName: 'Gliclazide 30 mg compresse',
            dosage: '30mg 1cp ore12',
            activePrinciple: 'Gliclazide',
            aic: 'AIC-GLIC',
            atc: 'A10BB09',
            confidence: 'high',
            therapyState: 'active',
            matchType: 'catalog',
            evidence: 'Gliclazide 30mg 1cp ore12',
            sourceType: 'reviewable_local_match',
        },
        {
            drugName: 'Humalog KwikPen',
            dosage: '4 U ai pasti principali',
            activePrinciple: 'Insulina lispro',
            aic: 'AIC-HUMA',
            atc: 'A10AB04',
            confidence: 'high',
            therapyState: 'active',
            matchType: 'catalog',
            evidence: 'Humalog 4 U ai pasti principali',
            sourceType: 'reviewable_local_match',
        },
    ];

    const reconciled = reconcileTherapyCandidatesWithDocumentContext(DISCHARGE_DOCUMENT, therapies);
    const metformin = reconciled.find((therapy) => therapy.activePrinciple?.includes('Metformina'));
    const gliclazide = reconciled.find((therapy) => therapy.activePrinciple === 'Gliclazide');
    const humalog = reconciled.find((therapy) => therapy.drugName.includes('Humalog'));

    assert.equal(metformin?.therapyState, 'transition');
    assert.match(metformin?.blockedReason || '', /domiciliare pre-ricovero/i);
    assert.match(metformin?.evidence || '', /terapia domiciliare/i);
    assert.doesNotMatch(metformin?.evidence || '', /apr:/i);
    assert.doesNotMatch(metformin?.evidence || '', /gliclazide/i);
    assert.equal(gliclazide?.therapyState, 'transition');
    assert.match(gliclazide?.evidence || '', /terapia domiciliare/i);
    assert.doesNotMatch(gliclazide?.evidence || '', /metformina/i);
    assert.equal(humalog?.therapyState, 'active');
    assert.match(humalog?.evidence || '', /terapia alla dimissione/i);
    assert.doesNotMatch(humalog?.evidence || '', /pantoprazolo/i);
});

test('document import downgrades combined diabetic home therapy when discharge insulin resets the plan', () => {
    const therapies: ExtractedPatientReviewTherapy[] = [
        {
            drugName: 'Metformina x2 e Gliclazide',
            dosage: '1000 mg x2 e Gliclazide 30 mg 1 cp',
            confidence: 'medium',
            therapyState: 'active',
            matchType: 'manual',
            evidence: 'Terapia domiciliare: Metformina 1000mg x2, Gliclazide 30mg 1cp ore12',
            sourceType: 'reviewable_local_match',
        },
        {
            drugName: 'Humalog',
            dosage: '4 U ai pasti principali',
            activePrinciple: 'Insulina lispro',
            confidence: 'high',
            therapyState: 'active',
            matchType: 'manual',
            motivation: 'Rivalutazione diabetologica per impostazione terapia',
            evidence: 'Terapia alla dimissione: Humalog 4 U ai pasti principali',
            sourceType: 'reviewable_local_match',
        },
    ];

    const reconciled = reconcileTherapyCandidatesWithDocumentContext(DISCHARGE_DOCUMENT, therapies);
    const homeTherapy = reconciled.find((therapy) => therapy.drugName.startsWith('Metformina'));
    const humalog = reconciled.find((therapy) => therapy.drugName === 'Humalog');

    assert.equal(homeTherapy?.therapyState, 'transition');
    assert.match(homeTherapy?.blockedReason || '', /domiciliare pre-ricovero/i);
    assert.equal(humalog?.therapyState, 'active');
});

test('document import dedupes fallback medications against richer therapy candidates from the same evidence line', () => {
    const candidates: SmartImportTherapyExtraction[] = [
        {
            drugMention: 'Pantoprazolo',
            drugQuery: 'Pantoprazolo',
            activePrinciple: 'Pantoprazolo',
            dosage: '40 mg 1 cp',
            confidence: 'high',
            evidence: 'Pantoprazolo 40 mg 1 cp 30 minuti prima della colazione per due settimane',
            therapyState: 'transition',
            motivation: 'Protezione gastrica post-dimissione',
        },
        {
            drugMention: 'Pantoprazolo 40 mg 1 cp 30 minuti prima della colazione per due settimane',
            drugQuery: 'Pantoprazolo 40 mg 1 cp 30 minuti prima della colazione per due settimane',
            dosage: '40 mg 1 cp',
            confidence: 'medium',
            evidence: 'Pantoprazolo 40 mg 1 cp 30 minuti prima della colazione per due settimane',
            therapyState: 'active',
        },
    ];

    const deduped = dedupeTherapyCandidates(candidates);

    assert.equal(deduped.length, 1);
    assert.equal(deduped[0].activePrinciple, 'Pantoprazolo');
    assert.equal(deduped[0].therapyState, 'transition');
    assert.match(deduped[0].motivation || '', /protezione gastrica/i);
});

test('document import splits compound home medications into separate fallback candidates', () => {
    const candidates = fallbackTherapyCandidates({
        rawText: DISCHARGE_DOCUMENT,
        source: 'hybrid',
        confidence: 0.8,
        medications: ['Metformina 1000 mg x2 e Gliclazide 30 mg 1 cp (terapia domiciliare preesistente)'],
    });
    const metforminCandidates = candidates.filter((candidate) => /Metformina/i.test(candidate.drugMention));
    const gliclazideCandidates = candidates.filter((candidate) => /Gliclazide/i.test(candidate.drugMention));

    assert.ok(metforminCandidates.length >= 1);
    assert.ok(gliclazideCandidates.length >= 1);
    assert.match(metforminCandidates[0].evidence, /Terapia domiciliare/i);
    assert.match(gliclazideCandidates[0].evidence, /Terapia domiciliare/i);
});

test('document import extracts bullet therapies directly from discharge raw text when the model omits them', () => {
    const candidates = fallbackTherapyCandidates({
        rawText: [
            'Terapia alla dimissione',
            'Altre Terapie',
            '- Humalog 4 U ai pasti principali',
            '- Nutridrink 1 al dì',
            'Controlli successivi',
            '- EGDS di controllo tra tre mesi',
        ].join('\n'),
        source: 'hybrid',
        confidence: 0.8,
        medications: [],
    });

    const humalog = candidates.find((candidate) => /Humalog/i.test(candidate.drugMention));
    const nutridrink = candidates.find((candidate) => /Nutridrink/i.test(candidate.drugMention));

    assert.ok(humalog);
    assert.match(humalog?.evidence || '', /Terapia alla dimissione/i);
    assert.ok(nutridrink);
    assert.match(nutridrink?.evidence || '', /Terapia alla dimissione/i);
    assert.match(nutridrink?.evidence || '', /Nutridrink 1 al dì/i);
    assert.doesNotMatch(nutridrink?.evidence || '', /EGDS/i);
});

test('document import extracts embedded home therapy headings from noisy OCR lines', () => {
    const candidates = fallbackTherapyCandidates({
        rawText: 'APR: Ipovisus, Diabete mellito Terapia domiciliare: Metformina 1000mg x2, Gliclazide 30mg 1cp ore12',
        source: 'hybrid',
        confidence: 0.8,
        medications: [],
    });

    const metformina = candidates.find((candidate) => /Metformina/i.test(candidate.drugMention));
    const gliclazide = candidates.find((candidate) => /Gliclazide/i.test(candidate.drugMention));

    assert.ok(metformina);
    assert.match(metformina?.evidence || '', /Terapia domiciliare/i);
    assert.equal(metformina?.drugMention, 'Metformina');
    assert.match(metformina?.drugQuery || '', /Metformina 1000mg/i);
    assert.ok(gliclazide);
    assert.match(gliclazide?.evidence || '', /Terapia domiciliare/i);
    assert.equal(gliclazide?.drugMention, 'Gliclazide');
    assert.match(gliclazide?.drugQuery || '', /Gliclazide 30mg/i);
});

test('document import does not split a single discharge bullet into stray instruction fragments', () => {
    const candidates = fallbackTherapyCandidates({
        rawText: [
            'Terapia alla dimissione',
            'Altre Terapie',
            '- Paracetamolo 1000 mg 1 compressa se febbre/dolore, ripetibile ogni 8 ore (max 3 die)',
        ].join('\n'),
        source: 'hybrid',
        confidence: 0.8,
        medications: [],
    });

    assert.equal(candidates.length, 1);
    assert.match(candidates[0].drugMention, /Paracetamolo/i);
    assert.doesNotMatch(candidates[0].drugMention, /ripetibile/i);
});

test('document import filters report-like therapy candidates before review reconciliation', () => {
    assert.equal(isPlausibleTherapyCandidate({
        drugMention: "RX torace Sovraelevazione dell'emidiaframma destro",
        drugQuery: "RX torace Sovraelevazione dell'emidiaframma destro",
    }), false);
    assert.equal(isPlausibleTherapyCandidate({
        drugMention: 'Humalog',
        drugQuery: 'Humalog',
    }), true);
});

test('document import filters scheduling-only fragments from discharge taper instructions', () => {
    assert.equal(isPlausibleTherapyCandidate({
        drugMention: 'prima di colazione',
        drugQuery: 'prima di colazione',
    }), false);
    assert.equal(isPlausibleTherapyCandidate({
        drugMention: 'Dal 14/04/2026 al 28/04/2026',
        drugQuery: 'Dal 14/04/2026 al 28/04/2026',
    }), false);
});

test('document import drops manual inactive therapies from the final review list', () => {
    assert.equal(shouldRetainReviewTherapy({
        drugName: 'Novasource GI Balance Plus',
        therapyState: 'inactive',
        matchType: 'manual',
        evidence: 'nutrizione enterale con Novasource',
        sourceType: 'reviewable_local_match',
    }), false);
    assert.equal(shouldRetainReviewTherapy({
        drugName: 'GHEMAXAN',
        therapyState: 'transition',
        matchType: 'catalog',
        evidence: 'Terapia alla dimissione - Ghemaxan 4000 UI',
        sourceType: 'reviewable_local_match',
    }), true);
    assert.equal(shouldRetainReviewTherapy({
        drugName: 'Dal 14/04/2026 al 28/04/2026',
        therapyState: 'active',
        matchType: 'manual',
        evidence: 'Indicazioni terapeutiche alla dimissione - Dal 14/04/2026 al 28/04/2026',
        sourceType: 'reviewable_local_match',
    }), false);
});

test('document import keeps discharge therapies under the gestionali heading and ignores dated fragments', () => {
    const candidates = fallbackTherapyCandidates({
        rawText: COLUMBUS_DIMISSIONE_DOCUMENT,
        source: 'hybrid',
        confidence: 0.8,
        medications: [],
    });

    const pantorc = candidates.find((candidate) => /Pantorc/i.test(candidate.drugMention));
    const blopress = candidates.find((candidate) => /Blopress/i.test(candidate.drugMention));
    const deltacortene = candidates.find((candidate) => /Deltacortene/i.test(candidate.drugMention));

    assert.ok(pantorc);
    assert.match(pantorc?.evidence || '', /Indicazioni terapeutiche alla dimissione/i);
    assert.ok(blopress);
    assert.match(blopress?.evidence || '', /Indicazioni terapeutiche alla dimissione/i);
    assert.ok(deltacortene);
    assert.equal(candidates.some((candidate) => /^(?:prima|dopo|dal|schema)\b/i.test(candidate.drugMention)), false);
});

test('document import grounds therapies inside the gestionali discharge heading as active discharge therapy', () => {
    const reconciled = reconcileTherapyCandidatesWithDocumentContext(COLUMBUS_DIMISSIONE_DOCUMENT, [
        {
            drugName: 'Pantorc',
            dosage: '20 mg 1 cp',
            activePrinciple: 'Pantoprazolo',
            confidence: 'high',
            therapyState: 'active',
            matchType: 'manual',
            evidence: 'Pantorc 20 mg cp: 1 cp prima di colazione',
            sourceType: 'reviewable_local_match',
        },
    ]);

    assert.equal(reconciled[0]?.therapyState, 'active');
    assert.match(reconciled[0]?.evidence || '', /Indicazioni terapeutiche alla dimissione/i);
    assert.match(reconciled[0]?.evidence || '', /Pantorc/i);
});

test('document import merges contextual manual therapy with catalog match for the same drug', () => {
    const merged = mergeUniqueTherapies([
        {
            drugName: 'Ghemaxan',
            dosage: '4000 UI 1 fiala/die',
            activePrinciple: 'Enoxaparina sodica',
            aic: 'AIC-GHEM',
            atc: 'B01AB05',
            confidence: 'high',
            therapyState: 'inactive',
            matchType: 'catalog',
            evidence: 'Profilassi antitromboembolica con eparina a basso peso molecolare durante la degenza',
            sourceType: 'reviewable_local_match',
            blockedReason: 'Terapia citata nel decorso di ricovero, non confermata come corrente',
        },
        {
            drugName: 'Ghemaxan / sottocute ore 20 fino al 7/3 poi stop',
            dosage: '4000 UI 1 fiala/die sottocute ore 20',
            confidence: 'medium',
            therapyState: 'transition',
            matchType: 'manual',
            evidence: 'Terapia alla dimissione - Ghemaxan 4000 UI 1 fiala/die sottocute ore 20 fino al 7/3 poi stop',
            blockedReason: 'Terapia temporanea o con rivalutazione ravvicinata',
            sourceType: 'reviewable_local_match',
        },
    ]);

    assert.equal(merged.length, 1);
    assert.equal(merged[0].matchType, 'catalog');
    assert.equal(merged[0].aic, 'AIC-GHEM');
    assert.equal(merged[0].therapyState, 'transition');
    assert.match(merged[0].drugName, /ghemaxan/i);
    assert.match(merged[0].evidence || '', /fino al 7\/3 poi stop/i);
    assert.doesNotMatch(merged[0].evidence || '', /pantoprazolo/i);
    assert.doesNotMatch(merged[0].evidence || '', /paracetamolo/i);
});

test('document import does not merge therapies that only share dosage intensity', () => {
    const merged = mergeUniqueTherapies([
        {
            drugName: 'Ghemaxan',
            dosage: '4000 UI 1 fiala/die',
            activePrinciple: 'Enoxaparina sodica',
            confidence: 'high',
            therapyState: 'transition',
            matchType: 'manual',
            evidence: 'Ghemaxan 4000 UI 1 fiala/die sottocute ore 20 fino al 7/3 poi stop',
            sourceType: 'reviewable_local_match',
        },
        {
            drugName: 'DIBASE',
            dosage: '4000 UI 1 cps/die',
            activePrinciple: 'Colecalciferolo',
            aic: 'AIC-DIBA',
            atc: 'A11CC05',
            confidence: 'high',
            therapyState: 'active',
            matchType: 'catalog',
            evidence: 'Colecalciferolo 4000 UI 1 cps/die',
            sourceType: 'reviewable_local_match',
        },
    ]);

    assert.equal(merged.length, 2);
});

test('document import collapses duplicate catalog brands when principle and dosage are equivalent', () => {
    const merged = mergeUniqueTherapies([
        {
            drugName: 'ACETAMOL',
            dosage: '1000 mg 1 cp se febbre/dolore',
            activePrinciple: 'PARACETAMOLO',
            aic: 'AIC-ACE',
            atc: 'N02BE01',
            confidence: 'high',
            therapyState: 'active',
            matchType: 'catalog',
            evidence: 'Terapia alla dimissione: Paracetamolo 1000 mg 1 compressa se febbre/dolore',
            sourceType: 'reviewable_local_match',
        },
        {
            drugName: 'NIROLEX FEBBRE E DOLORE',
            dosage: '1000 mg 1 cp se febbre/dolore',
            activePrinciple: 'PARACETAMOLO',
            aic: 'AIC-NIR',
            atc: 'N02BE01',
            confidence: 'medium',
            therapyState: 'active',
            matchType: 'catalog',
            evidence: 'Terapia alla dimissione: Paracetamolo 1000 mg 1 compressa se febbre/dolore',
            sourceType: 'reviewable_local_match',
        },
    ]);

    assert.equal(merged.length, 1);
    assert.match(merged[0].drugName, /ACETAMOL|NIROLEX/i);
    assert.equal(merged[0].activePrinciple, 'PARACETAMOLO');
});
