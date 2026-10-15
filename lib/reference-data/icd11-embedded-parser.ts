import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { unzipSync } from 'fflate';
import { isWhoCanonicalMmsUri } from './icd11-who-local-contract';

export const WHO_CATALOG_URL = 'https://icdcdn.who.int/static/releasefiles/2026-01/SimpleTabulation-ICD-11-MMS-en.zip';
export const WHO_CATALOG_MAX_BYTES = 16 * 1024 * 1024;
export const WHO_TABULATION_MAX_BYTES = 64 * 1024 * 1024;
export const WHO_TABULATION_MAX_ROWS = 200_000;
export class WhoCatalogError extends Error {
    constructor(message: string, readonly status = 422) { super(message); this.name = 'WhoCatalogError'; }
}
export type WhoCatalogEntry = Readonly<{ code: string; uri: string; title: string; chapter: string; leaf: boolean; residual: boolean }>;
export type WhoCatalogManifest = Readonly<{
    schemaVersion: 'mediflow.icd11-catalog-manifest.v1'; sourceUrl: typeof WHO_CATALOG_URL;
    releaseId: '2026-01'; language: 'en'; license: 'CC BY-ND 3.0 IGO'; attribution: 'World Health Organization (WHO)';
    sha256: string; bytes: number; rows: number; categories: number; withoutCode: number;
}>;
export type ParsedWhoCatalog = Readonly<{ entries: readonly WhoCatalogEntry[]; manifest: WhoCatalogManifest }>;
const required = ['Foundation URI', 'Linearization (release) URI', 'Code', 'BlockId', 'Title', 'ClassKind',
    'DepthInKind', 'IsResidual', 'ChapterNo', 'BrowserLink', 'isLeaf', 'Primary tabulation',
    'Grouping1', 'Grouping2', 'Grouping3', 'Grouping4', 'Grouping5'];
const fail = (message: string): never => { throw new WhoCatalogError(message); };
export const whoSha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export const normalizeWhoText = (text: string): string => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function tabulationBytes(original: Uint8Array): Uint8Array {
    if (!original.length || original.length > WHO_CATALOG_MAX_BYTES) throw new WhoCatalogError('Dimensione del file WHO non ammessa', 413);
    if (original[0] !== 0x50 || original[1] !== 0x4b) return original;
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
        const candidates = [...files.keys()].filter(name => /\.(?:txt|tsv)$/iu.test(name));
        if (candidates.length !== 1) return fail('Formato WHO non riconosciuto: serve un solo file tab-separated UTF-8; XLSX non supportato');
        const selected = candidates[0];
        const unzipped = unzipSync(original, { filter: file => file.name === selected && file.originalSize <= WHO_TABULATION_MAX_BYTES });
        const bytes = unzipped[selected], metadata = files.get(selected)!;
        if (!bytes || bytes.length !== metadata.size || crc32(bytes) !== metadata.crc) throw new Error('checksum');
        return bytes;
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
export function parseWhoTabulation(original: Uint8Array, expected?: unknown): ParsedWhoCatalog {
    const bytes = tabulationBytes(original);
    if (bytes.length > WHO_TABULATION_MAX_BYTES) throw new WhoCatalogError('Tabulazione WHO oltre il limite', 413);
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/u, ''); }
    catch { return fail('Formato WHO non riconosciuto: richiesto tab-separated UTF-8'); }
    if (!text.endsWith('\n') || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) return fail('File WHO troncato o non riconosciuto');
    const lines = text.replace(/\r\n/gu, '\n').split('\n');
    lines.pop();
    const headers = lines.shift()!.split('\t').map(value => value.trim());
    if (new Set(headers).size !== headers.length || required.some(name => !headers.includes(name))
        || headers.filter(name => /^Version:\s*2026-01$/u.test(name)).length !== 1
        || headers.some(name => !required.includes(name) && !/^Version:\s*2026-01$/u.test(name))) return fail('Intestazioni SimpleTabulation WHO non riconosciute o release diversa');
    if (!lines.length || lines.length > WHO_TABULATION_MAX_ROWS) throw new WhoCatalogError('Numero di righe WHO non ammesso', 413);
    const entries: WhoCatalogEntry[] = [], codes = new Set<string>(), uris = new Set<string>();
    let withoutCode = 0;
    for (const line of lines) {
        const cells = line.split('\t');
        if (cells.length !== headers.length) return fail('File WHO troncato o numero di colonne incoerente');
        const get = (name: string) => cells[headers.indexOf(name)].trim();
        const code = get('Code');
        if (!code) { withoutCode++; continue; }
        const uri = get('Linearization (release) URI'), title = get('Title'), chapter = get('ChapterNo');
        if (!/^[A-Z0-9][A-Z0-9.-]{0,31}$/u.test(code) || !isWhoCanonicalMmsUri(uri, code)
            || !title || title.length > 4096 || /[<>\u202a-\u202e\u2066-\u2069]/u.test(title)
            || !chapter || chapter.length > 16 || get('ClassKind').toLowerCase() !== 'category'
            || codes.has(code) || uris.has(uri)) return fail('Categoria WHO invalida o duplicata');
        codes.add(code); uris.add(uri);
        entries.push(Object.freeze({ code, uri, title, chapter, leaf: flag(get('isLeaf')), residual: flag(get('IsResidual')) }));
    }
    if (!entries.length) return fail('Nessuna categoria con codice nel file WHO');
    const manifest: WhoCatalogManifest = Object.freeze({ schemaVersion: 'mediflow.icd11-catalog-manifest.v1', sourceUrl: WHO_CATALOG_URL,
        releaseId: '2026-01', language: 'en', license: 'CC BY-ND 3.0 IGO', attribution: 'World Health Organization (WHO)',
        sha256: whoSha256(original), bytes: original.length, rows: lines.length, categories: entries.length, withoutCode });
    if (expected !== undefined && !sameManifest(expected, manifest)) return fail('Manifest WHO non corrispondente ad archivio, licenza o conteggi');
    return Object.freeze({ entries: Object.freeze(entries), manifest });
}
function sameManifest(value: unknown, expected: WhoCatalogManifest): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>, keys = Object.keys(expected);
    return Object.keys(record).length === keys.length && keys.every(key => record[key] === expected[key as keyof WhoCatalogManifest]);
}
