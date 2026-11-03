import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DOSSIER_PREPARED_SCHEMA, anchorPreparedQuote, parsePreparedExtraction, preparedBulkDecisions, preparedDossierFacts, preparedPatientKey, valueInQuote,
    type PreparedSource,
} from './dossier-prepared';
import { extractDossierCandidates, splitDossierUnits, type DossierFact, type DossierRecord } from './dossier-import';

// Dati sintetici. CF con carattere di controllo valido calcolato per i test del dossier.
const CF_A = 'RSSMRA80A01F205X';
const SHA = 'a'.repeat(64);
const now = new Date('2026-11-03T10:00:00.000Z');

const letter = [
    '# Lettera di dimissione',
    `Paziente: **Mario Rossi**, codice fiscale ${CF_A}`,
    'Diagnosi: Ipertensione arteriosa essenziale',
    'Terapia: Ramipril 5 mg 1 cp al mattino',
    'Il paziente riferisce dispnea da sforzo da circa due mesi; ECG con ritmo sinusale.',
].join('\n');

function source(facts: PreparedSource['facts'], extra: Partial<PreparedSource> = {}): PreparedSource {
    return { sha256: SHA, fileName: 'lettera.pdf', patient: { taxCode: CF_A, lastName: 'Rossi', firstName: 'Mario' }, documentDate: '2026-10-20',
        documentType: 'lettera_dimissione', summary: { title: 'Dimissione', text: 'Ricovero per ipertensione; dispnea da sforzo da due mesi.', date: '2026-10-20' },
        facts, coverage: { pages: 1, unreadablePages: [], complete: true, note: '' }, ...extra };
}

test('parse rejects a foreign schema and ignores malformed sources with a warning', () => {
    assert.equal(parsePreparedExtraction('{').ok, false);
    assert.equal(parsePreparedExtraction(JSON.stringify({ schema: 'altro', sources: [] })).ok, false);
    const parsed = parsePreparedExtraction(JSON.stringify({ schema: DOSSIER_PREPARED_SCHEMA, sources: [
        { sha256: 'non-hex', facts: [] },
        { sha256: SHA, documentDate: '2026-02-30', patient: { taxCode: CF_A.toLowerCase(), birthDate: '1980-01-01' },
            facts: [{ kind: 'therapy', values: { drugName: 'Ramipril', dosage: '5 mg', injected: 'x', startDate: 'ieri' }, quote: 'Ramipril 5 mg' }, { kind: 'veleno', values: {} }],
            coverage: { pages: 2, unreadablePages: [2], complete: true } },
        { sha256: SHA, facts: [] },
    ] }));
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    assert.equal(parsed.value.sources.length, 1);
    assert.equal(parsed.warnings.length, 3);
    const [only] = parsed.value.sources;
    assert.equal(only.documentDate, null, 'data impossibile scartata');
    assert.equal(only.patient?.taxCode, CF_A);
    assert.deepEqual(Object.keys(only.facts[0].values).sort(), ['dosage', 'drugName', 'startDate']);
    assert.equal(only.coverage.complete, false, 'una pagina illeggibile annulla la copertura completa');
});

test('quotes anchor by words on the stored text, across markdown, case and accents', () => {
    const text = letter;
    const { units } = splitDossierUnits(text, null);
    const exact = anchorPreparedQuote(text, units, 'paziente: MARIO ROSSI, codice fiscale');
    assert.equal(exact?.match, 'exact');
    assert.equal(text.slice(exact!.evidence.start, exact!.evidence.end), 'Paziente: **Mario Rossi**, codice fiscale');
    assert.equal(anchorPreparedQuote(text, units, 'Ramipril 5 mg 1 cp al mattino')?.match, 'exact');
    // Lettura OCR con una lettera diversa in parole lunghe: approssimata.
    assert.equal(anchorPreparedQuote(text, units, 'riferisce dispnaa da sforzo da circa due mesi')?.match, 'approximate');
    // I numeri non si approssimano mai.
    assert.equal(anchorPreparedQuote(text, units, 'Ramipril 50 mg 1 cp al mattino'), null);
    assert.equal(anchorPreparedQuote(text, units, 'Metformina 500 mg due volte al giorno'), null);
});

test('key values must appear in the quote', () => {
    assert.equal(valueInQuote('Ramipril', 'Terapia: Ramipril 5 mg'), true);
    assert.equal(valueInQuote('I10', 'Diagnosi: Ipertensione arteriosa essenziale'), false);
    assert.equal(valueInQuote('', 'qualsiasi'), true);
});

test('patients group by valid tax code, otherwise by name and birth date', () => {
    assert.equal(preparedPatientKey({ taxCode: CF_A }), `cf:${CF_A}`);
    assert.equal(preparedPatientKey({ taxCode: 'RSSMRA80A01F205Z', lastName: 'Rossi', firstName: 'Mario', birthDate: '1980-01-01' }), 'nome:rossi|mario|1980-01-01');
    assert.equal(preparedPatientKey({ lastName: 'Rossi' }), null);
    assert.equal(preparedPatientKey(null), null);
});

test('prepared facts are checked against the text and replace section proposals', () => {
    const { units } = splitDossierUnits(letter, null);
    const parser = extractDossierCandidates({ fileName: 'lettera.pdf', text: letter, units, documentDate: '2026-10-20', exemptionCodes: new Set() }).facts;
    assert.ok(parser.some((fact) => fact.origin === 'parser:section'));
    const { facts, notes } = preparedDossierFacts({ text: letter, units, documentDate: null, parserFacts: parser, now, source: source([
        { kind: 'therapy', values: { drugName: 'Ramipril', activePrinciple: 'ramipril', dosage: '5 mg 1 cp al mattino', status: 'active' }, quote: 'Ramipril 5 mg 1 cp al mattino' },
        { kind: 'therapy', values: { drugName: 'Metformina', dosage: '500 mg' }, quote: 'Metformina 500 mg due volte al giorno' },
        { kind: 'diagnosis', values: { description: 'Ipertensione arteriosa essenziale', code: 'I10' }, quote: 'Diagnosi: Ipertensione arteriosa essenziale' },
        { kind: 'observation', values: { display: 'Esame inesistente', value: '3', unit: 'zz' }, quote: 'ritmo sinusale' },
        { kind: 'assessment', values: { title: 'Sintomi', text: 'Dispnea da sforzo da due mesi' } },
    ]) });
    assert.ok(!facts.some((fact) => fact.origin === 'parser:section' || fact.origin === 'parser:document'));
    const byDrug = (name: string) => facts.find((fact) => fact.kind === 'therapy' && fact.values.drugName === name)!;
    assert.equal(byDrug('Ramipril').values.preparedCheck, 'verified');
    assert.equal(byDrug('Ramipril').values.status, 'active', 'documento recente: resta in corso');
    assert.equal(byDrug('Ramipril').values.startDate, '2026-10-20');
    assert.equal(byDrug('Metformina').values.preparedCheck, 'not_found');
    assert.equal(byDrug('Metformina').evidence, null);
    assert.equal(facts.find((fact) => fact.kind === 'diagnosis')!.values.preparedCheck, 'value_missing', 'un codice non scritto nel documento non si accetta in blocco');
    assert.equal(facts.find((fact) => fact.kind === 'assessment')!.values.preparedCheck, 'no_quote');
    assert.ok(!facts.some((fact) => fact.kind === 'observation'), 'osservazione senza codice di catalogo esclusa');
    assert.match(notes.join(' '), /senza codice LOINC/u);
    const summary = facts.find((fact) => fact.values.preparedCheck === 'summary')!;
    assert.equal(summary.kind, 'document_entry');
    assert.equal(summary.values.preparedCoverage, 'complete');
    assert.equal(new Set(facts.map((fact) => fact.factId)).size, facts.length);
});

test('an active therapy from an old document becomes historical', () => {
    const text = 'Terapia: Ramipril 5 mg';
    const { units } = splitDossierUnits(text, null);
    const { facts } = preparedDossierFacts({ text, units, documentDate: null, parserFacts: [], now,
        source: source([{ kind: 'therapy', values: { drugName: 'Ramipril', dosage: '5 mg', status: 'active' }, quote: 'Ramipril 5 mg' }], { documentDate: '2022-03-01' }) });
    assert.equal(facts[0].values.status, 'completed');
    assert.match(facts[0].values.temporality, /alla data del documento/u);
});

test('without app text, quotes cannot be verified and the parser document entry stays when no summary', () => {
    const { facts } = preparedDossierFacts({ text: null, units: [], documentDate: null, now,
        parserFacts: [{ factId: 'd', kind: 'document_entry', origin: 'parser:document', evidence: null, negated: false, values: { title: 'Documento', date: '2026-10-20', text: '', textSource: 'document' }, decision: 'pending' }],
        source: source([{ kind: 'exemption', values: { code: '031' }, quote: 'Esenzione 031' }], { summary: null }) });
    assert.equal(facts.find((fact) => fact.kind === 'exemption')!.values.preparedCheck, 'no_text');
    assert.ok(facts.some((fact) => fact.origin === 'parser:document'));
});

function record(facts: DossierFact[]): DossierRecord {
    return { facts, residualReview: { state: 'pending' } } as unknown as DossierRecord;
}

test('bulk decisions accept only verified, new, complete proposals', () => {
    const fact = (factId: string, extra: Partial<DossierFact>): DossierFact => ({ factId, kind: 'therapy', origin: 'prepared', negated: false, decision: 'pending',
        evidence: { unit: 0, start: 0, end: 5, excerpt: 'x' }, values: { drugName: 'Ramipril', dosage: '5 mg', status: 'completed', startDate: '2026-10-20', preparedCheck: 'verified' }, ...extra });
    const facts: DossierFact[] = [
        fact('ok', {}),
        fact('approx', { values: { drugName: 'Bisoprololo', dosage: '1,25 mg', status: 'completed', startDate: '2026-10-20', preparedCheck: 'approximate' } }),
        fact('missing', { evidence: null, values: { drugName: 'Metformina', dosage: '500 mg', status: 'completed', startDate: '2026-10-20', preparedCheck: 'not_found' } }),
        fact('negated', { negated: true }),
        fact('blocked', { values: { drugName: 'Ramipril', dosage: '', status: 'completed', startDate: '2026-10-20', preparedCheck: 'verified' } }),
        fact('present', {}),
        fact('conflict', {}),
        fact('dup', {}),
        fact('section', { origin: 'parser:section' }),
        { factId: 'sum', kind: 'document_entry', origin: 'prepared', evidence: null, negated: false, decision: 'pending',
            values: { title: 'Sintesi', date: '2026-10-20', text: 'Testo', textSource: 'prepared', preparedCheck: 'summary', preparedCoverage: 'complete' } },
        fact('decided', { decision: 'rejected' }),
    ];
    const assessments: Record<string, { status: 'new' | 'already_present' | 'duplicate_in_dossier' | 'conflict'; detail: string; relatedFactRefs: string[] }> = {
        'doc#present': { status: 'already_present', detail: '', relatedFactRefs: [] },
        'doc#conflict': { status: 'conflict', detail: '', relatedFactRefs: [] },
        'doc#dup': { status: 'duplicate_in_dossier', detail: '', relatedFactRefs: ['doc#ok'] },
    };
    const result = preparedBulkDecisions({ record: record(facts), documentKey: 'doc', assessment: (ref) => assessments[ref], exemptionCodes: new Set(), acceptedElsewhere: new Set() });
    const decision = Object.fromEntries(result.facts.map((item) => [item.factId, item.decision]));
    assert.deepEqual(decision, { ok: 'accepted', approx: 'accepted', missing: 'pending', negated: 'pending', blocked: 'pending', present: 'already_present',
        conflict: 'pending', dup: 'already_present', section: 'rejected', sum: 'accepted', decided: 'rejected' });
    assert.deepEqual(result.counts, { accepted: 3, alreadyPresent: 2, superseded: 1, leftPending: 4 });
    assert.equal(result.acknowledgeResidual, true);
    const partial = preparedBulkDecisions({ record: record([{ ...facts[9], values: { ...facts[9].values, preparedCoverage: 'partial' } }]), documentKey: 'doc',
        assessment: () => undefined, exemptionCodes: new Set(), acceptedElsewhere: new Set() });
    assert.equal(partial.acknowledgeResidual, false, 'copertura parziale: il residuo resta al medico');
});
