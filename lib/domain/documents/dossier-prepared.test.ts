import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DOSSIER_PREPARED_SCHEMA, anchorPreparedQuote, parsePreparedExtraction, preparedBulkDecisions, preparedDossierFacts, preparedPatientKey, valueInWords,
    preparedTokens, type PreparedFactInput, type PreparedSource,
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
    'Il paziente non assume warfarin da anni per pregresso sanguinamento.',
    'Colesterolo totale 95 mg/dL; Creatinina 0,9 mg/dL',
    'Il paziente riferisce dispnea da sforzo da circa due mesi; ECG con ritmo sinusale.',
].join('\n');
const { units } = splitDossierUnits(letter, null);

function source(facts: PreparedFactInput[], extra: Partial<PreparedSource> = {}): PreparedSource {
    return { sha256: SHA, fileName: 'lettera.pdf', patient: { taxCode: CF_A, lastName: 'Rossi', firstName: 'Mario' }, documentDate: '2026-10-20',
        documentType: 'lettera_dimissione', summary: { title: 'Dimissione', text: 'Ricovero per ipertensione; dispnea da sforzo da due mesi.', date: '2026-10-20' },
        facts, coverage: { pages: 1, unreadablePages: [], complete: true, note: '' }, ...extra };
}

function prepared(facts: PreparedFactInput[], extra: Partial<PreparedSource> = {}, appDate: string | null = '2026-10-20') {
    return preparedDossierFacts({ source: source(facts, extra), text: letter, units, documentDate: appDate, parserFacts: [], now })
        .facts.filter((fact) => fact.origin === 'prepared' && fact.values.preparedCheck !== 'summary');
}
const checkOf = (facts: PreparedFactInput[]) => prepared(facts).map((fact) => fact.values.preparedCheck);

test('parse rejects a foreign schema, prototype kinds and malformed sources with a warning', () => {
    assert.equal(parsePreparedExtraction('{').ok, false);
    assert.equal(parsePreparedExtraction(JSON.stringify({ schema: 'altro', sources: [] })).ok, false);
    const parsed = parsePreparedExtraction(JSON.stringify({ schema: DOSSIER_PREPARED_SCHEMA, sources: [
        { sha256: 'non-hex', facts: [] },
        { sha256: SHA, documentDate: '2026-02-30', patient: { taxCode: CF_A.toLowerCase(), birthDate: '1980-01-01' },
            facts: [{ kind: 'therapy', values: { drugName: 'Ramipril', dosage: '5 mg', injected: 'x', preparedCheck: 'verified', startDate: 'ieri' }, quote: 'Ramipril 5 mg' },
                { kind: 'veleno', values: {} }, { kind: 'constructor', values: {} }, { kind: 'toString', values: {} }],
            coverage: { pages: 2, unreadablePages: [2], complete: true } },
        { sha256: SHA, facts: [] },
    ] }));
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    assert.equal(parsed.value.sources.length, 1);
    assert.equal(parsed.warnings.length, 5);
    const [only] = parsed.value.sources;
    assert.equal(only.documentDate, null, 'data impossibile scartata');
    assert.equal(only.patient?.taxCode, CF_A);
    assert.deepEqual(Object.keys(only.facts[0].values).sort(), ['dosage', 'drugName', 'startDate'], 'preparedCheck non si inietta');
    assert.equal(only.coverage.complete, false, 'una pagina illeggibile annulla la copertura completa');
});

test('quotes anchor by words across markdown, case and accents; short quotes and loose matches do not', () => {
    const exact = anchorPreparedQuote(letter, units, 'paziente: MARIO ROSSI, codice fiscale');
    assert.equal(exact?.match, 'exact');
    assert.equal(letter.slice(exact!.evidence.start, exact!.evidence.end), 'Paziente: **Mario Rossi**, codice fiscale');
    assert.equal(anchorPreparedQuote(letter, units, 'Ramipril 5 mg 1 cp al mattino')?.match, 'exact');
    assert.equal(anchorPreparedQuote(letter, units, 'riferisce dispnaa da sforzo da circa due mesi')?.match, 'approximate', 'una lettera in una parola lunga');
    assert.equal(anchorPreparedQuote(letter, units, 'Ramipril 50 mg 1 cp al mattino'), null, 'i numeri non si approssimano');
    assert.equal(anchorPreparedQuote(letter, units, '5'), null, 'una parola sola non è una citazione');
    assert.equal(anchorPreparedQuote(letter, units, 'Diagnosi'), null);
    // Caso A: una negazione cambiata non passa per lettura approssimata.
    assert.equal(anchorPreparedQuote(letter, units, 'Il paziente ora assume warfarin da anni per'), null);
    // Caso A2: un farmaco diverso non passa.
    assert.equal(anchorPreparedQuote(letter, units, 'Il paziente non assume aspirina da anni per'), null);
    assert.equal(anchorPreparedQuote(letter, units, 'Metformina 500 mg due volte al giorno'), null);
});

test('numbers keep their separators and accents in either normal form match', () => {
    assert.deepEqual(preparedTokens('piastrine 1.500 e 1,25 mg; ISO 12.06.06').map((token) => token.text), ['piastrine', '1.500', 'e', '1,25', 'mg', 'iso', '12.06.06']);
    assert.equal(valueInWords('1.500', preparedTokens('piastrine 1,500').map((token) => token.text), 'all'), false, 'caso J');
    assert.deepEqual(preparedTokens('117,2mg /75mmHg E11.9').map((token) => token.text), ['117,2', 'mg', '75', 'mmhg', 'e', '11.9']);
    assert.deepEqual(preparedTokens('caffé città').map((token) => token.text), preparedTokens('caffé città').map((token) => token.text));
});

test('every clinical field is checked on the document passage, not on the proposed quote', () => {
    // Caso L: valore inventato con citazione di una parola.
    assert.deepEqual(checkOf([{ kind: 'observation', values: { display: 'Creatinina', value: '5', unit: 'mg/dL' }, quote: '5' }]), ['short_quote']);
    // Caso C: esame scambiato su un valore vero.
    assert.deepEqual(checkOf([{ kind: 'observation', values: { display: 'Glucosio', value: '95', unit: 'mg/dL' }, quote: 'Colesterolo totale 95 mg/dL' }]), [],
        'glucosio senza catalogo per mg/dL non diventa osservazione');
    const swapped = prepared([{ kind: 'observation', values: { display: 'Creatinina', value: '95', unit: 'mg/dL' }, quote: 'Colesterolo totale 95 mg/dL' }]);
    assert.equal(swapped[0].values.preparedCheck, 'value_missing');
    const creatinine = prepared([{ kind: 'observation', values: { display: 'Creatinina', value: '0,9', unit: 'mg/dL', code: '99999-9', unitCode: 'furlongs' }, quote: 'Creatinina 0,9 mg/dL' }]);
    assert.equal(creatinine[0].values.preparedCheck, 'verified');
    assert.equal(creatinine[0].values.code, '2160-0', 'caso D: codice solo dal catalogo');
    assert.equal(creatinine[0].values.unitCode, 'mg/dL');
    // Caso B: dose e principio attivo non scritti.
    const therapy = prepared([{ kind: 'therapy', values: { drugName: 'Ramipril', activePrinciple: 'enalapril', dosage: '10 mg 2 cp', status: 'active' }, quote: 'Terapia: Ramipril 5 mg 1 cp' }]);
    assert.equal(therapy[0].values.preparedCheck, 'value_missing');
    assert.equal(therapy[0].values.activePrinciple, undefined);
    assert.match(therapy[0].values.preparedNotes, /enalapril/u);
    const good = prepared([{ kind: 'therapy', values: { drugName: 'Ramipril', activePrinciple: 'ramipril', dosage: '5 mg 1 cp al mattino per os', status: 'active' }, quote: 'Terapia: Ramipril 5 mg 1 cp al mattino' }]);
    assert.equal(good[0].values.preparedCheck, 'verified', 'la via non scritta non conta: contano le dosi');
    assert.equal(good[0].values.activePrinciple, 'ramipril');
    assert.equal(good[0].values.status, 'active');
    // Diagnosi: descrizione e codice dal passo.
    assert.deepEqual(checkOf([{ kind: 'diagnosis', values: { description: 'Ipertensione arteriosa essenziale', code: 'I10' }, quote: 'Diagnosi: Ipertensione arteriosa essenziale' }]), ['value_missing']);
    assert.deepEqual(checkOf([{ kind: 'diagnosis', values: { description: 'Carcinoma polmonare' }, quote: 'Diagnosi: Ipertensione arteriosa essenziale' }]), ['value_missing']);
    assert.deepEqual(checkOf([{ kind: 'diagnosis', values: { description: 'Ipertensione arteriosa' }, quote: 'Diagnosi: Ipertensione arteriosa essenziale' }]), ['verified']);
});

test('narrative facts are verified only when their text is a passage of the document', () => {
    // Caso E.
    assert.deepEqual(checkOf([{ kind: 'anamnesis', values: { text: 'Pregresso infarto miocardico' }, quote: 'Il paziente riferisce dispnea' }]), ['paraphrase']);
    assert.deepEqual(checkOf([{ kind: 'assessment', values: { title: 'Sintomi', text: 'riferisce dispnea da sforzo da circa due mesi' } }]), ['verified']);
});

test('dates: the app date wins, future dates are dropped, an old or undated active therapy is historical', () => {
    const quote = 'Terapia: Ramipril 5 mg 1 cp al mattino';
    const therapy = (extra: Partial<PreparedSource>, appDate: string | null) =>
        prepared([{ kind: 'therapy', values: { drugName: 'Ramipril', dosage: '5 mg', status: 'active' }, quote }], extra, appDate)[0].values;
    // Caso F.
    const future = therapy({ documentDate: '2027-06-01' }, '2019-03-01');
    assert.equal(future.startDate, '2019-03-01');
    assert.equal(future.status, 'completed');
    assert.equal(therapy({ documentDate: '2027-06-01' }, null).status, 'completed', 'data futura ignorata, terapia non recente');
    assert.equal(therapy({ documentDate: '2027-06-01' }, null).startDate, '');
    assert.equal(therapy({ documentDate: '2022-03-01' }, null).status, 'completed');
    assert.equal(therapy({ documentDate: '2026-10-20' }, null).status, 'active');
});

test('fact ids depend only on what was proposed, and repeated proposals collapse', () => {
    // Caso K.
    const item: PreparedFactInput = { kind: 'therapy', values: { drugName: 'Ramipril', dosage: '5 mg', status: 'active' }, quote: 'Terapia: Ramipril 5 mg 1 cp al mattino' };
    const early = preparedDossierFacts({ source: source([item]), text: letter, units, documentDate: '2026-10-20', parserFacts: [], now }).facts;
    const later = preparedDossierFacts({ source: source([{ kind: 'exemption', values: { code: '031' } }, item, item]), text: letter, units, documentDate: '2026-10-20', parserFacts: [],
        now: new Date('2027-09-01T00:00:00Z') }).facts;
    const id = (facts: DossierFact[]) => facts.find((fact) => fact.kind === 'therapy')!.factId;
    assert.equal(id(early), id(later));
    assert.equal(later.filter((fact) => fact.kind === 'therapy').length, 1);
});

test('parser proposals all stay; coded duplicates are not repeated', () => {
    const parser = extractDossierCandidates({ fileName: 'lettera.pdf', text: letter, units, documentDate: '2026-10-20', exemptionCodes: new Set() }).facts;
    const result = preparedDossierFacts({ source: source([]), text: letter, units, documentDate: '2026-10-20', parserFacts: parser, now });
    for (const fact of parser) assert.ok(result.facts.includes(fact), `${fact.origin} resta`);
    assert.ok(result.facts.some((fact) => fact.values.preparedCheck === 'summary'));
    const noText = preparedDossierFacts({ source: source([{ kind: 'exemption', values: { code: '031' }, quote: 'Esenzione 031 per ipertensione' }], { summary: null }),
        text: null, units: [], documentDate: null, now, parserFacts: [] });
    assert.equal(noText.facts[0].values.preparedCheck, 'no_text');
    assert.match(noText.notes.join(' '), /non contiene una sintesi/u);
});

function record(facts: DossierFact[], pages: number | null = null): DossierRecord {
    return { facts, residualReview: { state: 'pending' },
        extraction: pages === null ? { state: 'extracted', unitBasis: 'document', units: [{ index: 0 }] } : { state: 'extracted', unitBasis: 'pages', units: Array.from({ length: pages }, (_, index) => ({ index: index + 1 })) },
    } as unknown as DossierRecord;
}

const fact = (factId: string, extra: Partial<DossierFact>): DossierFact => ({ factId, kind: 'therapy', origin: 'prepared', negated: false, decision: 'pending',
    evidence: { unit: 0, start: 0, end: 5, excerpt: 'x' }, values: { drugName: 'Ramipril', dosage: '5 mg', status: 'completed', startDate: '2026-10-20', preparedCheck: 'verified' }, ...extra });
const summary = (extra: Record<string, string> = {}): DossierFact => ({ factId: 'sum', kind: 'document_entry', origin: 'prepared', evidence: null, negated: false, decision: 'pending',
    values: { title: 'Sintesi', date: '2026-10-20', text: 'Testo', textSource: 'prepared', preparedCheck: 'summary', preparedCoverage: 'complete', preparedPages: '1', ...extra } });
const parserDocument: DossierFact = { factId: 'doc', kind: 'document_entry', origin: 'parser:document', evidence: null, negated: false, decision: 'pending',
    values: { title: 'Documento', date: '2026-10-20', text: '', textSource: 'document' } };

test('bulk decisions accept only verified, new, complete proposals', () => {
    const facts: DossierFact[] = [
        fact('ok', {}),
        fact('approx', { values: { drugName: 'Bisoprololo', dosage: '1,25 mg', status: 'completed', startDate: '2026-10-20', preparedCheck: 'approximate' } }),
        fact('missing', { evidence: null, values: { drugName: 'Metformina', dosage: '500 mg', status: 'completed', startDate: '2026-10-20', preparedCheck: 'not_found' } }),
        fact('paraphrase', { kind: 'anamnesis', values: { title: 'A', text: 'T', date: '2026-10-20', preparedCheck: 'paraphrase' } }),
        fact('negated', { negated: true }),
        fact('blocked', { values: { drugName: 'Ramipril', dosage: '', status: 'completed', startDate: '2026-10-20', preparedCheck: 'verified' } }),
        fact('present', {}),
        fact('conflict', {}),
        fact('dup', {}),
        fact('section', { origin: 'parser:section' }),
        fact('scale', { origin: 'parser:scale', kind: 'reported_scale', values: { scaleName: 'Barthel', scaleTotal: '60', date: '2026-10-20' } }),
        fact('icdAnamnesis', { origin: 'parser:icd', kind: 'anamnesis', values: { title: 'A', text: 'madre', date: '2026-10-20' } }),
        summary(), parserDocument,
        fact('decided', { decision: 'rejected' }),
    ];
    const assessments: Record<string, { status: 'new' | 'already_present' | 'duplicate_in_dossier' | 'conflict'; detail: string; relatedFactRefs: string[] }> = {
        'doc#present': { status: 'already_present', detail: '', relatedFactRefs: [] },
        'doc#conflict': { status: 'conflict', detail: '', relatedFactRefs: [] },
        'doc#dup': { status: 'duplicate_in_dossier', detail: '', relatedFactRefs: ['doc#ok'] },
    };
    const run = (includeSummaries: boolean, pages: number | null = null) => preparedBulkDecisions({ record: record(facts, pages), documentKey: 'doc', assessment: (ref) => assessments[ref],
        exemptionCodes: new Set(), acceptedElsewhere: new Set(), includeSummaries });
    const without = run(false);
    const decision = Object.fromEntries(without.facts.map((item) => [item.factId, item.decision]));
    assert.deepEqual(decision, { ok: 'accepted', approx: 'accepted', missing: 'pending', paraphrase: 'pending', negated: 'pending', blocked: 'pending', present: 'already_present',
        conflict: 'pending', dup: 'already_present', section: 'rejected', scale: 'pending', icdAnamnesis: 'pending', sum: 'pending', doc: 'pending', decided: 'rejected' });
    assert.equal(without.acknowledgeResidual, false, 'senza sintesi accettata il residuo resta al medico');
    const withSummaries = run(true);
    assert.equal(withSummaries.facts.find((item) => item.factId === 'sum')!.decision, 'accepted');
    assert.equal(withSummaries.facts.find((item) => item.factId === 'doc')!.decision, 'rejected', 'la voce col testo intero si sostituisce solo con la sintesi accettata');
    assert.equal(withSummaries.acknowledgeResidual, true);
    assert.equal(run(true, 3).acknowledgeResidual, false, 'pagine dichiarate diverse da quelle di MediFlow');
    assert.equal(run(true, 1).acknowledgeResidual, true);
});

test('bulk leaves the residual pending when the summary cannot be applied, and ignores documents without prepared facts', () => {
    // Caso H: sintesi senza data.
    const undated = preparedBulkDecisions({ record: record([summary({ date: '' })]), documentKey: 'doc', assessment: () => undefined, exemptionCodes: new Set(),
        acceptedElsewhere: new Set(), includeSummaries: true });
    assert.equal(undated.facts[0].decision, 'pending');
    assert.equal(undated.acknowledgeResidual, false);
    // Caso G: nessuna sintesi, la voce col testo intero resta.
    const noSummary = preparedBulkDecisions({ record: record([fact('missing', { evidence: null, values: { drugName: 'Zzz', dosage: '1', status: 'completed', startDate: '2026-10-20', preparedCheck: 'not_found' } }), parserDocument]),
        documentKey: 'doc', assessment: () => undefined, exemptionCodes: new Set(), acceptedElsewhere: new Set(), includeSummaries: true });
    assert.equal(noSummary.facts[1].decision, 'pending');
    const parserOnly = preparedBulkDecisions({ record: record([fact('lab', { origin: 'parser:lab', kind: 'observation', values: { display: 'Creatinina', value: '0,9', code: '2160-0', unitCode: 'mg/dL', observedAt: '2026-10-20' } })]),
        documentKey: 'doc', assessment: () => undefined, exemptionCodes: new Set(), acceptedElsewhere: new Set(), includeSummaries: true });
    assert.equal(parserOnly.facts[0].decision, 'pending', 'senza estrazione preparata nulla cambia');
});

test('patients group by valid tax code, otherwise by name and birth date', () => {
    assert.equal(preparedPatientKey({ taxCode: CF_A }), `cf:${CF_A}`);
    assert.equal(preparedPatientKey({ taxCode: 'RSSMRA80A01F205Z', lastName: 'Rossi', firstName: 'Mario', birthDate: '1980-01-01' }), 'nome:rossi|mario|1980-01-01');
    assert.equal(preparedPatientKey({ lastName: 'Rossi' }), null);
    assert.equal(preparedPatientKey(null), null);
});
