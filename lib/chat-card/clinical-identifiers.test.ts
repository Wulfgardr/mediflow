import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clinicalIdentifierSpans } from './clinical-identifiers';

const known = { names: ['Marta', 'Valli', 'Ada Lattesi', 'René', 'RSSMRA80D12F205X', 'marta@example.test', 'PT-ALFA-729143'], birthDates: ['17/04/1972'] };
const fullwidth = (text: string) => [...text].map(c => /[!-~]/u.test(c) ? String.fromCharCode(c.charCodeAt(0) + 0xfee0) : c).join('');
const forms = [
    (text: string) => text,
    (text: string) => text.toUpperCase(),
    (text: string) => text.toLowerCase(),
    (text: string) => [...text].join(' '),
    (text: string) => [...text].join('.-'),
    (text: string) => [...text].join('\u200b'),
    fullwidth,
    (text: string) => text.replaceAll('a', '4').replaceAll('l', '1').replaceAll('0', 'O').replaceAll('1', 'I'),
];
for (const identifier of [...known.names, ...known.birthDates]) test(`local matching covers normalization compositions for synthetic ${known.names.indexOf(identifier)}`, () => {
    for (const first of forms) for (const second of forms) {
        const variant = second(first(identifier));
        const text = `😀 Terapia invariata in ${variant}; prosegue.`;
        const spans = clinicalIdentifierSpans(text, known);
        const start = text.indexOf(variant), end = start + variant.length;
        assert.ok(spans.some(s => s.start <= start && s.end >= end), variant);
        for (const span of spans) assert.equal(span.text, text.slice(span.start, span.end));
    }
});
test('structural detectors do not depend on known identifiers or neural entities', () => {
    for (const value of ['M A R T A  V A L L I', 'M4rta Va11i', 'R S S M R A 8 O D I 2 F 2 O 5 X', 'R S S M R A U L D M N F P Q R X', fullwidth('RSSMRA80D12F205X'), '3 4 7 1 2 3 4 5 6 7', '89746120358', 'tre quattro sette uno due tre quattro cinque sei sette', fullwidth('marta@example.test'), 'marta punto valli chiocciola esempio punto it', 'Nata il diciassette aprile millenovecentosettantadue']) {
        const spans = clinicalIdentifierSpans(`Diabete mellito. ${value}`, { names: [], birthDates: [] });
        assert.ok(spans.length, value);
    }
    assert.deepEqual(clinicalIdentifierSpans('Ipertensione arteriosa. Terapia invariata.', { names: [], birthDates: [] }), []);
});

for (const value of ['Ma®ta', 'Va||i', 'M△rta', 'M4rta', 'M A R T A', 'M.a.r.t.a', 'RSSMRA', 'erre esse esse emme erre a otto zero', '347/123/45/67', 'trecentoquarantasette', 'uno due tre quattro', 'Tessera 123', 'Matricola alfa']) test(`blocks synthetic identifier form ${value}`, () => {
    assert.ok(clinicalIdentifierSpans(`Terapia invariata. ${value}`, known).length);
});
for (const value of ['HbA1c 7,2%', 'FEV1 80%', 'CD4 500', 'T4 1,2', 'B12 450', 'vitamina D3 1000 UI', 'Pressione 130/80 mmHg. Peso 72 kg.', 'Metformina 1000 mg al mattino.', 'Creatinina 1,2 mg/dl.', 'Metformina mille mg.', 'Levotiroxina 50 µg.']) test(`preserves clinical form ${value}`, () => {
    assert.deepEqual(clinicalIdentifierSpans(value, { names: ['01', '2026', 'Di'], birthDates: [] }), []);
});
test('known homonyms precede clinical exemptions and prefixes start at a word', () => {
    assert.ok(clinicalIdentifierSpans('Diabete mellito', { names: ['Diabete'], birthDates: [] }).length);
    assert.deepEqual(clinicalIdentifierSpans('Antimartellamento', { names: ['Marta'], birthDates: [] }), []);
});
test('native collector review fixture and Node normalization agree', async () => {
    const { readFileSync } = await import('node:fs');
    const fixture = JSON.parse(readFileSync(new URL('../../native/contracts/clinical-known-equivalence.json', import.meta.url), 'utf8'));
    const corpus = JSON.parse(readFileSync(new URL('../../scripts/fixtures/clinical-chat-exact-corpus.json', import.meta.url), 'utf8'));
    for (const entry of corpus.filter((entry: { id: string }) => fixture.comparison.some((value: { id: string }) => value.id === entry.id))) {
        const decision = (known: { names: string[]; birthDates: string[] }) => clinicalIdentifierSpans(entry.texts.join('\n'), known).length > 0;
        // The collector no longer emits these short address fragments; the corpus still lists them.
        const collected = { ...entry.known, names: entry.known.names.filter((name: string) => !['Via', 'Ada', '42'].includes(name)) };
        assert.equal(decision(fixture.currentNativeKnown), decision(collected), entry.id);
    }
    for (const value of ['Marta', 'Mart', 'Vall', 'RSSMRA', 'PT-ALFA', 'Mаrtа', 'Μαρτα', 'Ada Lattesi', '1972-04-17', 'HbA1c 7,2. Peso 72 kg.']) {
        assert.equal(clinicalIdentifierSpans(value, fixture.currentNativeKnown).length > 0, clinicalIdentifierSpans(value, fixture.nativeKnown).length > 0, value);
    }
});

test('CF detection cannot concatenate ordinary clinical words and measurements into a code', async () => {
    const { readFileSync } = await import('node:fs');
    const corpus = JSON.parse(readFileSync(new URL('../../scripts/fixtures/clinical-chat-exact-corpus.json', import.meta.url), 'utf8'));
    for (const entry of corpus.filter((entry: { id: string }) => entry.id.startsWith('mixed-positive'))) {
        assert.deepEqual(clinicalIdentifierSpans(entry.texts.join('\n'), entry.known), [], entry.id);
        assert.deepEqual(clinicalIdentifierSpans([...entry.texts, ...entry.texts].join('\n'), entry.known), [], entry.id + ' both sections');
    }
});

const flagged = (text: string, names: string[]) => clinicalIdentifierSpans(text, { names, birthDates: [] }).length > 0;
test('a short known surname is compared whole, without hiding ordinary words', () => {
    assert.equal(flagged('Bo riferisce miglioramento della dispnea.', ['Bo']), true);
    assert.equal(flagged('Decorso di Li stabile.', ['Li']), true);
    assert.equal(flagged('Bonifico e libri non sono cognomi.', ['Bo', 'Li']), false);
});
test('a typo of a known name is still that name', () => {
    for (const text of ['Terapia invariata in Mqrta Vqlli.', 'Terapia invariata in Mrata.', 'Controllo di Valii.']) assert.equal(flagged(text, ['Marta', 'Valli']), true, text);
    assert.equal(flagged('Terapia invariata, dispnea stabile.', ['Marta', 'Valli']), false);
});
for (const text of [
    'Assumere apixaban 5 mg alle 8.00 e alle 20.00. Evitare FANS e segnalare sanguinamenti.',
    'Assumere amoxicillina/acido clavulanico 875/125 mg ogni 12 ore per 6 giorni.',
    'Asma stabile. Proseguire budesonide/formoterolo 160/4,5 µg due inalazioni mattina e sera.',
    "Dopo l'esame dell'asma, controllare TSH e FT4 tra sei settimane.",
]) test(`ordinary clinical text is not an identifier: ${text}`, () => assert.equal(flagged(text, ['Marta', 'Valli']), false));
for (const text of ['Telefono 3471234567.', 'Chiamare 347 123 4567 domani.', 'Valore 25.99 di 3471.', 'Ma®ta riferisce.', 'Va||i riferisce.'])
    test(`still flagged: ${text}`, () => assert.equal(flagged(text, ['Marta', 'Valli']), true));

