/* @Codex: synthetic fixtures only; parser tests perform no I/O. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    isPatientCsvDate, isPatientCsvRowEligible, markExistingPatientDuplicates,
    normalizePatientCsvTaxCode, parsePatientCsv, PATIENT_CSV_HEADERS, PATIENT_CSV_LIMITS, PATIENT_CSV_TEMPLATE,
    type PatientCsvPreview,
} from './patient-bulk-import.ts';

const header = PATIENT_CSV_HEADERS.join(';');
const code = (index = 1) => `SYNTHETIC${String(index).padStart(7, '0')}`;
const bytes = (text: string) => new TextEncoder().encode(text);
const line = (index = 1) => `Ada;Sintetica;${code(index)};;;`;
const parse = (text: string) => parsePatientCsv(bytes(text));
function preview(text: string): PatientCsvPreview {
    const result = parse(text);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error('Fixture did not parse.');
    return result.preview;
}
function error(text: string, expected: string): void {
    const result = parse(text);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, expected);
}

test('template contains the exact six headers and no patient data', () => {
    assert.equal(PATIENT_CSV_TEMPLATE, `\uFEFF${header}\r\n`);
    assert.equal(preview(PATIENT_CSV_TEMPLATE).rows.length, 0);
});
test('UTF-8 identities are not trimmed, transliterated or otherwise rewritten; empty optionals absent', () => {
    const row = preview(`${header}\n  Zoë  ;D’Àngelo; synthetic0000001 ;;;`).rows[0];
    assert.deepEqual(row.values, { firstName: '  Zoë  ', lastName: 'D’Àngelo', taxCode: code() });
    assert.equal(isPatientCsvRowEligible(row), true);
    for (const key of ['birthDate', 'address', 'phone']) assert.equal(Object.hasOwn(row.values!, key), false);
});
test('quoted separators, escaped quotes, CRLF and multiline address preserve exact values and line numbers', () => {
    const rows = preview(`\uFEFF${header}\r\n"Ada; A";"D""Angelo";${code()};2000-02-29;"Via ; Prova\r\nInterno ""A""";+3900123\r\n${line(2)}\r\n`).rows;
    assert.deepEqual(rows[0].values, { firstName: 'Ada; A', lastName: 'D"Angelo', taxCode: code(), birthDate: '2000-02-29', address: 'Via ; Prova\r\nInterno "A"', phone: '+3900123' });
    assert.equal(rows[0].line, 2);
    assert.equal(rows[1].line, 4);
    assert.equal(rows[1].row, 2);
});
test('ASCII-only CF normalization precedes uppercasing and never erases internal whitespace', () => {
    assert.equal(normalizePatientCsvTaxCode('  synthetic0000001  '), code());
    for (const value of ['SYNTHETIß0000001', 'SYNTHETIK0000001', 'SYNTHETIC000 001', '\tsynthetic0000001', '\u00a0synthetic0000001', 'SYNTHETIC00000012']) {
        assert.equal(normalizePatientCsvTaxCode(value), null);
    }
});
for (const value of ['2000-02-29', '2024-02-29', '0001-01-01', '0099-12-31', '9999-12-31', '2400-02-29']) {
    test(`real Gregorian date accepted: ${value}`, () => assert.equal(isPatientCsvDate(value), true));
}
for (const value of ['1900-02-29', '2100-02-29', '2023-02-29', '2024-04-31', '2024-13-01', '2024-00-01', '2024-01-00', '0000-01-01', '2024-2-01', '2024-02-01T00:00:00Z', '01/02/2024']) {
    test(`invalid or ambiguous date excluded: ${value}`, () => assert.equal(isPatientCsvDate(value), false));
}
test('semantic invalidity stays row-local and never produces values eligible to write', () => {
    const rows = preview(`${header}\nA;B;SHORT;2024-02-30;;\n${line(2)}`).rows;
    assert.equal(rows[0].issues.length, 4);
    assert.equal(rows[0].values, undefined);
    assert.equal(isPatientCsvRowEligible(rows[0]), false);
    assert.equal(isPatientCsvRowEligible(rows[1]), true);
});
test('whitespace-only names are invalid without mutating names', () => {
    const row = preview(`${header}\n  ; A ;${code()};;;`).rows[0];
    assert.equal(row.issues.filter(issue => issue.code === 'name').length, 2);
});
test('all file occurrences of a duplicate CF are excluded, even when one name is invalid', () => {
    const rows = preview(`${header}\n${line()}\nA;Altro; synthetic0000001 ;;;\n${line(2)}`).rows;
    assert.equal(rows[0].duplicateInFile, true);
    assert.equal(rows[1].duplicateInFile, true);
    assert.equal(rows.filter(isPatientCsvRowEligible).length, 1);
});
test('existing-scope comparison is deterministic, reversible and does not mutate the initial preview', () => {
    const original = preview(`${header}\n${line()}`);
    const marked = markExistingPatientDuplicates(original, [{ id: 'synthetic-existing', taxCode: ' synthetic0000001 ' }]);
    assert.equal(marked.rows[0].duplicateExisting, true);
    assert.equal(original.rows[0].duplicateExisting, false);
    assert.equal(markExistingPatientDuplicates(marked, []).rows[0].duplicateExisting, false);
});
test('empty physical lines are ignored; an explicit empty six-column record is invalid', () => {
    const rows = preview(`${header}\r\n\r\n;;;;;\r\n\r\n${line()}\r\n`).rows;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].line, 3);
    assert.equal(rows[1].line, 5);
    assert.equal(rows[0].issues.length, 3);
});
for (const [content, expected] of [
    [`nome;nome;codice_fiscale;data_nascita;indirizzo;telefono\n${line()}`, 'header-duplicate'],
    [`nome;cognome;codice_fiscale;data_nascita;diagnosi;telefono\n${line()}`, 'header-unknown'],
    [`cognome;nome;codice_fiscale;data_nascita;indirizzo;telefono`, 'header-order'],
    ['nome;cognome;codice_fiscale', 'header-order'],
    [header.replaceAll(';', ','), 'header-unknown'],
    [`\n${header}\n${line()}`, 'header'],
    [`${header}\n"Ada;Sintetica;${code()};;;`, 'quote-unclosed'],
    [`${header}\nAd"a;Sintetica;${code()};;;`, 'quote-position'],
    [`${header}\n"Ada"x;Sintetica;${code()};;;`, 'quote-trailing'],
    [`${header}\n${line()};unexpected`, 'columns'],
] as const) {
    test(`structural rejection: ${expected} (${content.slice(0, 20)})`, () => error(content, expected));
}
test('missing row columns are shown as an invalid row', () => {
    const row = preview(`${header}\nAda;Sintetica;${code()}`).rows[0];
    assert.equal(row.issues[0].code, 'columns');
    assert.equal(row.values, undefined);
});
test('malformed and non-UTF-8 encodings fail before CSV parsing', () => {
    for (const value of [new Uint8Array([0xc3, 0x28]), new Uint8Array([0xff, 0xfe, 0, 0]), new Uint8Array([0xe2, 0x82])]) {
        const result = parsePatientCsv(value);
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.error.code, 'utf8');
    }
});
test('file byte limit is inclusive, and checked before malformed UTF-8 decoding', () => {
    const over = new Uint8Array(PATIENT_CSV_LIMITS.fileBytes + 1).fill(0xff);
    const result = parsePatientCsv(over);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'file-limit');
    // Blank physical lines fill the remainder, without allowing a huge row/cell allocation.
    const full = bytes(`${header}\n${'\n'.repeat(PATIENT_CSV_LIMITS.fileBytes - bytes(`${header}\n`).length)}`);
    assert.equal(full.length, PATIENT_CSV_LIMITS.fileBytes);
    assert.equal(parsePatientCsv(full).ok, true);
});
test('500 data records accepted; record 501 rejected before it is retained', () => {
    assert.equal(preview(`${header}\n${Array.from({ length: 500 }, (_, i) => line(i + 1)).join('\n')}`).rows.length, 500);
    error(`${header}\n${Array.from({ length: 501 }, (_, i) => line(i + 1)).join('\n')}`, 'row-limit');
});
test('streaming cell/record bounds are enforced independently of semantic field limits', () => {
    error(`${header}\n${'a'.repeat(1025)};;;;;`, 'cell-limit');
    const bounded = [1024, 1024, 1024, 1019, 0, 0].map(length => 'a'.repeat(length)).join(';');
    assert.equal(bounded.length, 4096);
    assert.equal(parse(`${header}\n${bounded}`).ok, true);
    error(`${header}\n${bounded}a`, 'record-limit');
});
test('field-length boundaries and control characters never truncate or sanitize values', () => {
    const valid = `${'A'.repeat(100)};${'B'.repeat(100)};${code()};2024-01-01;${'C'.repeat(500)};${'1'.repeat(80)}`;
    assert.equal(isPatientCsvRowEligible(preview(`${header}\n${valid}`).rows[0]), true);
    for (const invalid of [valid.replace('A'.repeat(100), 'A'.repeat(101)), valid.replace('C'.repeat(500), 'C'.repeat(501)), valid.replace('1'.repeat(80), '1'.repeat(81)), line().replace('Ada', 'Ad\u0000a')]) {
        assert.equal(isPatientCsvRowEligible(preview(`${header}\n${invalid}`).rows[0]), false);
    }
});
test('formula/markup strings remain literal text, without formula evaluation or HTML interpretation', () => {
    const row = preview(`${header}\n=2+2;<b>Synthetic</b>;${code()};;=1+1;+390001`).rows[0];
    assert.equal(row.values?.firstName, '=2+2');
    assert.equal(row.values?.lastName, '<b>Synthetic</b>');
    assert.equal(row.values?.address, '=1+1');
});
test('deterministic quoted roundtrips cover Unicode and mixed delimiters/line endings', () => {
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const fragments = ['Via', ';', '"', 'À', '中', '\n', '\r\n', ' '];
    for (let i = 0; i < 64; i += 1) {
        const address = Array.from({ length: 12 }, (_, j) => fragments[(i * 5 + j * 3) % fragments.length]).join('');
        const fields = ['Ada', 'Sintetica', code(i), '2000-02-29', address, '+39123'];
        const row = preview(`${header}\n${fields.map(quote).join(';')}`).rows[0];
        assert.deepEqual(row.cells, fields);
        assert.equal(row.values?.address, address);
    }
});

// 4096-unit fixtures here are deliberately semantically INVALID, not lost valid patients.
for (const length of [4095, 4096, 4097]) for (const ending of ['', '\n', '\r\n']) {
    test(`source record ${length} units has identical EOF/LF/CRLF handling (${JSON.stringify(ending)})`, () => {
        const row = [1024, 1024, 1024, length - 3072 - 5, 0, 0].map(n => 'a'.repeat(n)).join(';');
        assert.equal(row.length, length);
        const result = parse(`${header}\n${row}${ending}`);
        if (length > 4096) { assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, 'record-limit'); }
        else { assert.equal(result.ok, true); if (result.ok) {
            assert.equal(result.preview.rows.length, 1); assert(result.preview.rows[0].issues.length > 0);
            assert.equal(result.preview.rows[0].values, undefined);
        } }
    });
}
for (const newline of ['\n', '\r\n']) for (const length of [4095, 4096, 4097]) {
    test(`quoted internal ${JSON.stringify(newline)} counts in record limit ${length}`, () => {
        const quoted = `"${'a'.repeat(1000 - newline.length)}${newline}"`;
        const rest = [1024, 1024, 1024, length - quoted.length - 3072 - 5, 0].map(n => 'b'.repeat(n));
        const row = [quoted, ...rest].join(';'); assert.equal(row.length, length);
        const result = parse(`${header}\r\n${row}\r\n`);
        assert.equal(result.ok, length <= 4096);
        if (!result.ok) assert.equal(result.error.code, 'record-limit');
        else assert.equal(result.preview.rows[0].cells[0].length, 1000);
    });
}
test('quoted CRLF still counts TWO units at the streaming cell boundary', () => {
    for (const ending of ['', '\n', '\r\n']) {
        assert.equal(parse(`${header}\n"${'a'.repeat(1022)}\r\n";;;;;${ending}`).ok, true);
        error(`${header}\n"${'a'.repeat(1023)}\r\n";;;;;${ending}`, 'cell-limit');
    }
});
