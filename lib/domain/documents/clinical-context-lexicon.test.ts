import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { dossierFactBlockers, extractDossierCandidates, splitDossierUnits, type DossierFact } from './dossier-import.ts';
import { preparedDossierFacts, preparedFactEligible, preparedTokens, verifyPreparedFields, type PreparedFactInput } from './dossier-prepared.ts';
import { qualifiersOf, segmentDossierSections, splitSectionItems } from './dossier-sections.ts';

const date = '2026-10-20';
const now = new Date('2026-11-01T12:00:00Z');
const fileName = 'visita-sintetica.txt';
const exemptionCodes = new Set<string>();
const dose = 'Ramipril 5 mg al mattino';
const a = 'Terapia: senza terapia in atto con ' + dose;
const b = 'Terapia: ' + dose + ', assunto esclusivamente dalla moglie';
const c = 'Terapie sospese:\n' + dose;
const plain = 'Terapia in atto: ' + dose;

function documentInput(body: string) {
    const text = 'PersonaUno SinteticoUno\nData visita: 20/10/2026\n' + body;
    return { fileName, text, units: splitDossierUnits(text, null).units, documentDate: date, exemptionCodes };
}

function therapy(quote = dose, extra: Record<string, string> = {}): PreparedFactInput {
    return { kind: 'therapy', quote, values: { drugName: 'Ramipril', dosage: '5 mg', status: 'active', subject: 'paziente', ...extra } };
}

function prepared(t: TestContext, body: string, proposal: PreparedFactInput, expected: boolean, codes = exemptionCodes) {
    const input = { ...documentInput(body), exemptionCodes: codes };
    const source = {
        sha256: createHash('sha256').update(input.text).digest('hex'), fileName, documentDate: date,
        patient: null, documentType: 'visita', summary: null, facts: [proposal],
        coverage: { pages: 1, unreadablePages: [], complete: true, note: '' },
    };
    const { facts } = preparedDossierFacts({ ...input, source, parserFacts: [], now });
    const sameKind = facts.filter(f => f.kind === proposal.kind);
    t.diagnostic(JSON.stringify(sameKind.map(f => ({
        check: f.values.preparedCheck, negated: f.negated, status: f.values.status, subject: f.values.subject,
        eligible: preparedFactEligible(f, codes),
    }))));
    if (expected) {
        const fields = Object.entries(proposal.values).filter(([key]) => key !== 'subject');
        assert.ok(sameKind.some(f => fields.every(([key, value]) => f.values[key] === value)
            && f.values.subject !== 'familiare' && preparedFactEligible(f, codes)));
    } else {
        assert.ok(sameKind.some(f => f.evidence), body);
        assert.equal(sameKind.some(f => preparedFactEligible(f, codes)), false, body);
    }
    return sameKind;
}

function parser(body: string) {
    return extractDossierCandidates(documentInput(body)).facts;
}

function medicationSections(body: string) {
    const { text } = documentInput(body);
    return segmentDossierSections(text, true).filter(s => s.kind === 'medication').flatMap(s =>
        splitSectionItems(text, s.start, s.end).filter(item => item.text.includes('Ramipril')).map(item => qualifiersOf(item.text, s.kind, s.label)));
}

function parserTherapy(t: TestContext, body: string, expected: 'vietata' | 'paziente' | 'sospesa') {
    const facts = parser(body).filter(f => f.kind === 'therapy');
    const unsafe = (f: DossierFact) => {
        const dated = { ...f, values: { ...f.values, startDate: f.values.startDate || date } };
        return dossierFactBlockers(dated).length === 0;
    };
    t.diagnostic(JSON.stringify(facts.map(f => ({ values: f.values, negated: f.negated, blockers: dossierFactBlockers(f), dopoData: unsafe(f) }))));
    if (expected !== 'vietata') {
        assert.ok(facts.some(f => f.values.drugName === 'Ramipril' && f.values.dosage.includes('5 mg')
            && f.values.status === (expected === 'sospesa' ? 'suspended' : 'completed') && unsafe(f)));
    } else {
        assert.ok(facts.length > 0, body);
        assert.equal(facts.some(unsafe), false, body);
    }
}

function icd(t: TestContext, body: string, code: string, expected: boolean) {
    const facts = parser(body).filter(f => f.origin !== 'parser:document');
    t.diagnostic(JSON.stringify(facts.map(f => ({ kind: f.kind, code: f.values.code, negated: f.negated, eligible: preparedFactEligible(f, exemptionCodes) }))));
    const diagnoses = facts.filter(f => f.kind === 'diagnosis' && f.values.code === code);
    assert.equal(diagnoses.some(f => dossierFactBlockers(f).length === 0), expected);
}

test('01 A preparata, senza terapia in atto', t => {
    prepared(t, a, therapy(), false);
});
test('02 A parser, senza terapia in atto', t => parserTherapy(t, a, 'vietata'));
test('03 A qualificatori, senza terapia in atto', t => {
    const q = medicationSections(a);
    t.diagnostic(JSON.stringify(q));
    assert.equal(q.length, 1);
    assert.equal(q[0].negated, true);
});
test('04 B preparata, la moglie dopo la citazione', t => {
    prepared(t, b, therapy(), false);
});
test('05 B parser, terapia della moglie', t => parserTherapy(t, b, 'vietata'));
test('06 B qualificatori, terapia della moglie', t => {
    const q = medicationSections(b);
    t.diagnostic(JSON.stringify(q));
    assert.equal(q.length, 1);
    assert.equal(q[0].subject, 'familiare');
});
test('07 C preparata, sospensione sulla riga precedente', t => {
    prepared(t, c, therapy(), false);
});
test('08 C parser, sospensione sulla riga precedente', t => parserTherapy(t, c, 'sospesa'));
test('09 C qualificatori, nessuna indicazione di terapia in atto', t => {
    const q = medicationSections(c);
    t.diagnostic(JSON.stringify(q));
    assert.equal(q.length, 1);
    assert.equal(q[0].suspended, true);
    assert.equal(q[0].temporality, '');
});
test('10 B preparata, familiare dichiarato nel JSON', t => {
    prepared(t, b, therapy(b, { subject: 'familiare' }), false);
});
test('11 Terapia consegnata al familiare', t => {
    prepared(t, 'Terapia consegnata al familiare per il paziente che assume ' + dose, therapy(), false);
});
test('12 La moglie riferisce la terapia del paziente', t => {
    prepared(t, 'Riferisce la moglie che il paziente assume ' + dose, therapy(), false);
});
test('13 Paziente accompagnato dal figlio', t => {
    icd(t, 'Paziente accompagnato dal figlio, il paziente presenta ICD-10 I10 ipertensione arteriosa', 'I10', false);
});
test('14 Prelievo non a digiuno', t => {
    const quote = 'Creatinina 0,9 mg/dL';
    prepared(t, 'Prelievo non a digiuno, ' + quote, { kind: 'observation', quote, values: { display: 'Creatinina', value: '0,9', unit: 'mg/dL' } }, false);
});
test('15 Dieta senza glutine', t => {
    prepared(t, 'Segue dieta senza glutine e assume ' + dose, therapy(), false);
});
test('16 Riga vuota dopo la lista sospesa', t => {
    prepared(t, 'Terapie sospese:\nAtenololo 50 mg\n\nIl paziente assume ' + dose, therapy(), true);
});
test('17 Nuova intestazione dopo la lista sospesa', t => {
    prepared(t, 'Terapie sospese:\nAtenololo 50 mg\n' + plain, therapy(), true);
});
test('18 Non solo ma anche', t => {
    prepared(t, 'Assume non solo Atenololo ma anche ' + dose, therapy(), false);
});
test('19 Doppia negazione con conferma di assunzione', t => {
    prepared(t, 'Non è vero che il paziente non assuma Ramipril 5 mg al mattino, ne conferma la regolare assunzione.', therapy(), false);
});
test('20 Nega familiarità per una diagnosi codificata', t => {
    icd(t, 'Nega familiarità per ICD-10 E11 diabete mellito', 'E11', false);
});
test('21 Negazione dopo il codice e la diagnosi', t => {
    icd(t, 'Diagnosi: ICD-10 I10 ipertensione arteriosa, esclusa dopo rivalutazione', 'I10', false);
});
test('22 Anamnesi familiare negativa seguita da diagnosi personale', t => {
    icd(t, 'Anamnesi familiare: negativa\nIl paziente presenta ICD-10 I10 ipertensione arteriosa', 'I10', true);
});
test('23 Senza evidenza di una diagnosi codificata', t => {
    icd(t, 'Senza evidenza di ICD-10 I50 scompenso cardiaco', 'I50', false);
});
test('24 C preparata, stato sospeso fedele al documento', t => {
    prepared(t, c, therapy(dose, { status: 'suspended' }), true);
});
test('25 Controlli positivi sugli ingressi', t => {
    prepared(t, plain, therapy(), true);
    parserTherapy(t, plain, 'paziente');
    const q = medicationSections(plain);
    assert.equal(q.length, 1);
    assert.equal(q[0].negated, false);
    assert.equal(q[0].subject, 'paziente');
    assert.match(q[0].temporality, /in atto/iu);
    icd(t, 'Diagnosi: ICD-10 I50 scompenso cardiaco', 'I50', true);
    prepared(t, 'Creatinina 0,9 mg/dL', { kind: 'observation', quote: 'Creatinina 0,9 mg/dL', values: { display: 'Creatinina', value: '0,9', unit: 'mg/dL' } }, true);
});

test('la sospensione si estende alla lista e termina a un titolo diverso', t => {
    const body = 'Terapie sospese:\nAtenololo: 50 mg\n' + dose;
    const facts = parser(body).filter(fact => fact.kind === 'therapy');
    assert.deepEqual(facts.map(fact => [fact.values.drugName, fact.values.status]), [['Atenololo', 'suspended'], ['Ramipril', 'suspended']]);
    assert.equal(medicationSections(body).length, 1);
    prepared(t, body, therapy(), false);
    prepared(t, 'Terapie sospese:\nRamipril: 5 mg al mattino', therapy(), false);
    prepared(t, 'Terapie sospese:\nAtenololo 50 mg\nAltre note:\n' + dose, therapy(), true);
});

test('la lista delle sospensioni termina anche con una riga vuota CRLF', t => {
    const body = 'Terapie sospese:\r\nAtenololo 50 mg\r\n\r\nIl paziente assume ' + dose;
    const therapies = parser(body).filter(fact => fact.kind === 'therapy');
    assert.deepEqual(therapies.map(fact => fact.values.drugName), ['Atenololo']);
    prepared(t, body, therapy(), true);
});

test('i segnali dopo la citazione valgono nella stessa frase', t => {
    prepared(t, dose + ', non assunto dopo il ricovero', therapy(), false);
    prepared(t, dose + ', il paziente non lo assume', therapy(), false);
    prepared(t, dose + '. Non assunto il farmaco precedente.', therapy(), true);
    prepared(t, dose + ', assunto esclusivamente dal nipote', therapy(), false);
    prepared(t, dose + ', assunto esclusivamente dal cugino', therapy(), false);
    prepared(t, dose + '. Il coniuge assume Atenololo.', therapy(), true);
});

test('il contesto del familiare blocca anche quando il paziente è esplicito', t => {
    prepared(t, 'Consegna al familiare. ' + dose + ', assunto dalla moglie', therapy(), false);
    prepared(t, 'Terapia consegnata al familiare: ' + dose + ', assunto dalla moglie', therapy(), false);
    prepared(t, 'Il familiare riceve e assume ' + dose, therapy(), false);
    prepared(t, 'Il familiare riceve la prescrizione per il paziente che assume ' + dose, therapy(), false);
    prepared(t, 'Prelievo non a digiuno. Non assume ' + dose, therapy(), false);
});

test('le due diagnosi conservano la propria negazione nello stesso paragrafo', () => {
    const facts = parser('Diagnosi: ICD-10 I10 ipertensione, esclusa dopo rivalutazione. Nega diabete ICD-10 E11 diabete mellito');
    assert.deepEqual(facts.filter(fact => fact.kind === 'diagnosis').map(fact => [fact.values.code, fact.negated]), [['I10', true], ['E11', true]]);
});

test('le diagnosi della lettera conservano la negazione anche quando AnyDoc unisce le righe', () => {
    const lines = ['Diagnosi: ICD-10 I10 Ipertensione essenziale', 'Nega diabete ICD-10 E11.9 diabete mellito'];
    const flattenedLetter = [
        'Anamnesi: madre deceduta per ca. mammella ICD-10 C50', ...lines,
        'Terapia domiciliare: Ramipril 5 mg 1 cp al mattino',
    ].join(' ');
    for (const body of [lines.join('\n'), lines.join(' '), flattenedLetter]) {
        const facts = parser(body).filter(fact => fact.kind === 'diagnosis');
        assert.deepEqual(facts.map(fact => [fact.values.code, fact.negated, fact.values.contextReview]),
            [['I10', false, undefined], ['E11.9', true, 'negation']]);
    }
});

const companion = 'Il paziente è accompagnato dal figlio, che assume ' + dose;
const interrupted = 'Interrompo da oggi ' + dose;
const opposedDiagnoses = 'Confermata ICD-10 I10 ipertensione arteriosa, escluso invece ICD-10 I50 scompenso cardiaco';

const diffTherapies: Array<[string, string, boolean, string?]> = [
    ['01 il figlio accompagnatore assume il farmaco', companion, false],
    ['02 terapia della sorellastra', 'La sorellastra assume ' + dose, false],
    ['03 sospensione con verbo coniugato', 'Il paziente dichiara: «' + interrupted + '».', false, interrupted],
    ['07 la sospensione riguarda un altro farmaco', 'Il paziente assume ' + dose + ', mentre Atenololo è sospeso', false],
    ['08 la moglie attende fuori', 'Il paziente assume ' + dose + ', mentre la moglie attende fuori', false],
    ['09 la negazione riguarda un sintomo', 'Il paziente assume ' + dose + ', tosse assente', false],
    ['10 la dieta non cancella una seconda negazione', 'Dieta senza glutine e senza terapia in atto con ' + dose, false],
    ['11 il figlio accompagna e il paziente assume', 'Accompagnato dal figlio, il paziente assume ' + dose, false],
    ['12 segnali interni a nomi inventati', 'Nonnalvi Stoprano Zialven assume ' + dose, false],
    ['13 nuova sezione di terapia personale', 'Anamnesi familiare:\nIpertensione materna\nTerapia in atto: ' + dose, true],
    ['14 la coniuge assume la terapia in autonomia', 'Non solo il paziente è presente alla visita ma anche la moglie, che assume ' + dose, false],
];

for (const [name, body, expected, quote] of diffTherapies) {
    test('Diff ' + name, t => {
        const facts = prepared(t, body, therapy(quote), expected);
        assert.equal(facts.filter(f => f.evidence && f.values.drugName === 'Ramipril' && f.values.dosage === '5 mg'
            && f.values.status === 'active' && f.values.subject === 'paziente').length, 1);
    });
}

const diffDiagnoses: Array<[string, string, Record<string, boolean>]> = [
    ['04 negazione prima della parola diagnosi', 'La rivalutazione non conferma la seguente diagnosi: ICD-10 I10 ipertensione arteriosa', { I10: false }],
    ['05 sottotitolo nella storia familiare', 'Anamnesi familiare:\nRamo materno:\nICD-10 I10 ipertensione arteriosa', { I10: false }],
    ['06 diagnosi confermata seguita da diagnosi esclusa', opposedDiagnoses, { I10: false, I50: false }],
];

for (const [name, body, expected] of diffDiagnoses) {
    test('Diff ' + name, () => {
        const facts = parser(body).filter(fact => fact.origin === 'parser:icd');
        for (const [code, eligible] of Object.entries(expected)) {
            assert.ok(facts.some(fact => fact.evidence?.excerpt.includes(code)));
            assert.equal(facts.some(fact => fact.kind === 'diagnosis' && fact.values.code === code && dossierFactBlockers(fact).length === 0), eligible, code);
        }
    });
}

test('la citazione estesa mantiene lo stesso ambito della citazione breve', t => {
    for (const [body, expected] of [
        [dose + ', assunto esclusivamente dalla moglie', false],
        [dose + ', il paziente non lo assume', false],
        [dose + ', la moglie attende fuori', false],
        [dose + ', tosse assente', false],
        [dose + ' e sospendo Atenololo', false],
        [dose + ' Atenololo 50 mg sospeso', false],
        [dose + ';Atenololo sospeso', false],
        [dose + ', Ramipril sospeso', false],
        [dose + ', la terapia è sospesa', false],
    ] as const) {
        prepared(t, body, therapy(body), expected);
    }
});

test('una nuova intestazione o una riga vuota chiude il contesto familiare', t => {
    const family = '# Anamnesi familiare\n## Ramo materno\n';
    icd(t, family + '## Diagnosi\nICD-10 I10 ipertensione arteriosa', 'I10', true);
    icd(t, family + 'ICD-10 I10 ipertensione arteriosa', 'I10', false);
    icd(t, family + '\nICD-10 I10 ipertensione arteriosa', 'I10', true);
    icd(t, family + '# Diagnosi\nICD-10 I10 ipertensione arteriosa', 'I10', true);
    prepared(t, family + dose, therapy(), false);
    prepared(t, family + '# Terapia in atto\n' + dose, therapy(), true);
    prepared(t, 'Anamnesi familiare: ipertensione materna. Terapia in atto: ' + dose, therapy(), true);
});

test('un parente in una relativa continua a essere il soggetto dell’assunzione', t => {
    prepared(t, 'Accompagnato dal figlio del paziente, che attende fuori e assume ' + dose, therapy(), false);
    prepared(t, 'La figlia, che attende fuori e assume ' + dose, therapy(), false);
    icd(t, 'La madre mostra la seguente diagnosi: ICD-10 I10 ipertensione arteriosa', 'I10', false);
});

test('una sospensione dopo la prima terapia nella stessa frase blocca il parser', t => {
    parserTherapy(t, 'Terapia in atto: ' + dose + ', mentre Atenololo è sospeso', 'vietata');
});

test('la dose del farmaco sospeso resta legata al farmaco citato dopo', t => {
    const body = 'Il paziente assume Ramipril, mentre Atenololo 50 mg è sospeso';
    prepared(t, body, therapy(body, { dosage: '50 mg' }), false);
});

test('il punto interrogativo mantiene incerta la diagnosi esplicita', () => {
    const fact = parser('ICD-10 I10 ipertensione arteriosa?').find(item => item.origin === 'parser:icd');
    assert.equal(fact?.values.certainty, 'incerta');
    assert.equal(fact?.values.description, 'ipertensione arteriosa?');
});

test('Terzo 01 Negazione con inciso temporale', t => {
    prepared(t, 'Non assume più, da gennaio, ' + dose, therapy(), false);
});
test('Terzo 02 Negazione con inciso dichiarativo', t => {
    prepared(t, 'Non assume più, riferisce la paziente, ' + dose, therapy(), false);
});
test('Terzo 03 Due farmaci sospesi in elenco', t => {
    prepared(t, 'Sospesi Atenololo e ' + dose, therapy(), false);
});
test('Terzo 04 Sospensione al passato remoto', t => {
    prepared(t, 'Sospendemmo definitivamente ' + dose, therapy(), false);
});
test('Terzo 05 Terapia della figlioletta', t => {
    prepared(t, 'La figlioletta assume ' + dose, therapy(), false);
});
test('Terzo 06 La figlia accompagnatrice fa uso del farmaco', t => {
    prepared(t, 'Il paziente è accompagnato dalla figlia, che fa uso di ' + dose, therapy(), false);
});
test('Terzo 07 Nuova intestazione personale', t =>
    icd(t, 'Anamnesi familiare: diabete paterno\nProblemi attivi del paziente:\nICD-10 I10 ipertensione arteriosa', 'I10', true));
test('Terzo 08 Il soggetto è scritto dopo il codice', t =>
    icd(t, 'ICD-10 I10 ipertensione arteriosa, riferisce di soffrirne solo la madre', 'I10', false));
test('Terzo 09 Negazione della diagnosi con inciso', t =>
    icd(t, 'Non si conferma, riferisce il curante, ICD-10 I10 ipertensione arteriosa', 'I10', false));
test('Terzo 10 Terapia confermata con inciso', t => {
    prepared(t, 'Assume, riferisce la paziente, ' + dose, therapy(), true);
});
test('Terzo 11 Sospensione della terapia combinata dopo due dosi', t => {
    const body = 'Terapia combinata con Ramipril 5 mg più Atenololo 25 mg sospesa';
    prepared(t, body, therapy(body), false);
});

test('HBsAg: solo la negazione che appartiene al risultato qualitativo è coerente', () => {
    for (const value of ['non reattivo', 'negativo', 'assente']) {
        const check = (text: string) => verifyPreparedFields('observation', { display: 'HBsAg', value }, preparedTokens(text).map(token => token.text));
        assert.deepEqual(check(`HBsAg ${value}`), { check: 'ok', negated: false, notes: [], drop: [] });
        assert.equal(check(`Non eseguito HBsAg ${value}`).negated, true);
        assert.equal(check(`HBsAg ${value}, ma non confermato`).negated, true);
        assert.equal(check(`HBsAg non eseguito, ${value}`).negated, true);
    }
});

for (const [name, body, expected] of [
    ['01 Esenzione revocata', 'Esenzioni revocate:\n- 048', false],
    ['02 Elenco del convivente', 'Esenzioni del convivente:\n048', false],
    ['03 Negazione a capo', 'Il distretto non riconosce al paziente le seguenti\nesenzioni:\n048', false],
    ['Esenzione confermata a capo', 'Il distretto riconosce al paziente le seguenti\nesenzioni:\n048', true],
    ['Esenzione dopo una frase completa', 'Non riferisce sintomi.\nesenzioni:\n048', true],
] as const) {
    test('Finale ' + name, t => {
        const input = { ...documentInput(body), exemptionCodes: new Set(['048']) };
        const facts = extractDossierCandidates(input).facts.filter(f => f.kind === 'exemption' && f.values.code === '048');
        assert.equal(facts.length, 1);
        assert.equal(preparedFactEligible(facts[0], input.exemptionCodes), expected);
        const quote = '048 per patologia cronica';
        prepared(t, body.replace('048', quote), { kind: 'exemption', quote, values: { code: '048' } }, expected, input.exemptionCodes);
    });
}

test('Finale 04 Stoppata', t => {
    const body = 'Stoppata definitivamente la terapia con ' + dose;
    prepared(t, body, therapy(body), false);
});

test('Finale 15 Parente con suffisso', t => {
    prepared(t, 'Il nipotello assume ' + dose, therapy(), false);
});
