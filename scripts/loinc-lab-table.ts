import { readFileSync } from 'node:fs';
import type { LoincLabRow, LoincLabStatus, LoincLabUnit } from '../lib/generated-loinc-lab-catalog';

export const LOINC_LAB_TABLE_PATH = 'assets/reference-data/loinc/esami-laboratorio-it.csv';
export const LOINC_LAB_MODULE_PATH = 'lib/generated-loinc-lab-catalog.ts';
export const LOINC_LAB_UNITS_PATH = 'assets/reference-data/loinc/unita-ucum-it.csv';
export const LOINC_LAB_UNITS_NATIVE_PATH = 'native/contracts/ucum/unita-laboratorio.json';
export const LOINC_LAB_TABLE_VERSION = '2.83';
export const REPORT_WITHOUT_UNIT = 'nessuna';

const COLUMNS = [
    'nome_it', 'sinonimi_it', 'loinc', 'loinc_long_name', 'componente', 'proprieta', 'sistema', 'scala', 'metodo',
    'unita_ucum', 'unita_alternative', 'unita_referto', 'fonte_url', 'verifica', 'ambiguita', 'stato',
] as const;
type Column = typeof COLUMNS[number];
const STATUSES: readonly LoincLabStatus[] = ['attivo', 'in_attesa_di_validazione'];
const NUMERIC_SCALES: readonly string[] = ['Qn', 'SemiQn'];
const DIMENSIONLESS_UNIT = /^(?:\{[^{}]+\}|\[pH\])$/u;
const UNIT_COLUMNS = ['ucum', 'descrizione_ucum', 'lettura_it'] as const;

export function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (quoted) {
            if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
            else if (char === '"') quoted = false;
            else field += char;
        } else if (char === '"' && field === '') quoted = true;
        else if (char === ',') { row.push(field); field = ''; }
        else if (char === '\n' || char === '\r') {
            if (char === '\r' && text[index + 1] === '\n') index += 1;
            row.push(field); rows.push(row); row = []; field = '';
        } else field += char;
    }
    if (quoted) throw new Error('CSV: virgolette non chiuse');
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
}

export function loincCheckDigitValid(code: string): boolean {
    const match = /^(\d{1,7})-(\d)$/u.exec(code);
    if (!match) return false;
    const sum = [...match[1]].reverse().reduce((total, digit, position) => {
        const value = Number(digit) * (position % 2 === 0 ? 2 : 1);
        return total + Math.floor(value / 10) + (value % 10);
    }, 0);
    return (10 - (sum % 10)) % 10 === Number(match[2]);
}

export function parseLoincLabTable(text: string): LoincLabRow[] {
    const [header, ...body] = parseCsv(text);
    if (JSON.stringify(header) !== JSON.stringify(COLUMNS)) throw new Error(`Intestazione della tabella LOINC diversa da: ${COLUMNS.join(',')}`);
    const seen = new Set<string>();
    return body.map((cells, index) => {
        const line = index + 2;
        if (cells.length !== COLUMNS.length) throw new Error(`Riga ${line}: ${cells.length} colonne invece di ${COLUMNS.length}`);
        const cell = (column: Column) => cells[COLUMNS.indexOf(column)];
        const code = cell('loinc');
        if (!loincCheckDigitValid(code)) throw new Error(`Riga ${line}: codice LOINC ${code} con cifra di controllo errata`);
        if (seen.has(code)) throw new Error(`Riga ${line}: codice LOINC ${code} ripetuto`);
        seen.add(code);
        const status = cell('stato') as LoincLabStatus;
        if (!STATUSES.includes(status)) throw new Error(`Riga ${line}: stato «${cell('stato')}» non previsto (${STATUSES.join(', ')})`);
        const unit = cell('unita_ucum');
        if (NUMERIC_SCALES.includes(cell('scala')) !== (unit !== '')) throw new Error(`Riga ${line}: un esame a scala ${NUMERIC_SCALES.join(' o ')} richiede l'unità UCUM, uno a scala ${cell('scala')} non la porta`);
        if (/\s/u.test(unit)) throw new Error(`Riga ${line}: unità UCUM «${unit}» con spazi`);
        const nameIt = cell('nome_it').trim();
        const longCommonName = cell('loinc_long_name');
        if (!nameIt || !longCommonName) throw new Error(`Riga ${line}: nome italiano e Long Common Name sono obbligatori`);
        const synonyms = cell('sinonimi_it').split('|').map((synonym) => synonym.trim()).filter(Boolean);
        const reportUnits = parseReportUnits(cell('unita_referto'), unit, line);
        return { code, longCommonName, nameIt, synonyms, unit, reportUnits, status };
    });
}

function parseReportUnits(text: string, unit: string, line: number): string[] {
    const spellings = text.split('|').map((spelling) => spelling.trim()).filter(Boolean);
    if (spellings.length && !unit) throw new Error(`Riga ${line}: scritture dell'unità per un esame senza unità UCUM`);
    if (new Set(spellings).size !== spellings.length) throw new Error(`Riga ${line}: scrittura dell'unità ripetuta`);
    for (const spelling of spellings) {
        if (/\s/u.test(spelling)) throw new Error(`Riga ${line}: scrittura dell'unità «${spelling}» con spazi`);
        if (spelling === REPORT_WITHOUT_UNIT && !DIMENSIONLESS_UNIT.test(unit)) throw new Error(`Riga ${line}: «${REPORT_WITHOUT_UNIT}» vale solo per un'unità UCUM senza dimensione, non per ${unit}`);
    }
    return spellings.map((spelling) => spelling === REPORT_WITHOUT_UNIT ? '' : spelling);
}

export function parseLoincLabUnits(text: string, rows: readonly LoincLabRow[]): LoincLabUnit[] {
    const [header, ...body] = parseCsv(text);
    if (JSON.stringify(header) !== JSON.stringify(UNIT_COLUMNS)) throw new Error(`Intestazione delle unità UCUM diversa da: ${UNIT_COLUMNS.join(',')}`);
    const used = new Set(rows.map((row) => row.unit).filter(Boolean));
    const seen = new Set<string>();
    return body.map((cells, index) => {
        const line = index + 2;
        if (cells.length !== UNIT_COLUMNS.length) throw new Error(`Unità, riga ${line}: ${cells.length} colonne invece di ${UNIT_COLUMNS.length}`);
        const [code, display, displayIt] = cells.map((cell) => cell.trim());
        if (!code || !display) throw new Error(`Unità, riga ${line}: codice UCUM e descrizione sono obbligatori`);
        if (seen.has(code)) throw new Error(`Unità, riga ${line}: ${code} ripetuta`);
        if (!used.has(code)) throw new Error(`Unità, riga ${line}: ${code} non compare nella tabella degli esami`);
        if (!displayIt && !DIMENSIONLESS_UNIT.test(code)) throw new Error(`Unità, riga ${line}: la lettura vuota vale solo per un'unità senza dimensione, non per ${code}`);
        seen.add(code);
        return { code, display, displayIt };
    });
}

export function renderLoincLabModule(rows: readonly LoincLabRow[], units: readonly LoincLabUnit[]): string {
    const lines = (items: readonly object[]) => items.map((item) => `    ${JSON.stringify(item)},`);
    return [
        `export type LoincLabStatus = ${STATUSES.map((status) => `'${status}'`).join(' | ')};`,
        'export interface LoincLabRow { code: string; longCommonName: string; nameIt: string; synonyms: string[]; unit: string; reportUnits: string[]; status: LoincLabStatus }',
        'export interface LoincLabUnit { code: string; display: string; displayIt: string }',
        '',
        `export const LOINC_LAB_VERSION = '${LOINC_LAB_TABLE_VERSION}';`,
        '',
        'export const LOINC_LAB_TABLE: readonly LoincLabRow[] = [',
        ...lines(rows),
        '];',
        '',
        'export const LOINC_LAB_UNITS: readonly LoincLabUnit[] = [',
        ...lines(units),
        '];',
        '',
    ].join('\n');
}

export function renderLoincLabUnitsNative(units: readonly LoincLabUnit[]): string {
    return `${JSON.stringify(units.map(({ code, displayIt }) => ({ code, displayIt })), null, 2)}\n`;
}

export function readLoincLabTable(): LoincLabRow[] {
    return parseLoincLabTable(readFileSync(LOINC_LAB_TABLE_PATH, 'utf8'));
}

export function readLoincLabUnits(rows: readonly LoincLabRow[]): LoincLabUnit[] {
    return parseLoincLabUnits(readFileSync(LOINC_LAB_UNITS_PATH, 'utf8'), rows);
}

export function loincLabTableCode(rows: readonly LoincLabRow[], name: string, unit: string): string {
    const matches = rows.filter((row) => row.unit === unit
        && [row.nameIt, row.nameIt.replace(/\(.*\)/u, '').trim(), ...row.synonyms].includes(name));
    if (matches.length !== 1) throw new Error(`«${name}» in ${unit}: ${matches.length} righe nella tabella LOINC`);
    return matches[0].code;
}
