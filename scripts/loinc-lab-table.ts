import { readFileSync } from 'node:fs';
import type { LoincLabRow, LoincLabStatus } from '../lib/generated-loinc-lab-catalog';

export const LOINC_LAB_TABLE_PATH = 'assets/reference-data/loinc/esami-laboratorio-it.csv';
export const LOINC_LAB_MODULE_PATH = 'lib/generated-loinc-lab-catalog.ts';
export const LOINC_LAB_TABLE_VERSION = '2.83';

const COLUMNS = [
    'nome_it', 'sinonimi_it', 'loinc', 'loinc_long_name', 'componente', 'proprieta', 'sistema', 'scala', 'metodo',
    'unita_ucum', 'unita_alternative', 'fonte_url', 'verifica', 'ambiguita', 'stato',
] as const;
type Column = typeof COLUMNS[number];
const STATUSES: readonly LoincLabStatus[] = ['attivo', 'in_attesa_di_validazione'];
const NUMERIC_SCALES: readonly string[] = ['Qn', 'SemiQn'];

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
        return { code, longCommonName, nameIt, synonyms, unit, status };
    });
}

export function renderLoincLabModule(rows: readonly LoincLabRow[]): string {
    const body = rows.map((row) => `    ${JSON.stringify(row)},`).join('\n');
    return [
        `export type LoincLabStatus = ${STATUSES.map((status) => `'${status}'`).join(' | ')};`,
        'export interface LoincLabRow { code: string; longCommonName: string; nameIt: string; synonyms: string[]; unit: string; status: LoincLabStatus }',
        '',
        `export const LOINC_LAB_VERSION = '${LOINC_LAB_TABLE_VERSION}';`,
        '',
        'export const LOINC_LAB_TABLE: readonly LoincLabRow[] = [',
        body,
        '];',
        '',
    ].join('\n');
}

export function readLoincLabTable(): LoincLabRow[] {
    return parseLoincLabTable(readFileSync(LOINC_LAB_TABLE_PATH, 'utf8'));
}

export function loincLabTableCode(rows: readonly LoincLabRow[], name: string, unit: string): string {
    const matches = rows.filter((row) => row.unit === unit
        && [row.nameIt, row.nameIt.replace(/\(.*\)/u, '').trim(), ...row.synonyms].includes(name));
    if (matches.length !== 1) throw new Error(`«${name}» in ${unit}: ${matches.length} righe nella tabella LOINC`);
    return matches[0].code;
}
