import test from 'node:test';
import assert from 'node:assert/strict';

import { splitDossierUnits } from './dossier-import';
import {
    anchorPreparedQuote,
    preparedDossierFacts,
    preparedFactEligible,
    type PreparedFactInput,
    type PreparedSource,
} from './dossier-prepared';
import { anchorTabularQuote, extractMarkdownTableRows } from './dossier-tabular-quote';

const NOW = new Date('2026-11-24T12:00:00.000Z');
const CF_A = 'RSSMRA80A01F205X';

function makeSource(fileName: string, sha256: string, cf: string, facts: PreparedFactInput[]): PreparedSource {
    return {
        sha256,
        fileName,
        patient: { taxCode: cf },
        documentDate: '2026-11-20',
        documentType: 'altro',
        summary: null,
        facts,
        coverage: { pages: 1, unreadablePages: [], complete: true, note: '' },
    };
}

test('WUL-926: tabular matcher unit behavior on cell interleaving, partial visual lines, escaped pipes, and multi-unit preference', () => {
    const tableDoc = [
        '|CODICE AIC|DESCRIZIONE FARMACO|QTA|NOTE AIFA|',
        '|---|---|---|---|',
        '|034812019|RAMIPRIL 5 MG 28 COMPRESSE 1 compressa al mattino|2|Fascia A\\|Rinnovo|',
        '|029445022|METFORMINA 500 MG 30 COMPRESSE 1 compressa dopo cena|2|Fascia A|',
    ].join('\n');
    const { units } = splitDossierUnits(tableDoc, null);

    const completeQuote = [
        '034812019       RAMIPRIL 5 MG 28 COMPRESSE              2    Fascia A',
        '                1 compressa al mattino                       Rinnovo',
    ].join('\n');
    const completeMatch = anchorTabularQuote(tableDoc, units, completeQuote);
    assert.equal(completeMatch?.match, 'exact');
    assert.equal(completeMatch?.complete, true);
    assert.equal(completeMatch?.evidence.excerpt, '034812019|RAMIPRIL 5 MG 28 COMPRESSE 1 compressa al mattino|2|Fascia A\\|Rinnovo');
    assert.equal(anchorPreparedQuote(tableDoc, units, completeQuote)?.evidence.excerpt, completeMatch?.evidence.excerpt);

    const singleSpaceComplete = [
        '034812019 RAMIPRIL 5 MG 28 COMPRESSE 2 Fascia A',
        '1 compressa al mattino Rinnovo',
    ].join('\n');
    assert.equal(anchorTabularQuote(tableDoc, units, singleSpaceComplete)?.complete, true);

    const visualLineQuote = '034812019       RAMIPRIL 5 MG 28 COMPRESSE              2    Fascia A';
    const visualMatch = anchorTabularQuote(tableDoc, units, visualLineQuote);
    assert.equal(visualMatch?.match, 'exact');
    assert.equal(visualMatch?.complete, false);
    assert.equal(visualMatch?.words.includes('mattino'), true);
    assert.equal(anchorPreparedQuote(tableDoc, units, visualLineQuote)?.evidence.excerpt, '034812019|RAMIPRIL 5 MG 28 COMPRESSE 1 compressa al mattino|2|Fascia A');

    const multiPage = [
        '## Pagina 1',
        '|CODICE|DESCRIZIONE|QTA|',
        '|---|---|---|',
        '|034812019|RAMIPRIL 5 MG 28 COMPRESSE 1 cp al mattino|2|',
        '## Pagina 2',
        '|CODICE|DESCRIZIONE|QTA|',
        '|---|---|---|',
        '|034812019|RAMIPRIL 5 MG 28 COMPRESSE|2|',
    ].join('\n');
    const pageUnits = splitDossierUnits(multiPage, 2).units;
    const preferred = anchorTabularQuote(multiPage, pageUnits, '034812019   RAMIPRIL 5 MG 28 COMPRESSE   2');
    assert.equal(preferred?.complete, true);
    assert.equal(preferred?.evidence.unit, 2);
    assert.equal(anchorPreparedQuote(multiPage, pageUnits, '034812019   RAMIPRIL 5 MG 28 COMPRESSE   2')?.evidence.unit, 2);
});

test('WUL-926: counterexamples stay unverified and ineligible', () => {
    const tableDoc = [
        '# PROMEMORIA SISS',
        '|CODICE AIC|DESCRIZIONE FARMACO|QTA|NOTE AIFA|',
        '|---|---|---|---|',
        '|034812019|RAMIPRIL 5 MG 28 COMPRESSE 1 compressa al mattino|2|Fascia A\\|Rinnovo|',
        '|029445022|METFORMINA 500 MG 30 COMPRESSE 1 compressa dopo cena|2|Fascia A|',
        '|036512018|BISOPROLOLO 2,5 MG 28 COMPRESSE sospeso per bradicardia|1|Nota 13|',
        '|041112099|Il paziente non assume WARFARIN 5 MG da anni|1|Note|',
    ].join('\n');
    const { units } = splitDossierUnits(tableDoc, null);

    const rejectedQuotes = [
        '034812019       ENALAPRIL 5 MG 28 COMPRESSE             2    Fascia A',
        '034812019       RAMIPRIL 5 MG 28 COMPRESSE              2    Fascia B',
        '034812019       RAMIPRIL 10 MG 28 COMPRESSE             2    Fascia A',
        '036512018       BISOPROLOLO 25 MG 28 COMPRESSE          1    Nota 13',
        '036512018       BISOPROLOLO 2.5 MG 28 COMPRESSE         1    Nota 13',
        '034812019       RAMIPRIL 500 MG 30 COMPRESSE            2    Fascia A',
        '034812019       RAMIPRIL 5 MG 28 COMPRESSE              2    Fascia A\n                1 compressa dopo cena',
        '034812019       METFORMINA 500 MG 30 COMPRESSE          2    Fascia A',
        '038451029       PANTOPRAZOLO 40 MG 14 COMPRESSE         2    Ripetibile',
        '041112099       Il paziente assume WARFARIN 5 MG da anni     1    Note',
        '041112099       Il paziente   assume WARFARIN 5 MG da anni   1    Note',
        '041112099       Il paziente\nassume WARFARIN 5 MG da anni   1    Note',
        '034812019 RAMIPRIL 2 Fascia A',
        'Fascia A        2               RAMIPRIL 5 MG 28 COMPRESSE',
    ];

    for (const badQuote of rejectedQuotes) {
        assert.equal(anchorPreparedQuote(tableDoc, units, badQuote), null, `must reject: ${badQuote}`);
    }

    const facts: PreparedFactInput[] = [
        {
            kind: 'therapy',
            values: { drugName: 'Ramipril', dosage: '5 mg', status: 'active' },
            quote: '034812019       RAMIPRIL 5 MG 28 COMPRESSE              2    Fascia A\n                1 compressa al mattino                       Rinnovo',
        },
        { kind: 'therapy', values: { drugName: 'Ramipril', dosage: '5 mg', status: 'active' }, quote: '034812019       RAMIPRIL 5 MG 28 COMPRESSE              2    Fascia A' },
        { kind: 'therapy', values: { drugName: 'Ramipril', dosage: '10 mg', status: 'active' }, quote: '034812019       RAMIPRIL 5 MG 28 COMPRESSE              2    Fascia A' },
        { kind: 'therapy', values: { drugName: 'Ramipril', dosage: '2 mg', status: 'active' }, quote: '034812019       RAMIPRIL                                2    Fascia A' },
        { kind: 'therapy', values: { drugName: 'Bisoprololo', dosage: '2,5 mg', status: 'active' }, quote: '036512018       BISOPROLOLO 2,5 MG 28 COMPRESSE         1    Nota 13' },
        { kind: 'therapy', values: { drugName: 'Warfarin', dosage: '5 mg', status: 'active' }, quote: '041112099       WARFARIN 5 MG da anni                   1    Note' },
        { kind: 'anamnesis', values: { text: '036512018       BISOPROLOLO 2,5 MG 28 COMPRESSE         1    Nota 13' } },
    ];
    const source = makeSource('controesempi.pdf', 'b'.repeat(64), CF_A, facts);
    const result = preparedDossierFacts({ source, text: tableDoc, units, documentDate: '2026-11-20', parserFacts: [], now: NOW });
    assert.deepEqual(
        result.facts.map((fact) => [fact.values.preparedCheck, fact.negated, preparedFactEligible(fact, new Set())]),
        [
            ['verified', false, true],
            ['verified', false, true],
            ['value_missing', false, false],
            ['value_missing', false, false],
            ['status_conflict', false, false],
            ['verified', true, false],
            ['paraphrase', false, false],
        ],
    );
});

test('WUL-926: tabular boundary counterexamples block trailing suspension, leading negation, and wrapped cell suspension', () => {
    const tableDoc = [
        '# PROMEMORIA SISS',
        '|CODICE AIC|DESCRIZIONE FARMACO|QTA|NOTE AIFA|',
        '|---|---|---|---|',
        '|036512018|BISOPROLOLO 2,5 MG 28 COMPRESSE|1|Nota 13 sospeso dal 10/11|',
        '|041112099|non assumere se INR oltre 3 WARFARIN 5 MG|1|Note|',
        '|034812019|RAMIPRIL 5 MG 28 COMPRESSE terapia sospesa dal cardiologo|2|Fascia A|',
    ].join('\n');
    const { units } = splitDossierUnits(tableDoc, null);

    const facts: PreparedFactInput[] = [
        {
            kind: 'therapy',
            values: { drugName: 'Bisoprololo', dosage: '2,5 mg', status: 'active' },
            quote: '036512018       BISOPROLOLO 2,5 MG 28 COMPRESSE         1    Nota 13',
        },
        {
            kind: 'therapy',
            values: { drugName: 'Warfarin', dosage: '5 mg', status: 'active' },
            quote: 'assumere se INR oltre 3 WARFARIN 5 MG                   1    Note',
        },
        {
            kind: 'therapy',
            values: { drugName: 'Ramipril', dosage: '5 mg', status: 'active' },
            quote: '034812019       RAMIPRIL 5 MG 28 COMPRESSE              2    Fascia A',
        },
    ];
    const source = makeSource('controesempi-bordi.pdf', 'd'.repeat(64), CF_A, facts);
    const result = preparedDossierFacts({ source, text: tableDoc, units, documentDate: '2026-11-20', parserFacts: [], now: NOW });
    assert.deepEqual(
        result.facts.map((fact) => [fact.values.preparedCheck, fact.negated, fact.values.contextReview ?? '', preparedFactEligible(fact, new Set())]),
        [
            ['status_conflict', false, 'suspension', false],
            ['verified', true, 'negation', false],
            ['status_conflict', false, 'suspension', false],
        ],
    );
    assert.equal(result.facts[0].evidence?.excerpt, '036512018|BISOPROLOLO 2,5 MG 28 COMPRESSE|1|Nota 13');
    assert.equal(result.facts[1].evidence?.excerpt, 'assumere se INR oltre 3 WARFARIN 5 MG|1|Note');
    assert.equal(result.facts[2].evidence?.excerpt, '034812019|RAMIPRIL 5 MG 28 COMPRESSE terapia sospesa dal cardiologo|2|Fascia A');
});

test('WUL-926: non-tabular documents keep main behavior unchanged', () => {
    const proseLetter = [
        '# Lettera di dimissione',
        `Paziente: Mario Rossi, codice fiscale ${CF_A}`,
        'Terapia: Ramipril 5 mg 28 compresse al mattino, Metformina 500 mg dopo cena.',
        'Glucosio | 93 | mg/dL | 70-100',
        'Creatinina | 1,1 | mg/dL | 0,7-1,2',
    ].join('\n');
    const { units } = splitDossierUnits(proseLetter, null);

    assert.equal(extractMarkdownTableRows(proseLetter).length, 0);
    assert.equal(anchorTabularQuote(proseLetter, units, 'Ramipril 5 mg   al mattino'), null);
    assert.equal(anchorPreparedQuote(proseLetter, units, 'Ramipril 5 mg   al mattino'), null);
    assert.equal(anchorPreparedQuote(proseLetter, units, 'Glucosio   mg/dL   70-100'), null);
    assert.equal(anchorPreparedQuote(proseLetter, units, 'Glucosio 93 mg/dL 70-100')?.match, 'exact');
    assert.equal(anchorPreparedQuote(proseLetter, units, 'Ramipril 5 mg 28 compresse al mattino')?.match, 'exact');
});
