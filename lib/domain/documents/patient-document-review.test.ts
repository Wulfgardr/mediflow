/* @Codex */
import test from 'node:test';
/* @Codex */
import assert from 'node:assert/strict';
/* @Codex */
import { buildPatientDocumentReviewDraft } from './patient-document-review';
/* @Codex */
import type { ExtractedPatientData } from '../../pdf-service';

test('document review suggests only compact recent follow-up notes and leaves them opt-in', () => {
    const data: ExtractedPatientData = {
        rawText: [
            'APR: Ipovisus, Disturbo psichiatrico non meglio precisato, Diabete mellito',
            'Terapia domiciliare: Metformina 1000mg x2, Gliclazide 30mg 1cp ore12',
            'Terapia alla dimissione',
            '- Humalog 4 U ai pasti principali',
            '- Pantoprazolo 40 mg 1 cp 30 minuti prima della colazione per due settimane',
            'Controlli successivi',
            '- TAC addome con mdc tra circa 2-3 settimane',
            '- EGDS di controllo tra tre mesi',
            'RIVALUTAZIONE DIABETOLOGICA PER IMPOSTAZIONE TERAPIA',
        ].join('\n'),
        source: 'hybrid',
        confidence: 0.92,
        firstName: 'Giuseppe',
        lastName: 'Lubrano',
    };

    const draft = buildPatientDocumentReviewDraft(data);
    const notesField = draft.fields.find((field) => field.key === 'notes');

    assert.ok(notesField);
    assert.equal(notesField?.included, false);
    assert.match(notesField?.value || '', /TAC addome/i);
    assert.match(notesField?.value || '', /EGDS di controllo/i);
    assert.doesNotMatch(notesField?.value || '', /RIVALUTAZIONE DIABETOLOGICA/i);
    assert.doesNotMatch(notesField?.value || '', /Humalog/i);
    assert.doesNotMatch(notesField?.value || '', /Metformina/i);
    assert.ok((notesField?.value || '').length <= 220);
});

test('document review excludes footer boilerplate from suggested notes', () => {
    const data: ExtractedPatientData = {
        rawText: [
            'Controlli successivi',
            'TAC addome con mdc tra circa 2-3 settimane',
            'EGDS di controllo tra tre mesi',
            'LIVIA ROBBIOLO Pagina 5 di 6 2026015505 - Versione 1 Documento informatico firmato digitalmente',
            'Archiviato da questo ente ai sensi del D.Lgs. 82/2005',
        ].join('\n'),
        source: 'hybrid',
        confidence: 0.92,
    };

    const draft = buildPatientDocumentReviewDraft(data);
    const notesField = draft.fields.find((field) => field.key === 'notes');

    assert.ok(notesField);
    assert.match(notesField?.value || '', /TAC addome/i);
    assert.doesNotMatch(notesField?.value || '', /LIVIA ROBBIOLO/i);
    assert.doesNotMatch(notesField?.value || '', /D\.Lgs/i);
});

test('document review keeps accessory instructions out of patient notes', () => {
    const data: ExtractedPatientData = {
        rawText: [
            'Controlli successivi',
            'TAC addome con mdc tra circa 2-3 settimane',
            'Altre prescrizioni',
            'Dieta leggera ipolipidica per una settimana',
            'Medicazioni con cerotto sterile ogni 48 ore',
        ].join('\n'),
        source: 'hybrid',
        confidence: 0.92,
    };

    const draft = buildPatientDocumentReviewDraft(data);
    const notesField = draft.fields.find((field) => field.key === 'notes');

    assert.ok(notesField);
    assert.match(notesField?.value || '', /TAC addome/i);
    assert.doesNotMatch(notesField?.value || '', /Dieta/i);
    assert.doesNotMatch(notesField?.value || '', /Medicazioni/i);
});

test('document review auto-selects only catalog therapies with plausible clinical support', () => {
    const data: ExtractedPatientData = {
        rawText: [
            'APR: Diabete mellito tipo 2, cachessia',
            'Terapia alla dimissione',
            '- Humalog 4 U ai pasti principali',
            '- Becozym 1 cp al dì',
            '- Nutridrink 1 al dì',
        ].join('\n'),
        source: 'hybrid',
        confidence: 0.92,
        problemStatements: [
            {
                label: 'Diabete mellito tipo 2',
                icdQuery: 'type 2 diabetes mellitus',
                confidence: 'high',
                evidence: 'Diabete mellito tipo 2',
            },
            {
                label: 'Cachessia',
                icdQuery: 'cachexia',
                confidence: 'high',
                evidence: 'cachessia',
            },
        ],
        reviewTherapies: [
            {
                drugName: 'HUMALOG',
                dosage: '4 U ai pasti principali',
                activePrinciple: 'INSULINA LISPRO',
                aic: '033637416',
                atc: 'A10AB04',
                confidence: 'high',
                therapyState: 'active',
                matchType: 'catalog',
                evidence: 'Terapia alla dimissione - Humalog 4 U ai pasti principali',
                sourceType: 'reviewable_local_match',
            },
            {
                drugName: 'BECOZYM',
                dosage: '1 cp al dì',
                activePrinciple: 'COMPLESSO VITAMINICO',
                aic: '005647033',
                atc: 'A11EA',
                confidence: 'high',
                therapyState: 'active',
                matchType: 'catalog',
                evidence: 'Terapia alla dimissione - Becozym 1 cp al dì',
                sourceType: 'reviewable_local_match',
            },
            {
                drugName: 'Nutridrink 1 al dì',
                dosage: '1 al dì',
                confidence: 'medium',
                therapyState: 'active',
                matchType: 'manual',
                evidence: 'Terapia alla dimissione - Nutridrink 1 al dì',
                sourceType: 'reviewable_local_match',
            },
        ],
    };

    const draft = buildPatientDocumentReviewDraft(data);
    const humalog = draft.medications.find((item) => item.drugName === 'HUMALOG');
    const becozym = draft.medications.find((item) => item.drugName === 'BECOZYM');
    const nutridrink = draft.medications.find((item) => item.drugName.includes('Nutridrink'));

    assert.equal(humalog?.included, true);
    assert.equal(becozym?.included, false);
    assert.match(becozym?.blockedReason || '', /integrativo|nutrizionale/i);
    assert.equal(nutridrink?.included, false);
    assert.match(nutridrink?.blockedReason || '', /AIFA/i);
});

test('document review accepts discharge therapies under the gestionali heading when clinically coherent', () => {
    const data: ExtractedPatientData = {
        rawText: [
            'Diagnosi: Polimialgia reumatica, fibrillazione atriale persistente, ipertensione arteriosa',
            'Indicazioni terapeutiche e gestionali alla dimissione.',
            '- Pantorc 20 mg cp: 1 cp prima di colazione',
            '- Blopress 16 mg cp: 1 cp dopo colazione',
            '- Deltacortene dopo colazione secondo schema*',
            '- Rytmonorm 150 mg cp: 1 cp dopo colazione',
            '- Bisoprololo 1.25 mg cp: 1 cp dopo colazione + 1 cp dopo cena',
        ].join('\n'),
        source: 'regex',
        confidence: 0.9,
        reviewDiagnoses: [
            {
                label: 'Polymyalgia rheumatica',
                code: 'FA22',
                description: 'Polymyalgia rheumatica',
                system: 'ICD-11',
                confidence: 'high',
                evidence: 'Polimialgia reumatica',
                sourceType: 'reviewable_local_match',
            },
            {
                label: 'Persistent atrial fibrillation',
                code: 'BC81.31',
                description: 'Persistent atrial fibrillation',
                system: 'ICD-11',
                confidence: 'high',
                evidence: 'fibrillazione atriale persistente',
                sourceType: 'reviewable_local_match',
            },
        ],
        reviewTherapies: [
            {
                drugName: 'PANTORC',
                dosage: '1 cp al mattino',
                activePrinciple: 'PANTOPRAZOLO',
                aic: '043517046',
                atc: 'A02BC02',
                confidence: 'high',
                therapyState: 'active',
                matchType: 'catalog',
                evidence: 'Indicazioni terapeutiche alla dimissione - Pantorc 20 mg cp: 1 cp prima di colazione',
                sourceType: 'reviewable_local_match',
            },
            {
                drugName: 'DELTACORTENE',
                dosage: 'Schema di tapering (25mg->5mg)',
                activePrinciple: 'PREDNISONE',
                aic: '010089035',
                atc: 'H02AB07',
                confidence: 'high',
                therapyState: 'active',
                matchType: 'catalog',
                evidence: 'Indicazioni terapeutiche alla dimissione - Deltacortene dopo colazione secondo schema*',
                sourceType: 'reviewable_local_match',
            },
            {
                drugName: 'BISOPROLOLO ALMUS',
                dosage: '1.25 mg (1 cp mattina + 1 cp sera)',
                activePrinciple: 'BISOPROLOLO FUMARATO',
                aic: '038810026',
                atc: 'C07AB07',
                confidence: 'high',
                therapyState: 'active',
                matchType: 'catalog',
                evidence: 'Indicazioni terapeutiche alla dimissione - Bisoprololo 1.25 mg cp: 1 cp dopo colazione + 1 cp dopo cena',
                sourceType: 'reviewable_local_match',
            },
        ],
    };

    const draft = buildPatientDocumentReviewDraft(data);
    const pantorc = draft.medications.find((item) => item.drugName === 'PANTORC');
    const deltacortene = draft.medications.find((item) => item.drugName === 'DELTACORTENE');
    const bisoprololo = draft.medications.find((item) => item.drugName === 'BISOPROLOLO ALMUS');

    assert.equal(pantorc?.included, false);
    assert.equal(deltacortene?.included, true);
    assert.equal(bisoprololo?.included, true);
});
