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
