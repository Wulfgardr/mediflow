/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SYNTHETIC_LAB_REPORT_FIXTURES } from './lab-report-parser.fixtures.ts';
import { parseItalianLabReport } from './lab-report-parser.ts';

for (const fixture of SYNTHETIC_LAB_REPORT_FIXTURES) {
    test(`parses synthetic Italian lab fixture: ${fixture.id}`, () => {
        const results = parseItalianLabReport(fixture.text);
        assert.deepEqual(results.map((result) => result.analyte), [...fixture.expectedAnalytes]);
    });
}

test('normalizes decimal commas, unilateral ranges, UCUM units and range flags', () => {
    const results = SYNTHETIC_LAB_REPORT_FIXTURES.flatMap((fixture) => parseItalianLabReport(fixture.text));
    const creatinine = results.find((result) => result.analyte === 'Creatinina');
    const crp = results.find((result) => result.analyte === 'Proteina C reattiva');
    const whiteCells = results.find((result) => result.analyte === 'Globuli bianchi');

    assert.deepEqual(creatinine, {
        analyte: 'Creatinina', value: '1.35', unit: 'mg/dL',
        referenceRange: { text: '0,50 - 1,10', low: '0.50', high: '1.10' },
        flag: 'alto', lineNumber: 3,
        sourceLine: 'Creatinina    1,35 *    mg/dL    0,50 - 1,10    H',
    });
    assert.deepEqual(crp?.referenceRange, { text: '< 5', high: '5' });
    assert.equal(crp?.flag, undefined);
    assert.equal(whiteCells?.unit, '10*3/uL');
});

test('preserves strict and inclusive unilateral bounds at the threshold', () => {
    const results = parseItalianLabReport(`Proteina C reattiva 5 mg/L < 5 H
TSH 4 uUI/mL > 4 L
Sodio 145 mmol/L <= 145`);

    assert.deepEqual(results.map(({ analyte, flag }) => ({ analyte, flag })), [
        { analyte: 'Proteina C reattiva', flag: 'alto' },
        { analyte: 'TSH', flag: 'basso' },
        { analyte: 'Sodio', flag: undefined },
    ]);
});

test('canonicalizes supported unit casing and rejects ambiguous compact cell counts', () => {
    const [sodium] = parseItalianLabReport('Sodio 140 MMOL/L 136-145');

    assert.equal(sodium?.unit, 'mmol/L');
    assert.deepEqual(parseItalianLabReport('Globuli bianchi 7,2 103/uL 4-10'), []);
});

test('discards incomplete, malformed and contradictory rows instead of guessing', () => {
    const text = `Glicemia 104 mg/dL
Creatinina 1,20 0,50-1,10
Codice pratica 202607170001 mg/dL 0-10
Potassio 6,2 mmol/L 3,5-5,1 L
Sodio 140 mmol/L 136-145 H
Proteina C reattiva > 5 mg/L < 5 H
TSH < 4 uUI/mL > 4 L
Calcio sette mg/dL 8,5-10,5`;

    assert.deepEqual(parseItalianLabReport(text), []);
});
