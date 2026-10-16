import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { Unzip, UnzipInflate } from 'fflate';
import { isWhoEmbeddedTitle } from './icd11-embedded-contract';
import { isWhoCanonicalMmsUri } from './icd11-who-local-contract';

export const WHO_CATALOG_URL = 'https://icdcdn.who.int/static/releasefiles/2026-01/SimpleTabulation-ICD-11-MMS-en.zip';
export const WHO_CATALOG_MAX_BYTES = 16 * 1024 * 1024;
export const WHO_TABULATION_MAX_BYTES = 64 * 1024 * 1024;
export const WHO_TABULATION_MAX_ROWS = 200_000;
export class WhoCatalogError extends Error {
    constructor(message: string, readonly status = 422) { super(message); this.name = 'WhoCatalogError'; }
}
export type WhoCatalogEntry = Readonly<{ code: string; uri: string; originalUri: string; title: string; chapter: string; leaf: boolean; residual: boolean }>;
export type WhoCatalogManifest = Readonly<{
    schemaVersion: 'mediflow.icd11-catalog-manifest.v1'; sourceUrl: typeof WHO_CATALOG_URL;
    releaseId: '2026-01'; language: 'en'; license: 'CC BY-ND 3.0 IGO'; attribution: 'World Health Organization (WHO)';
    sha256: string; bytes: number; rows: number; categories: number; withoutCode: number; blocks: number; chapters: number;
    versionDate: string | null; tabulationFile: string | null; ignoredFiles: readonly string[];
}>;
export type ParsedWhoCatalog = Readonly<{ entries: readonly WhoCatalogEntry[]; manifest: WhoCatalogManifest }>;
const required = ['Foundation URI', 'Linearization (release) URI', 'Code', 'BlockId', 'Title', 'ClassKind',
    'DepthInKind', 'IsResidual', 'ChapterNo', 'BrowserLink', 'isLeaf', 'Primary tabulation',
    'Grouping1', 'Grouping2', 'Grouping3', 'Grouping4', 'Grouping5'];
const fail = (message: string): never => { throw new WhoCatalogError(message); };
export const whoSha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export const normalizeWhoText = (text: string): string => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function tabulationBytes(original: Uint8Array): { bytes: Uint8Array; filename: string | null; ignoredFiles: readonly string[] } {
    if (!original.length || original.length > WHO_CATALOG_MAX_BYTES) throw new WhoCatalogError('Dimensione del file WHO non ammessa', 413);
    if (original[0] !== 0x50 || original[1] !== 0x4b) return { bytes: original, filename: null, ignoredFiles: [] };
    try {
        const data = Buffer.from(original.buffer, original.byteOffset, original.byteLength);
        let end = data.length - 22;
        for (; end >= Math.max(0, data.length - 65557); end--) if (data.readUInt32LE(end) === 0x06054b50) break;
        if (end < 0 || data.readUInt32LE(end) !== 0x06054b50 || end + 22 + data.readUInt16LE(end + 20) !== data.length
            || data.readUInt16LE(end + 4) !== 0 || data.readUInt16LE(end + 6) !== 0) throw new Error('end');
        const count = data.readUInt16LE(end + 10), start = data.readUInt32LE(end + 16), size = data.readUInt32LE(end + 12);
        if (!count || count > 32 || data.readUInt16LE(end + 8) !== count || start + size !== end) throw new Error('directory');
        const files = new Map<string, { crc: number; size: number }>();
        let offset = start, total = 0;
        for (let index = 0; index < count; index++) {
            if (data.readUInt32LE(offset) !== 0x02014b50) throw new Error('entry');
            const flags = data.readUInt16LE(offset + 8), method = data.readUInt16LE(offset + 10);
            const expanded = data.readUInt32LE(offset + 24), compressed = data.readUInt32LE(offset + 20);
            const length = data.readUInt16LE(offset + 28), extra = data.readUInt16LE(offset + 30), comment = data.readUInt16LE(offset + 32);
            const name = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(offset + 46, offset + 46 + length));
            total += expanded;
            if (flags & 1 || ![0, 8].includes(method) || !name || /(^\/|\\|(?:^|\/)\.\.(?:\/|$))/u.test(name)
                || files.has(name) || total > WHO_TABULATION_MAX_BYTES || compressed > WHO_CATALOG_MAX_BYTES
                || data.readUInt32LE(offset + 42) + 30 + compressed > start) throw new Error('limits');
            files.set(name, { crc: data.readUInt32LE(offset + 16), size: expanded });
            offset += 46 + length + extra + comment;
        }
        if (offset !== end) throw new Error('directory length');
        const candidates = [...files.keys()].filter(name => /^SimpleTabulation-ICD-11-MMS-[a-z]{2}\.txt$/u.test(name));
        if (candidates.length !== 1) return fail('Formato WHO non riconosciuto: serve un solo SimpleTabulation-ICD-11-MMS-<lingua>.txt; XLSX non supportato');
        const selected = candidates[0];
        if (selected !== 'SimpleTabulation-ICD-11-MMS-en.txt') return fail('Lingua WHO non supportata: richiesto inglese');
        const metadata = files.get(selected)!;
        const chunks: Uint8Array[] = [];
        let found = false, complete = false, produced = 0, checksum = 0;
        const unzip = new Unzip(file => {
            if (file.name !== selected) return;
            if (found) throw new Error('duplicate tabulation');
            found = true;
            file.ondata = (error, chunk, final) => {
                if (error) throw error;
                produced += chunk.length;
                if (produced > WHO_TABULATION_MAX_BYTES || produced > metadata.size) throw new Error('limits');
                checksum = crc32(chunk, checksum);
                chunks.push(chunk);
                complete = final;
            };
            file.start();
        });
        unzip.register(UnzipInflate);
        // Bound each synchronous inflate step, including when ZIP sizes are forged.
        const inputChunkBytes = 1024;
        for (let offset = 0; offset < original.length; offset += inputChunkBytes) {
            const end = Math.min(offset + inputChunkBytes, original.length);
            unzip.push(original.subarray(offset, end), end === original.length);
        }
        if (!complete || produced !== metadata.size || checksum !== metadata.crc) throw new Error('checksum');
        const bytes = Buffer.concat(chunks, produced);
        return { bytes, filename: selected, ignoredFiles: [...files.keys()].filter(name => name !== selected).sort() };
    } catch (error) {
        if (error instanceof WhoCatalogError) throw error;
        return fail('Archivio ZIP WHO corrotto, troncato o oltre i limiti');
    }
}
function flag(value: string): boolean {
    if (['true', '1', 'yes'].includes(value.toLowerCase())) return true;
    if (['false', '0', 'no'].includes(value.toLowerCase())) return false;
    return fail('Indicatore foglia o residuale WHO non riconosciuto');
}
function tabularRecords(text: string, official: boolean): string[][] {
    const records: string[][] = [];
    let row: string[] = [], cell = '', quoted = false, closed = false;
    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (quoted) {
            if (char === '"') {
                if (text[index + 1] === '"') { cell += '"'; index++; }
                else { quoted = false; closed = true; }
            } else cell += char;
            continue;
        }
        if (char === '"' && !cell && !closed) { quoted = true; continue; }
        const crlf = char === '\r' && text[index + 1] === '\n';
        // The 2026-01 export also has bare LF in unquoted CodingNote fields.
        if (official && records.length && row.length === 17 && char === '\n' && !closed) { cell += char; continue; }
        if (char === '\t' || char === '\n' || crlf) {
            row.push(cell); cell = ''; closed = false;
            if (char !== '\t') {
                records.push(row); row = [];
                if (records.length > WHO_TABULATION_MAX_ROWS + 1) throw new WhoCatalogError('Numero di righe WHO non ammesso', 413);
            }
            if (crlf) index++;
        } else {
            if (closed || char === '\r' || char === '"') return fail('Campo WHO quotato o delimitatore non valido');
            cell += char;
        }
    }
    if (quoted || row.length || cell || closed) return fail('File WHO troncato o campo quotato incompleto');
    return records;
}

export function parseWhoTabulation(original: Uint8Array, expected?: unknown): ParsedWhoCatalog {
    const { bytes, filename, ignoredFiles } = tabulationBytes(original);
    if (bytes.length > WHO_TABULATION_MAX_BYTES) throw new WhoCatalogError('Tabulazione WHO oltre il limite', 413);
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/u, ''); }
    catch { return fail('Formato WHO non riconosciuto: richiesto tab-separated UTF-8'); }
    if (!text.endsWith('\n') || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) return fail('File WHO troncato o non riconosciuto');
    const official = text.slice(0, text.indexOf('\n')).includes('\tLinearization URI\t');
    const records = tabularRecords(text, official), headers = records.shift()!.map(value => value.trim());
    const uriColumn = official ? 'Linearization URI' : 'Linearization (release) URI';
    const expectedHeaders = official ? [...required.map(name => name === 'Linearization (release) URI' ? uriColumn : name), 'CodingNote', 'Parent'] : required;
    const version = headers.at(-1) ?? '';
    const date = /^Version:2026 Jan (\d{2}) - (\d{2}):(\d{2}) UTC$/u.exec(version);
    const versionDate = date ? `2026-01-${date[1]}T${date[2]}:${date[3]}:00.000Z` : null;
    if (headers.length !== expectedHeaders.length + 1 || expectedHeaders.some((name, index) => headers[index] !== name)
        || (official ? !versionDate : version !== 'Version: 2026-01')) return fail('Intestazioni SimpleTabulation WHO non riconosciute o release diversa');
    if (versionDate && (Number.isNaN(Date.parse(versionDate)) || new Date(versionDate).toISOString() !== versionDate)) return fail('Data di versione WHO non valida');
    if (!records.length) throw new WhoCatalogError('Numero di righe WHO non ammesso', 413);
    const entries: WhoCatalogEntry[] = [], codes = new Set<string>(), uris = new Set<string>();
    let withoutCode = 0, blocks = 0, chapters = 0;
    for (const cells of records) {
        // Version is header metadata, not a twentieth data column in the official export.
        if (cells.length !== headers.length - (official ? 1 : 0)) return fail('File WHO troncato o numero di colonne incoerente');
        const get = (name: string) => cells[headers.indexOf(name)].trim();
        const code = get('Code'), kind = get('ClassKind').toLowerCase();
        if (!code) {
            if (kind === 'block') blocks++;
            else if (kind === 'chapter') chapters++;
            else return fail('Riga WHO senza codice o tipo riconosciuto');
            withoutCode++; continue;
        }
        const originalUri = get(uriColumn);
        const uri = originalUri.replace(/^http:\/\/id\.who\.int\/icd\/release\/11\/mms\//u, 'http:' + '//id.who.int/icd/release/11/2026-01/mms/');
        const title = get('Title').replace(/^(?:- )+/u, ''), chapter = get('ChapterNo');
        if (!/^[A-Z0-9][A-Z0-9.-]{0,31}$/u.test(code) || !isWhoCanonicalMmsUri(uri, code)
            || !isWhoEmbeddedTitle(title)
            || !chapter || chapter.length > 16 || kind !== 'category'
            || codes.has(code) || uris.has(uri)) return fail('Categoria WHO invalida o duplicata');
        codes.add(code); uris.add(uri);
        entries.push(Object.freeze({ code, uri, originalUri, title, chapter, leaf: flag(get('isLeaf')), residual: flag(get('IsResidual')) }));
    }
    if (!entries.length) return fail('Nessuna categoria con codice nel file WHO');
    const manifest: WhoCatalogManifest = Object.freeze({ schemaVersion: 'mediflow.icd11-catalog-manifest.v1', sourceUrl: WHO_CATALOG_URL,
        releaseId: '2026-01', language: 'en', license: 'CC BY-ND 3.0 IGO', attribution: 'World Health Organization (WHO)',
        sha256: whoSha256(original), bytes: original.length, rows: records.length, categories: entries.length, withoutCode,
        blocks, chapters, versionDate, tabulationFile: filename, ignoredFiles: Object.freeze(ignoredFiles) });
    if (expected !== undefined && !sameManifest(expected, manifest)) return fail('Manifest WHO non corrispondente ad archivio, licenza o conteggi');
    return Object.freeze({ entries: Object.freeze(entries), manifest });
}
function sameManifest(value: unknown, expected: WhoCatalogManifest): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>, keys = Object.keys(expected);
    return Object.keys(record).length === keys.length && keys.every(key => JSON.stringify(record[key]) === JSON.stringify(expected[key as keyof WhoCatalogManifest]));
}
