/* @Codex: bounded, dependency-free CSV validation. No I/O or writes. */
export const PATIENT_CSV_HEADERS = [
    'nome', 'cognome', 'codice_fiscale', 'data_nascita', 'indirizzo', 'telefono',
] as const;
export type PatientCsvColumn = typeof PATIENT_CSV_HEADERS[number];
export const PATIENT_CSV_LIMITS = Object.freeze({
    fileBytes: 2 * 1024 * 1024,
    rows: 500,
    recordChars: 4096,
    cellChars: 1024,
    fieldChars: [100, 100, 64, 10, 500, 80] as readonly number[],
});
export const PATIENT_CSV_TEMPLATE = `\uFEFF${PATIENT_CSV_HEADERS.join(';')}\r\n`;

export type CsvPatientFields = Readonly<{
    firstName: string;
    lastName: string;
    taxCode: string;
    birthDate?: string;
    address?: string;
    phone?: string;
}>;
export type PatientCsvIssue = Readonly<{
    code: string;
    message: string;
    field?: PatientCsvColumn;
}>;
export type PatientCsvRow = Readonly<{
    /** One-based logical data record and physical starting line, respectively. */
    row: number;
    line: number;
    cells: readonly string[];
    values?: CsvPatientFields;
    issues: readonly PatientCsvIssue[];
    duplicateInFile: boolean;
    duplicateExisting: boolean;
}>;
export type PatientCsvPreview = Readonly<{ rows: readonly PatientCsvRow[] }>;
export type PatientCsvResult =
    | { ok: true; preview: PatientCsvPreview }
    | { ok: false; error: PatientCsvIssue & { line?: number } };
export type ExistingPatientIdentity = Readonly<{ id: string; taxCode: string }>;

/* ASCII validation MUST precede uppercasing: e.g. Unicode ß must not become SS. */
export function normalizePatientCsvTaxCode(value: string): string | null {
    const candidate = value.replace(/^ +| +$/gu, '');
    return /^[A-Za-z0-9]{16}$/u.test(candidate) ? candidate.toUpperCase() : null;
}

export function isPatientCsvDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    if (year === 0 || month < 1 || month > 12 || day < 1) return false;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/* All messages are fixed vocabulary; no input values appear in exceptions/logs. */
class CsvFailure extends Error {
    constructor(readonly code: string, message: string, readonly line?: number) {
        super(message);
    }
}

type RawRecord = { line: number; cells: string[] };
function scanCsv(text: string): RawRecord[] {
    const records: RawRecord[] = [];
    let cells: string[] = [];
    let field = '';
    let mode: 'start' | 'bare' | 'quoted' | 'closed' = 'start';
    let line = 1;
    let startLine = 1;
    let recordLength = 0;
    let touched = false;
    const fail = (code: string, message: string): never => { throw new CsvFailure(code, message, startLine); };
    const append = (value: string) => {
        if (field.length + value.length > PATIENT_CSV_LIMITS.cellChars) fail('cell-limit', 'Una cella supera il limite consentito.');
        field += value;
    };
    const endField = () => {
        if (cells.length === PATIENT_CSV_HEADERS.length) fail('columns', 'Troppe colonne: usa le sei colonne del modello.');
        cells.push(field);
        field = '';
        mode = 'start';
    };
    const endRecord = () => {
        // Ignore genuinely empty physical lines, not quoted empty values or ;;;;;.
        if (touched || cells.length > 0 || field.length > 0) {
            endField();
            if (records.length >= PATIENT_CSV_LIMITS.rows + 1) fail('row-limit', 'Il file supera 500 righe di dati.');
            records.push({ line: startLine, cells });
        }
        cells = [];
        field = '';
        mode = 'start';
        touched = false;
        recordLength = 0;
    };
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        // Only quoted/internal newlines belong to the source record. EOF, LF
        // and CRLF terminators must have identical structural limit semantics.
        if ((mode === 'quoted' || (char !== '\r' && char !== '\n'))
            && ++recordLength > PATIENT_CSV_LIMITS.recordChars) fail('record-limit', 'Una riga supera il limite consentito.');
        if (char === '\r' || char === '\n') {
            const crlf = char === '\r' && text[i + 1] === '\n';
            if (mode === 'quoted') {
                append(crlf ? '\r\n' : char);
                if (crlf && ++recordLength > PATIENT_CSV_LIMITS.recordChars) fail('record-limit', 'Una riga supera il limite consentito.');
            } else {
                endRecord();
            }
            if (crlf) i += 1;
            line += 1;
            if (mode !== 'quoted') startLine = line;
            continue;
        }
        touched = true;
        if (mode === 'quoted') {
            if (char === '"') mode = 'closed';
            else append(char);
        } else if (mode === 'closed') {
            if (char === '"') { append('"'); mode = 'quoted'; }
            else if (char === ';') endField();
            else fail('quote-trailing', 'Dopo una chiusura di virgolette è ammesso solo il separatore o fine riga.');
        } else if (char === ';') {
            endField();
        } else if (char === '"') {
            if (mode !== 'start') fail('quote-position', 'Virgolette in posizione non valida.');
            mode = 'quoted';
        } else {
            append(char);
            mode = 'bare';
        }
    }
    if (mode === 'quoted') fail('quote-unclosed', 'Un campo tra virgolette non è chiuso.');
    endRecord();
    return records;
}

function validateRecord(record: RawRecord, index: number): PatientCsvRow {
    const issues: PatientCsvIssue[] = [];
    const issue = (code: string, message: string, field?: PatientCsvColumn) => issues.push({ code, message, ...(field ? { field } : {}) });
    if (record.cells.length !== PATIENT_CSV_HEADERS.length) {
        issue('columns', 'Servono sei colonne; lascia vuote quelle opzionali.');
    }
    const [firstName = '', lastName = '', rawTaxCode = '', birthDate = '', address = '', phone = ''] = record.cells;
    record.cells.forEach((value, column) => {
        if (value.length > PATIENT_CSV_LIMITS.fieldChars[column]) {
            issue('field-limit', `Il campo supera ${PATIENT_CSV_LIMITS.fieldChars[column]} caratteri.`, PATIENT_CSV_HEADERS[column]);
        }
        // Address alone can contain quoted CR/LF. Tabs/control codes are not silently removed.
        let invalidControl = false;
        for (let offset = 0; offset < value.length; offset += 1) {
            const code = value.charCodeAt(offset);
            const addressNewline = column === 4 && (code === 10 || code === 13);
            if (!addressNewline && (code < 32 || (code >= 127 && code <= 159))) { invalidControl = true; break; }
        }
        if (invalidControl) issue('control-character', 'Il campo contiene caratteri di controllo non ammessi.', PATIENT_CSV_HEADERS[column]);
    });
    if (firstName.length < 2 || firstName.trim().length < 2) issue('name', 'Il nome deve contenere almeno due caratteri.', 'nome');
    if (lastName.length < 2 || lastName.trim().length < 2) issue('name', 'Il cognome deve contenere almeno due caratteri.', 'cognome');
    const taxCode = normalizePatientCsvTaxCode(rawTaxCode);
    if (!taxCode) issue('tax-code', 'Il codice fiscale deve contenere 16 caratteri alfanumerici ASCII.', 'codice_fiscale');
    if (birthDate && !isPatientCsvDate(birthDate)) issue('date', 'Usa una data reale nel formato YYYY-MM-DD.', 'data_nascita');
    return {
        row: index + 1, line: record.line, cells: record.cells, issues,
        duplicateInFile: false, duplicateExisting: false,
        ...(issues.length === 0 && taxCode ? { values: {
            firstName, lastName, taxCode,
            ...(birthDate ? { birthDate } : {}),
            ...(address ? { address } : {}),
            ...(phone ? { phone } : {}),
        } } : {}),
    };
}

export function parsePatientCsv(bytes: Uint8Array): PatientCsvResult {
    if (bytes.byteLength > PATIENT_CSV_LIMITS.fileBytes) {
        return { ok: false, error: { code: 'file-limit', message: 'Il file supera 2 MiB.' } };
    }
    let text: string;
    try {
        // Decoder strips only the initial UTF-8 BOM and rejects malformed sequences.
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        return { ok: false, error: { code: 'utf8', message: 'Il file non è un CSV UTF-8 valido.' } };
    }
    try {
        const records = scanCsv(text);
        const header = records.shift();
        if (!header || header.line !== 1) throw new CsvFailure('header', 'La prima riga deve essere l’intestazione del modello.', 1);
        if (new Set(header.cells).size !== header.cells.length) throw new CsvFailure('header-duplicate', 'Intestazione con colonne duplicate.', 1);
        if (header.cells.some(cell => !(PATIENT_CSV_HEADERS as readonly string[]).includes(cell))) {
            throw new CsvFailure('header-unknown', 'Intestazione non riconosciuta: usa il modello e il separatore punto e virgola.', 1);
        }
        if (header.cells.length !== PATIENT_CSV_HEADERS.length || header.cells.some((cell, i) => cell !== PATIENT_CSV_HEADERS[i])) {
            throw new CsvFailure('header-order', 'Usa tutte le sei colonne del modello, nello stesso ordine.', 1);
        }
        const rows = records.map(validateRecord);
        const counts = new Map<string, number>();
        for (const row of rows) {
            const code = normalizePatientCsvTaxCode(row.cells[2] ?? '');
            if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
        }
        return { ok: true, preview: { rows: rows.map(row => ({ ...row,
            duplicateInFile: (counts.get(normalizePatientCsvTaxCode(row.cells[2] ?? '') ?? '') ?? 0) > 1,
        })) } };
    } catch (error) {
        if (error instanceof CsvFailure) return { ok: false, error: { code: error.code, message: error.message, line: error.line } };
        throw error;
    }
}

export function markExistingPatientDuplicates(preview: PatientCsvPreview, existing: readonly ExistingPatientIdentity[]): PatientCsvPreview {
    const codes = new Set(existing.map(patient => normalizePatientCsvTaxCode(patient.taxCode)).filter((code): code is string => code !== null));
    return { rows: preview.rows.map(row => ({ ...row,
        duplicateExisting: codes.has(normalizePatientCsvTaxCode(row.cells[2] ?? '') ?? ''),
    })) };
}

export function isPatientCsvRowEligible(row: PatientCsvRow): boolean {
    return row.values !== undefined && row.issues.length === 0 && !row.duplicateInFile && !row.duplicateExisting;
}
