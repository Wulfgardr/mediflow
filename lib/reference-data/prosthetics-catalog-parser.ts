/* @Codex */
import { createHash } from 'node:crypto';
import {
    PROSTHETICS_COLUMNS, PROSTHETICS_CONTRACT, PROSTHETICS_MAX_BYTES, PROSTHETICS_MAX_ROWS,
    isProstheticsDate, isProstheticsText, prostheticsIdentity,
    type ProstheticsDiagnostic, type ProstheticsManifest, type ProstheticsRow,
} from './prosthetics-catalog-contract';

// Single-line CSV cells are deliberate: a physical row is always the reported row.
function parseLine(line: string): string[] | null {
    const cells: string[] = [];
    let cell = '', quoted = false, closed = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quoted) {
            if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; }
            else if (c === '"') { quoted = false; closed = true; }
            else cell += c;
        } else if (c === ',') { cells.push(cell); cell = ''; closed = false; }
        else if (c === '"' && cell === '' && !closed) quoted = true;
        else if (c === '"' || closed) return null;
        else cell += c;
        if (cell.length > 2000 || cells.length > PROSTHETICS_COLUMNS.length) return null;
    }
    if (quoted) return null;
    cells.push(cell);
    return cells;
}

export function parseProstheticsCsv(bytes: Uint8Array, sourceName: string) {
    const diagnostics: ProstheticsDiagnostic[] = [], rows: ProstheticsRow[] = [];
    const invalidRows = new Set<number>(), duplicateRows = new Set<number>();
    let errorCount = 0, assessedRows = 0;
    const error = (row: number, column: string, code: string, message: string) => {
        errorCount++; invalidRows.add(row);
        if (diagnostics.length < 200) diagnostics.push({ row, column, code, message });
    };
    const manifest: ProstheticsManifest = {
        contract: PROSTHETICS_CONTRACT, sourceName, sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.byteLength, metadata: null,
        counts: { total: 0, valid: 0, invalid: 0, duplicates: 0, errors: 0 },
    };
    const finish = () => {
        manifest.counts.invalid = [...invalidRows].filter(row => row > 1).length;
        manifest.counts.valid = Math.max(0, assessedRows - manifest.counts.invalid);
        manifest.counts.duplicates = duplicateRows.size;
        manifest.counts.errors = errorCount;
        return { valid: errorCount === 0, manifest, rows, diagnostics, diagnosticsTruncated: errorCount > diagnostics.length };
    };
    if (!isProstheticsText(sourceName) || /[/\\]/u.test(sourceName)) error(0, 'file', 'SOURCE_NAME', 'Nome file non valido (massimo 200 caratteri, senza percorso).');
    if (bytes.byteLength > PROSTHETICS_MAX_BYTES) { error(0, 'file', 'FILE_TOO_LARGE', 'Il limite è 2 MiB.'); return finish(); }
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { error(0, 'file', 'ENCODING', 'È richiesto UTF-8 valido.'); return finish(); }
    const lines = text.split(/\r?\n/u);
    if (lines.at(-1) === '') lines.pop();
    manifest.counts.total = Math.max(0, lines.length - 1);
    if (lines.length > PROSTHETICS_MAX_ROWS + 1) { error(0, 'file', 'ROW_LIMIT', 'Il limite è 20.000 righe dati.'); return finish(); }
    if (lines[0] !== PROSTHETICS_COLUMNS.join(',')) error(1, 'header', 'HEADER', `Header richiesto: ${PROSTHETICS_COLUMNS.join(',')}`);
    if (!manifest.counts.total) error(0, 'file', 'EMPTY', 'Il file non contiene righe dati.');
    const seen = new Map<string, number>();
    for (let index = 1; index < lines.length; index++) {
        assessedRows++;
        const rowNumber = index + 1;
        const cells = parseLine(lines[index]);
        if (!cells || cells.length !== PROSTHETICS_COLUMNS.length) { error(rowNumber, 'riga', 'CSV_STRUCTURE', 'Sono richiesti 8 campi CSV; controlla virgole, virgolette e limite di 2.000 caratteri.'); continue; }
        for (let i = 0; i < 6; i++) {
            if (!isProstheticsText(cells[i], i === 2 ? 2000 : 200)) error(rowNumber, PROSTHETICS_COLUMNS[i], 'FIELD', 'Campo obbligatorio, senza controlli o spazi esterni; massimo 200 caratteri (descrizione 2.000).');
        }
        for (let i = 6; i < 8; i++) {
            if (cells[i] !== '' && !isProstheticsDate(cells[i])) error(rowNumber, PROSTHETICS_COLUMNS[i], 'DATE', 'Usa una data calendario YYYY-MM-DD oppure lascia vuoto.');
        }
        if (cells[6] && cells[7] && cells[6] > cells[7]) error(rowNumber, 'data_fine', 'DATE_ORDER', 'La fine precede l’inizio.');
        const row: ProstheticsRow = { codeSystem: cells[0], code: cells[1], description: cells[2], version: cells[3], source: cells[4], scope: cells[5], startDate: cells[6] || null, endDate: cells[7] || null };
        const metadata = { codeSystem: row.codeSystem, version: row.version, source: row.source, scope: row.scope };
        if (!manifest.metadata) manifest.metadata = metadata;
        else if (JSON.stringify(manifest.metadata) !== JSON.stringify(metadata)) error(rowNumber, 'fonte/versione/ambito/codice_sistema', 'MIXED_METADATA', 'Ogni file deve dichiarare una sola codifica, versione, fonte e ambito.');
        const key = prostheticsIdentity(row), prior = seen.get(key);
        if (prior !== undefined) {
            duplicateRows.add(prior); duplicateRows.add(rowNumber);
            if (!invalidRows.has(prior)) error(prior, 'codice', 'DUPLICATE', `Voce duplicata alla riga ${rowNumber}.`);
            error(rowNumber, 'codice', 'DUPLICATE', `Voce già presente alla riga ${prior}; nessuna deduplicazione automatica.`);
        } else seen.set(key, rowNumber);
        rows.push(row);
    }
    return finish();
}
