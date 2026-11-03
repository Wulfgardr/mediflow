import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DOSSIER_PREPARED_SCHEMA, anchorPreparedQuote, parsePreparedExtraction, preparedBulkDecisions, preparedDossierFacts, preparedPatientKey, verifyPreparedFields,
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
    assert.equal(verifyPreparedFields('observation', { display: 'piastrine', value: '1.500' }, preparedTokens('piastrine 1,500').map((token) => token.text)).check, 'value_missing', 'caso J');
    assert.deepEqual(preparedTokens('117,2mg /75mmHg E11.9').map((token) => token.text), ['117,2', 'mg', '75', 'mmhg', 'e', '11.9']);
    assert.deepEqual(preparedTokens('kg/m\u00b2 Ca\u00b2\u207a \u2163 \u00bd x\u0323\u0301yz').map((token) => token.text), ['kg', 'm', 'ca', 'xyz'], 'stessi valori del validatore Python');
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
    return { facts, residualReview: { state: 'pending' }, applied: [],
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
    assert.equal(withSummaries.facts.find((item) => item.factId === 'doc')!.decision, 'pending', 'prima della scrittura della sintesi la voce col testo intero resta');
    assert.equal(withSummaries.acknowledgeResidual, false);
    // Sintesi scritta e riletta: ora sostituisce e il residuo si conferma, se le pagine coincidono.
    const written = (pages: number | null) => preparedBulkDecisions({ record: { ...record(facts.map((item) => item.factId === 'sum' ? { ...item, decision: 'accepted' as const } : item), pages),
        applied: [{ factId: 'sum', target: 'entries', recordId: 'r', outcome: 'applied', at: 'x' }] } as unknown as DossierRecord, documentKey: 'doc', assessment: (ref) => assessments[ref],
        exemptionCodes: new Set(), acceptedElsewhere: new Set(), includeSummaries: true });
    assert.equal(written(null).facts.find((item) => item.factId === 'doc')!.decision, 'rejected');
    assert.equal(written(null).acknowledgeResidual, true);
    assert.equal(written(3).acknowledgeResidual, false, 'pagine dichiarate diverse da quelle di MediFlow');
    assert.equal(written(1).acknowledgeResidual, true);
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

// ---------------------------------------------------------------------------
// Valori legati al proprio soggetto (difetti riprodotti il 3/11/2026, restano come regressioni)
// ---------------------------------------------------------------------------

function onLine(line: string, item: PreparedFactInput) {
    const text = `Referto sintetico\n${line}\nFine referto.`;
    const { units: lineUnits } = splitDossierUnits(text, null);
    return preparedDossierFacts({ source: source([item], { summary: null }), text, units: lineUnits, documentDate: '2026-10-20', parserFacts: [], now })
        .facts.filter((fact) => fact.origin === 'prepared');
}
const verdict = (line: string, item: PreparedFactInput) => {
    const [first] = onLine(line, item);
    return first ? { check: first.values.preparedCheck, negated: first.negated, values: first.values } : null;
};

test('a lab value belongs to the analyte written right before it, short names included', () => {
    const line = 'Sodio 140 mmol/L, Potassio 4,1 mmol/L';
    assert.equal(verdict(line, { kind: 'observation', values: { display: 'Potassio', value: '140', unit: 'mmol/L' }, quote: line })?.check, 'value_missing');
    assert.equal(verdict(line, { kind: 'observation', values: { display: 'Potassio', value: '4,1', unit: 'mmol/L' }, quote: line })?.check, 'verified');
    // Abbreviazioni brevi: «K» non passa più senza controllo.
    const short = 'Na 140 mmol/L K 4,1 mmol/L Cl 102 mmol/L';
    assert.equal(verifyPreparedFields('observation', { display: 'K', value: '140', unit: 'mmol/L' }, preparedTokens(short).map((t) => t.text)).check, 'value_missing');
    assert.equal(verifyPreparedFields('observation', { display: 'Na', value: '102', unit: 'mmol/L' }, preparedTokens(short).map((t) => t.text)).check, 'value_missing');
    assert.equal(verifyPreparedFields('observation', { display: 'K', value: '4,1', unit: 'mmol/L' }, preparedTokens(short).map((t) => t.text)).check, 'ok');
    const lipids = 'Colesterolo totale 210 mg/dL, Colesterolo HDL 45 mg/dL';
    assert.equal(verifyPreparedFields('observation', { display: 'Colesterolo HDL', value: '210', unit: 'mg/dL' }, preparedTokens(lipids).map((t) => t.text)).check, 'value_missing');
    assert.equal(verifyPreparedFields('observation', { display: 'Colesterolo HDL', value: '45', unit: 'mg/dL' }, preparedTokens(lipids).map((t) => t.text)).check, 'ok');
    assert.equal(verifyPreparedFields('observation', { display: 'Creatinina', value: '0,9', unit: 'mmol/L' }, preparedTokens('Creatinina 0,9 mg/dL').map((t) => t.text)).check, 'value_missing', 'unità diversa');
});

test('generated: on a line with two analytes or two drugs, every swapped value is refused and every right one accepted', () => {
    const analytes = [['Glucosio', 'mg/dL'], ['Creatinina', 'mg/dL'], ['Sodio', 'mmol/L'], ['Potassio', 'mmol/L'], ['Emoglobina', 'g/dL'], ['ALT', 'U/L'], ['AST', 'U/L'], ['TSH', 'mUI/L']];
    const values = ['95', '0,9', '140', '4,1', '13,2', '32', '28', '2,15'];
    let pairs = 0;
    for (let a = 0; a < analytes.length; a += 1) for (let b = 0; b < analytes.length; b += 1) {
        if (a === b || values[a] === values[b]) continue;
        const line = `${analytes[a][0]} ${values[a]} ${analytes[a][1]}; ${analytes[b][0]} ${values[b]} ${analytes[b][1]}`;
        const passage = preparedTokens(line).map((t) => t.text);
        assert.equal(verifyPreparedFields('observation', { display: analytes[b][0], value: values[a], unit: analytes[b][1] }, passage).check, 'value_missing', line);
        assert.equal(verifyPreparedFields('observation', { display: analytes[b][0], value: values[b], unit: analytes[b][1] }, passage).check, 'ok', line);
        pairs += 1;
    }
    const drugs = [['Ramipril', '5 mg'], ['Metformina', '500 mg'], ['Bisoprololo', '2,5 mg'], ['Atorvastatina', '20 mg'], ['Furosemide', '25 mg'], ['Pantoprazolo', '40 mg']];
    for (let a = 0; a < drugs.length; a += 1) for (let b = 0; b < drugs.length; b += 1) {
        if (a === b) continue;
        const line = `Terapia: ${drugs[a][0]} ${drugs[a][1]} 1 cp, ${drugs[b][0]} ${drugs[b][1]} 1 cp`;
        const passage = preparedTokens(line).map((t) => t.text);
        assert.equal(verifyPreparedFields('therapy', { drugName: drugs[b][0], dosage: drugs[a][1] }, passage).check, 'value_missing', line);
        assert.equal(verifyPreparedFields('therapy', { drugName: drugs[b][0], dosage: `${drugs[b][1]} 1 cp` }, passage).check, 'ok', line);
        pairs += 1;
    }
    assert.ok(pairs >= 80, `coppie provate: ${pairs}`);
});

test('a dose is not taken from the neighbouring drug, and a nearby active principle is not kept on the wrong drug', () => {
    const line = 'Terapia: Ramipril 5 mg 1 cp al mattino, Metformina 500 mg 2 volte al giorno';
    assert.equal(verdict(line, { kind: 'therapy', values: { drugName: 'Metformina', dosage: '5 mg' }, quote: line })?.check, 'value_missing');
    const ok = verdict(line, { kind: 'therapy', values: { drugName: 'Metformina', activePrinciple: 'ramipril', dosage: '500 mg 2 volte al giorno' }, quote: line });
    assert.equal(ok?.check, 'verified');
    assert.equal(ok?.values.activePrinciple, undefined, 'il principio attivo di un altro farmaco non resta');
});

test('negation, suspension and family history stop the bulk path', () => {
    const negated = verdict('Il paziente non assume warfarin 5 mg da anni', { kind: 'therapy', values: { drugName: 'warfarin', dosage: '5 mg', status: 'active' }, quote: 'Il paziente non assume warfarin 5 mg da anni' });
    assert.equal(negated?.negated, true);
    const suspended = verdict('Bisoprololo 2,5 mg sospeso per bradicardia', { kind: 'therapy', values: { drugName: 'Bisoprololo', dosage: '2,5 mg', status: 'active' }, quote: 'Bisoprololo 2,5 mg sospeso per bradicardia' });
    assert.equal(suspended?.check, 'status_conflict');
    const asSuspended = verdict('Bisoprololo 2,5 mg sospeso per bradicardia', { kind: 'therapy', values: { drugName: 'Bisoprololo', dosage: '2,5 mg', status: 'suspended' }, quote: 'Bisoprololo 2,5 mg sospeso per bradicardia' });
    assert.equal(asSuspended?.check, 'verified');
    const family = verdict('Anamnesi: madre affetta da carcinoma mammario', { kind: 'diagnosis', values: { description: 'carcinoma mammario' }, quote: 'Anamnesi: madre affetta da carcinoma mammario' });
    assert.equal(family?.check, 'subject_conflict');
    const narrative = verdict('Anamnesi: madre affetta da carcinoma mammario', { kind: 'anamnesis', values: { title: 'Carcinoma mammario della paziente', text: 'madre affetta da carcinoma mammario' } });
    assert.equal(narrative?.check, 'subject_conflict');
    assert.equal(narrative?.values.title, 'Anamnesi da documento', 'il titolo proposto non entra');
    const facts = onLine('Il paziente non assume warfarin 5 mg da anni', { kind: 'therapy', values: { drugName: 'warfarin', dosage: '5 mg', status: 'active' }, quote: 'Il paziente non assume warfarin 5 mg da anni' });
    const bulk = preparedBulkDecisions({ record: { facts, residualReview: { state: 'pending' }, applied: [], extraction: { state: 'extracted', unitBasis: 'document', units: [] } } as unknown as DossierRecord,
        documentKey: 'doc', assessment: () => undefined, exemptionCodes: new Set(), acceptedElsewhere: new Set(), includeSummaries: false });
    assert.equal(bulk.facts[0].decision, 'pending', 'negato: mai in blocco');
});

test('ICD codes match as a whole, never assembled from pieces of other codes', () => {
    const line = 'Diabete mellito tipo 2 (E11) e ipertensione arteriosa (I10)';
    assert.equal(verdict(line, { kind: 'diagnosis', values: { description: 'ipertensione arteriosa', code: 'I11', system: 'ICD-10' }, quote: line })?.check, 'value_missing');
    assert.equal(verdict(line, { kind: 'diagnosis', values: { description: 'ipertensione arteriosa', code: 'I10', system: 'ICD-10' }, quote: line })?.check, 'verified');
    assert.equal(verdict('Diagnosi: E11.9 diabete mellito', { kind: 'diagnosis', values: { description: 'diabete mellito', code: 'E11.9' }, quote: 'Diagnosi: E11.9 diabete mellito' })?.check, 'verified');
});

test('scales and invalidity: the total follows the scale name, the percentage is written as such', () => {
    const line = 'MMSE 24/30, Barthel 60/100';
    assert.equal(verifyPreparedFields('reported_scale', { scaleName: 'Barthel', scaleTotal: '24', scaleMax: '30' }, preparedTokens(line).map((t) => t.text)).check, 'value_missing');
    assert.equal(verifyPreparedFields('reported_scale', { scaleName: 'Barthel', scaleTotal: '60', scaleMax: '100' }, preparedTokens(line).map((t) => t.text)).check, 'ok');
    const text = 'Riconosciuta invalidità civile 75% con revisione nel 2028.';
    const { units: u } = splitDossierUnits(text, null);
    const pass = (percentage: string) => preparedDossierFacts({ source: source([{ kind: 'invalidity', values: { text: 'Riconosciuta invalidità civile 75% con revisione nel 2028', percentage } }], { summary: null }),
        text, units: u, documentDate: '2026-10-20', parserFacts: [], now }).facts[0].values.preparedCheck;
    assert.equal(pass('75'), 'verified');
    assert.equal(pass('20'), 'value_missing', '2028 non è una percentuale');
});

test('one accepted drug supersedes only the section proposal of the same drug', () => {
    const prepared: DossierFact = fact('prep', { values: { drugName: 'Ramipril', dosage: '5 mg', status: 'completed', startDate: '2026-10-20', preparedCheck: 'verified' } });
    const sectionSame: DossierFact = fact('secR', { origin: 'parser:section', evidence: { unit: 0, start: 0, end: 1, excerpt: 'x' }, values: { drugName: 'Ramipril', dosage: '5 mg', status: 'completed', startDate: '' } });
    const sectionOther: DossierFact = fact('secW', { origin: 'parser:section', evidence: { unit: 0, start: 0, end: 1, excerpt: 'x' }, values: { drugName: 'Warfarin', dosage: '5 mg', status: 'completed', startDate: '' } });
    const result = preparedBulkDecisions({ record: record([prepared, sectionSame, sectionOther]), documentKey: 'doc', assessment: () => undefined, exemptionCodes: new Set(), acceptedElsewhere: new Set(), includeSummaries: false });
    assert.deepEqual(result.facts.map((item) => item.decision), ['accepted', 'rejected', 'pending']);
});

test('the full-text entry is replaced and the residual acknowledged only once the summary is written', () => {
    const accepted = { ...summary(), decision: 'accepted' as const };
    const base = { facts: [accepted, parserDocument], residualReview: { state: 'pending' }, extraction: { state: 'extracted', unitBasis: 'document', units: [] } };
    const run = (applied: unknown[]) => preparedBulkDecisions({ record: { ...base, applied } as unknown as DossierRecord, documentKey: 'doc', assessment: () => undefined,
        exemptionCodes: new Set(), acceptedElsewhere: new Set(), includeSummaries: true });
    const before = run([]);
    assert.equal(before.facts[1].decision, 'pending');
    assert.equal(before.acknowledgeResidual, false);
    const after = run([{ factId: 'sum', target: 'entries', recordId: 'r', outcome: 'applied', at: 'x' }]);
    assert.equal(after.facts[1].decision, 'rejected');
    assert.equal(after.acknowledgeResidual, true);
});

test('aid and service names are checked on their words; quantities written around them do not block', () => {
    const line = '3 siringhe tipo schizzettoni die 90 pz mese';
    assert.equal(verifyPreparedFields('prosthetic', { description: 'Siringhe tipo schizzettoni, 3/die, 90 pz/mese' }, preparedTokens(line).map((t) => t.text)).check, 'ok');
    assert.equal(verifyPreparedFields('prosthetic', { description: 'Soluzione fisiologica 100ml, 6 confezioni/die' }, preparedTokens('6 confezioni di soluzione fisiologica 100 ml die').map((t) => t.text)).check, 'ok');
    assert.equal(verifyPreparedFields('prosthetic', { description: 'Deambulatore' }, preparedTokens(line).map((t) => t.text)).check, 'value_missing');
});
