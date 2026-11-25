import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { LOINC_LAB_TABLE, LOINC_LAB_UNITS, LOINC_LAB_VERSION } from './generated-loinc-lab-catalog';
import { LOINC_PENDING_VALIDATION, formatMeasureValue, formatUnitForDisplay, loincObservationNames, resolveStaticTerminology, searchStaticTerminology } from './terminology';
import { validateObservationDocument } from './fse-validation';
import { catalogObservationCode } from './domain/documents/dossier-sections';
import {
    LOINC_LAB_MODULE_PATH, LOINC_LAB_TABLE_PATH, LOINC_LAB_TABLE_VERSION, LOINC_LAB_UNITS_NATIVE_PATH, LOINC_LAB_UNITS_PATH, loincCheckDigitValid, loincLabTableCode, parseCsv,
    parseLoincLabTable, parseLoincLabUnits, readLoincLabTable, readLoincLabUnits, renderLoincLabModule, renderLoincLabUnitsNative,
} from '../scripts/loinc-lab-table';

const table = readLoincLabTable();
const units = readLoincLabUnits(table);
const active = table.filter((row) => row.status === 'attivo');
const pending = table.filter((row) => row.status === 'in_attesa_di_validazione');
const namesOf = (row: typeof table[number]) => [row.nameIt, row.nameIt.replace(/\(.*\)/u, ''), ...row.synonyms];

test('the active catalog is generated from the committed table: same codes, official names, units and status', () => {
    assert.equal(readFileSync(LOINC_LAB_MODULE_PATH, 'utf8'), renderLoincLabModule(table, units), 'npm run generate:loinc-lab-catalog');
    assert.equal(LOINC_LAB_VERSION, LOINC_LAB_TABLE_VERSION);
    assert.equal(LOINC_LAB_TABLE.length, table.length);
    table.forEach((row, index) => {
        const generated = LOINC_LAB_TABLE[index];
        assert.deepEqual([generated.code, generated.longCommonName, generated.unit, generated.nameIt, generated.status],
            [row.code, row.longCommonName, row.unit, row.nameIt, row.status], row.code);
        assert.deepEqual(generated.synonyms, row.synonyms, row.code);
        assert.deepEqual(generated.reportUnits, row.reportUnits, row.code);
    });
    assert.deepEqual(LOINC_LAB_UNITS, units);
    assert.equal(readFileSync(LOINC_LAB_UNITS_NATIVE_PATH, 'utf8'), renderLoincLabUnitsNative(units), 'npm run generate:loinc-lab-catalog');
    const csv = parseCsv(readFileSync(LOINC_LAB_TABLE_PATH, 'utf8'));
    const column = (name: string) => csv[0].indexOf(name);
    assert.deepEqual(csv.slice(1).map((cells) => [cells[column('loinc')], cells[column('loinc_long_name')], cells[column('unita_ucum')]]),
        LOINC_LAB_TABLE.map((row) => [row.code, row.longCommonName, row.unit]));
});

test('40 active rows enter the static LOINC catalog with official name and unit; the 44 awaiting validation do not', () => {
    assert.deepEqual([active.length, pending.length], [40, 44]);
    for (const row of active) {
        assert.deepEqual(resolveStaticTerminology('LOINC', row.code), {
            system: 'LOINC', code: row.code, display: row.longCommonName, displayIt: row.nameIt,
            defaultUnit: row.unit || undefined, version: LOINC_LAB_TABLE_VERSION, source: 'local-pilot-catalog',
        });
    }
    for (const row of pending) assert.equal(resolveStaticTerminology('LOINC', row.code), null, row.code);
    const existing = [...searchStaticTerminology('LOINC', '', 1000).filter((item) => item.version !== LOINC_LAB_TABLE_VERSION), ...LOINC_PENDING_VALIDATION];
    assert.deepEqual(existing.filter((item) => table.some((row) => row.code === item.code)), [], 'no table row duplicates an existing entry');
});

test('a row awaiting validation never codes, under any of its names', () => {
    for (const row of pending) {
        for (const name of namesOf(row)) assert.equal(catalogObservationCode(name, row.unit, '1'), null, `${row.code} ${name}`);
    }
    for (const item of LOINC_PENDING_VALIDATION) assert.equal(catalogObservationCode(item.displayIt ?? '', item.defaultUnit ?? '', '1'), null, item.code);
});

test('a name awaiting validation blocks coding in every unit, as on main', () => {
    const names = loincObservationNames();
    const units = [...new Set(names.map((entry) => entry.unit).filter(Boolean))];
    const pendingNames = names.filter((entry) => !entry.active);
    assert.ok(pendingNames.length > 0 && units.length > 1);
    for (const { name, code } of pendingNames) {
        for (const unit of units) assert.equal(catalogObservationCode(name, unit, '1'), null, `${code} ${name} ${unit}`);
    }
    for (const [name, unit, value] of [['Calcio', 'mmol/L', '2,3'], ['Calcio totale', 'mmol/L', '2,3'], ['FT4', 'pmol/L', '15'], ['FT3', 'pmol/L', '5']] as const) {
        assert.equal(catalogObservationCode(name, unit, value), null, `${name} ${unit} awaits the clinical choice between mass and molar units`);
    }
    assert.equal(catalogObservationCode('Glicemia', 'mg/dL', '95'), null, 'the pilot glucose shares its name with the serum/plasma entry awaiting validation');
});

test('every active row with a unit codes under its names, except names another row claims in the same unit or a name awaiting validation', () => {
    const normalized = (value: string) => value.toLocaleLowerCase('it-IT').normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const owners = new Map<string, Set<string>>();
    const names = loincObservationNames();
    const pendingNames = new Set(names.filter((entry) => !entry.active).map((entry) => normalized(entry.name)));
    for (const entry of names.filter((candidate) => candidate.active)) {
        const key = `${normalized(entry.name)}|${entry.unit}`;
        owners.set(key, new Set([...(owners.get(key) ?? []), entry.code]));
    }
    for (const row of active) {
        const outcomes = namesOf(row).map((name) => [name, catalogObservationCode(name, row.unit, '1')?.code ?? null] as const);
        if (!row.unit) {
            assert.deepEqual(outcomes.filter(([, code]) => code), [], `${row.code}: no unit, no code`);
            continue;
        }
        for (const [name, code] of outcomes) {
            const shared = (owners.get(`${normalized(name)}|${row.unit}`)?.size ?? 0) > 1 || pendingNames.has(normalized(name));
            assert.equal(code, shared ? null : row.code, `${row.code} ${name}`);
        }
        assert.ok(outcomes.some(([, code]) => code === row.code), `${row.code} must be reachable`);
    }
});

test('two units of the same analyte choose two different codes and never share a series', () => {
    const pairs = [
        ['Magnesio', 'mg/dL', 'mmol/L'], ['Fosforo', 'mg/dL', 'mmol/L'], ['Vitamina B12', 'pg/mL', 'pmol/L'], ['Folati', 'ng/mL', 'nmol/L'],
        ['Vitamina D 25-OH', 'ng/mL', 'nmol/L'], ['Rapporto albumina/creatinina urinario', 'mg/g{creat}', 'mmol/mol{creat}'],
    ] as const;
    for (const [name, mass, molar] of pairs) {
        const codes = [catalogObservationCode(name, mass, '1')?.code, catalogObservationCode(name, molar, '1')?.code];
        assert.deepEqual(codes, [loincLabTableCode(table, name, mass), loincLabTableCode(table, name, molar)], name);
        assert.notEqual(codes[0], codes[1], name);
        assert.equal(catalogObservationCode(name, 'g/L', '1'), null, name);
    }
    for (const [name, unit] of [['Calcio totale', 'mmol/L'], ['Calcio totale', 'mg/dL'], ['FT4', 'pmol/L'], ['FT4', 'ng/dL'], ['FT3', 'pmol/L'], ['FT3', 'pg/mL']] as const) {
        assert.equal(catalogObservationCode(name, unit, '1'), null, `${name} ${unit} is still awaiting validation`);
    }
});

test('counterexamples stay uncoded: unexpected unit, awaiting validation, near name, non-numeric value, removed broad synonyms', () => {
    assert.equal(catalogObservationCode('Acido urico', 'mg/dL', '5,2')?.code, loincLabTableCode(table, 'Acido urico', 'mg/dL'));
    for (const [name, unit, value] of [
        ['Acido urico', 'umol/L', '300'], ['Acido urico', '', '5,2'], ['Acido urico', 'mg/dl', '5,2'],
        ['Azotemia', 'mg/dL', '40'], ['LDH', 'U/L', '200'], ['VES', 'mm/h', '12'], ['eGFR', 'mL/min/{1.73_m2}', '80'], ['HbA1c', 'mmol/mol', '40'],
        ['Acido urico totale', 'mg/dL', '5,2'], ['Ferritina sierica', 'ng/mL', '30'], ['Lipasi pancreatica', 'U/L', '35'],
        ['Acido urico', 'mg/dL', 'negativo'], ['Acido urico', 'mg/dL', '<5'], ['Acido urico', 'mg/dL', ''], ['Acido urico', 'mg/dL', '1e3'],
        ['Acido urico', 'mg/dL', '0x10'], ['Acido urico', 'mg/dL', '5,2 mg/dL'], ['Acido urico', 'mg/dL', '٥'],
        ['Ca', 'mmol/L', '2,3'], ['P', 'mg/dL', '3,4'], ['proBNP', 'pg/mL', '80'],
    ] as const) assert.equal(catalogObservationCode(name, unit, value), null, `${name} ${unit} ${value}`);
});

test('the table parser rejects a wrong check digit, an unknown status, a quantitative row without unit and a repeated code', () => {
    assert.ok(table.every((row) => loincCheckDigitValid(row.code)));
    assert.equal(loincCheckDigitValid('2160-1'), false);
    const csv = readFileSync(LOINC_LAB_TABLE_PATH, 'utf8');
    const [header, first, second] = csv.split('\n');
    const lines = (...rows: string[]) => [header, ...rows].join('\n');
    const code = parseCsv(first)[0][2];
    const wrongDigit = `${code.slice(0, -1)}${(Number(code.slice(-1)) + 1) % 10}`;
    assert.throws(() => parseLoincLabTable(lines(first.replace(`,${code},`, `,${wrongDigit},`))), /cifra di controllo/u);
    assert.throws(() => parseLoincLabTable(lines(first.replace(/,in_attesa_di_validazione$|,attivo$/u, ',promosso'))), /stato/u);
    assert.throws(() => parseLoincLabTable(lines(first.replace(',10*3/uL,', ',,'))), /unità UCUM/u);
    assert.throws(() => parseLoincLabTable(lines(first, first)), /ripetuto/u);
    assert.throws(() => parseLoincLabTable(lines(second).replace('stato', 'state')), /Intestazione/u);
    assert.equal(parseLoincLabTable(lines(first.replace(/,in_attesa_di_validazione$/u, ',attivo')))[0].status, 'attivo', 'promoting a row is one cell');
});

test('the five urine strip rows with a word as result wait for a product choice, with the reason in the table', () => {
    const csv = parseCsv(readFileSync(LOINC_LAB_TABLE_PATH, 'utf8'));
    const column = (name: string) => csv[0].indexOf(name);
    const ordinal = csv.slice(1).filter((cells) => cells[column('scala')] === 'Ord');
    assert.ok(ordinal.length >= 5);
    for (const cells of ordinal) {
        assert.equal(cells[column('stato')], 'in_attesa_di_validazione', cells[column('loinc')]);
        assert.equal(resolveStaticTerminology('LOINC', cells[column('loinc')]), null, cells[column('loinc')]);
    }
    const reasoned = ordinal.filter((cells) => cells[column('ambiguita')].includes('MediFlow per ora codifica solo valori numerici'));
    assert.equal(reasoned.length, 5);
});

test('every unit of the table is in the UCUM catalog with an Italian reading; validation no longer flags it', () => {
    const pilot = searchStaticTerminology('UCUM', '', 1000).filter((item) => !units.some((unit) => unit.code === item.code));
    assert.equal(pilot.length + units.length, searchStaticTerminology('UCUM', '', 1000).length, 'generated units never shadow the pilot');
    for (const unit of new Set(table.map((row) => row.unit).filter(Boolean))) {
        assert.equal(resolveStaticTerminology('UCUM', unit)?.code, unit, unit);
        const { errors } = validateObservationDocument({ codeSystem: 'LOINC', code: '8867-4', unitSystem: 'UCUM', unitCode: unit, value: 1 });
        assert.deepEqual(errors.filter((error) => error.field === 'unitCode'), [], unit);
    }
    assert.deepEqual(['[IU]/mL', 'pmol/L', 'ug/L{DDU}', 'mg/g{creat}', 'mL/min/{1.73_m2}', 's', '{INR}', '[pH]', '{Spec_grav}', '{ratio}'].map(formatUnitForDisplay),
        ['UI/mL', 'pmol/L', 'µg/L DDU', 'mg/g creatinina', 'mL/min/1,73 m²', 's', '', '', '', '']);
    assert.equal(formatUnitForDisplay('mg/dL'), 'mg/dL');
    assert.deepEqual([formatMeasureValue('1.1', '{INR}'), formatMeasureValue('12', '[IU]/mL')], ['1,1', '12 UI/mL']);
    assert.equal(units.length, 23, 'same count as the GPUI client test');
});

test('printed spellings are table data: «nessuna» only for a dimensionless unit, no spaces, no repeats, none on a row without unit', () => {
    const csv = readFileSync(LOINC_LAB_TABLE_PATH, 'utf8');
    const [header, ...rows] = csv.trimEnd().split('\n');
    const column = parseCsv(header)[0].indexOf('unita_referto');
    const withCell = (unit: string, spellings: string) => {
        const line = rows.find((candidate) => parseCsv(candidate)[0][parseCsv(header)[0].indexOf('unita_ucum')] === unit)!;
        const cells = parseCsv(line)[0];
        cells[column] = spellings;
        return [header, cells.map((cell) => /[",]/u.test(cell) ? `"${cell.replace(/"/gu, '""')}"` : cell).join(',')].join('\n');
    };
    assert.deepEqual(parseLoincLabTable(withCell('{INR}', 'nessuna|INR'))[0].reportUnits, ['', 'INR']);
    assert.throws(() => parseLoincLabTable(withCell('mg/dL', 'nessuna')), /senza dimensione/u);
    assert.throws(() => parseLoincLabTable(withCell('s', 'sec|sec')), /ripetuta/u);
    assert.throws(() => parseLoincLabTable(withCell('s', 'mg dl')), /spazi/u);
    assert.throws(() => parseLoincLabTable(withCell('', 'nessuna')), /senza unità UCUM/u);
    const unitsCsv = readFileSync(LOINC_LAB_UNITS_PATH, 'utf8');
    const [unitHeader, firstUnit] = unitsCsv.split('\n');
    assert.throws(() => parseLoincLabUnits([unitHeader, firstUnit, firstUnit].join('\n'), table), /ripetuta/u);
    assert.throws(() => parseLoincLabUnits([unitHeader, 'kat/L,katal per liter,kat/L'].join('\n'), table), /non compare/u);
    assert.throws(() => parseLoincLabUnits([unitHeader, 'pmol/L,picomole per liter,'].join('\n'), table), /lettura vuota/u);
});
