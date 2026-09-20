/* @Codex */
import { createHash } from 'node:crypto';
import {
    EXEMPTION_COLUMNS, EXEMPTION_EXCLUDED_COLUMNS, EXEMPTION_IMPORT_POLICY,
    EXEMPTION_IMPORT_SCHEMA, EXEMPTION_IMPORT_VERSION, EXEMPTION_MAX_BYTES, EXEMPTION_MAX_ROWS,
    type ExemptionImportDiagnostic, type ExemptionImportManifest, type ExemptionImportRow,
} from './exemption-import-contract';

export function parseExemptionImport(bytes: Uint8Array, sourceName: string) {
    const diagnostics: ExemptionImportDiagnostic[] = [];
    const rows: ExemptionImportRow[] = [];
    const manifest: ExemptionImportManifest = {
        sourceName, sourceSha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.byteLength,
        parserVersion: EXEMPTION_IMPORT_VERSION, schemaVersion: EXEMPTION_IMPORT_SCHEMA,
        policy: EXEMPTION_IMPORT_POLICY, rowCount: 0, validRows: 0, errorCount: 0,
        duplicateRows: 0, excludedColumns: [],
    };
    function error(line: number, column: string, message: string) {
        manifest.errorCount++;
        if (diagnostics.length < 100) diagnostics.push({ line, column, message });
    }
    const result = () => ({ manifest, rows, diagnostics, valid: manifest.errorCount === 0 });
    if (typeof sourceName !== 'string' || !sourceName || sourceName.length > 120
        || sourceName !== sourceName.trim() || /[\x00-\x1f\x7f/\\]/u.test(sourceName)) {
        error(0, 'file', 'Nome file non valido (massimo 120 caratteri, senza percorsi).');
    }
    if (!bytes.byteLength || bytes.byteLength > EXEMPTION_MAX_BYTES) {
        error(0, 'file', 'File vuoto o superiore a 2 MiB.');
        return result();
    }
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { error(0, 'encoding', 'Encoding non UTF-8: nessuna conversione automatica.'); return result(); }
    if (/[\r\n]/u.test(text.replaceAll('\r\n', ''))) {
        error(0, 'file', 'Sono richiesti terminatori CRLF.');
        return result();
    }
    const lines = text.split('\r\n');
    if (lines.at(-1) === '') lines.pop();
    if (lines.length < 2 || lines.length > EXEMPTION_MAX_ROWS + 1) {
        error(0, 'file', 'Sono richieste da 1 a 20.000 righe dati.');
        return result();
    }
    const trailing = lines[0].endsWith('|');
    const split = (line: string) => {
        const cells = line.split('|');
        if (trailing && cells.at(-1) === '') cells.pop();
        return cells;
    };
    const header = split(lines[0]);
    const allowed = new Set<string>([...EXEMPTION_COLUMNS, ...EXEMPTION_EXCLUDED_COLUMNS]);
    if (header.length > allowed.size || new Set(header).size !== header.length || header.some((h) => !allowed.has(h))) {
        error(1, 'header', 'Intestazioni duplicate, sconosciute o non esatte.');
    }
    for (const column of EXEMPTION_COLUMNS) {
        if (!header.includes(column)) error(1, column, 'Intestazione obbligatoria assente.');
    }
    if (manifest.errorCount) return result();
    manifest.excludedColumns = EXEMPTION_EXCLUDED_COLUMNS.filter((name) => header.includes(name))
        .map((name) => ({ name, nonNullValues: 0 }));
    const codes = new Set<string>();
    for (let i = 1; i < lines.length; i++) {
        const line = i + 1;
        manifest.rowCount++;
        const before = manifest.errorCount;
        const cells = split(lines[i]);
        if (cells.length !== header.length || lines[i].endsWith('|') !== trailing) {
            error(line, 'row', 'Numero di campi o delimitatore finale incoerente.');
            continue;
        }
        for (let c = 0; c < cells.length; c++) {
            if (!cells[c] || cells[c] !== cells[c].trim() || cells[c].length > 2000 || /[\x00-\x1f\x7f\uFFFD\uFEFF]/u.test(cells[c])) {
                error(line, header[c], 'Cella vuota, spazi esterni, caratteri non ammessi o lunghezza oltre 2.000; usare \\N per null.');
            }
        }
        const value = (name: string) => {
            const cell = cells[header.indexOf(name)];
            return cell === '\\N' ? null : cell;
        };
        const code = value('CD_ESENZIONE');
        const description = value('DS_ESENZIONE');
        if (!code || !/^[A-Z0-9][A-Z0-9._-]{0,31}$/u.test(code)) error(line, 'CD_ESENZIONE', 'Codice obbligatorio: 1–32 caratteri ASCII maiuscoli, cifre, punto, trattino o underscore.');
        if (!description) error(line, 'DS_ESENZIONE', 'Descrizione obbligatoria.');
        if (code && codes.has(code)) {
            manifest.duplicateRows++;
            error(line, 'CD_ESENZIONE', 'Codice duplicato: l’intero import è bloccato, anche se le righe sono identiche.');
        }
        if (code) codes.add(code);
        const date = (name: string): number | null => {
            const raw = value(name);
            if (raw === null) return null;
            const y = Number(raw.slice(0, 4)), m = Number(raw.slice(4, 6)), d = Number(raw.slice(6, 8));
            const parsed = new Date(Date.UTC(y, m - 1, d));
            if (!/^\d{8}$/u.test(raw) || y < 100 || parsed.getUTCFullYear() !== y
                || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) {
                error(line, name, 'Data non valida: richiesto YYYYMMDD con giorno e mese reali.');
                return null;
            }
            return parsed.getTime() / 1000;
        };
        const flag = (name: string): boolean | null => {
            const raw = value(name);
            if (raw === null) return null;
            if (raw === 'S') return true;
            if (raw === 'N') return false;
            error(line, name, 'Flag non valido: sono ammessi solo S, N o \\N.');
            return null;
        };
        const startDate = date('DT_INIZIO_VALIDITA'), endDate = date('DT_FINE_VALIDITA');
        if (startDate !== null && endDate !== null && startDate > endDate) error(line, 'DT_FINE_VALIDITA', 'Fine validità precedente all’inizio.');
        const row: ExemptionImportRow = {
            line, code: code ?? '', description: description ?? '', type: value('CD_TIPO_ESENZIONE'),
            startDate, endDate, isPharma: flag('FL_AMBITO_FARMACEUTICO'),
            isSpecialist: flag('FL_AMBITO_SPECIALISTICO'), isNational: flag('FL_NAZIONALE'),
        };
        for (const excluded of manifest.excludedColumns) if (value(excluded.name) !== null) excluded.nonNullValues++;
        if (manifest.errorCount === before) { rows.push(row); manifest.validRows++; }
    }
    return result();
}
