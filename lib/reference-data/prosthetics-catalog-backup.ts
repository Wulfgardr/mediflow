import { normalizeProstheticsImportOptions } from './prosthetics-import-options.ts';
/* @Codex */
import { buildAttachmentPath } from '../attachment-path.ts';
import { createHash } from 'node:crypto';
import { PROSTHETICS_CONTRACT, PROSTHETICS_MAX_BYTES, PROSTHETICS_MAX_ROWS, isProstheticsText, isProstheticsDate, prostheticsIdentity } from './prosthetics-catalog-contract.ts';
import type { ProstheticsReceipt, ProstheticsEntry } from './prosthetics-catalog-contract.ts';
const SHA = /^[a-f0-9]{64}$/u;
const fail = (): never => { throw new Error('PROSTHETICS_CATALOG_BACKUP_INVALID'); };
function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
    return value as Record<string, unknown>;
}
function keys(value: unknown, names: string[]): Record<string, unknown> {
    const row = object(value);
    if (Object.keys(row).length !== names.length || names.some(key => !Object.hasOwn(row, key))) fail();
    return row;
}
const sha = (value: unknown) => typeof value === 'string' && SHA.test(value);
const count = (value: unknown, max: number) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
const timestamp = (value: unknown) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

/** Identical validation for web export, scheduled export and pre-mutation restore. */
export function assertProstheticsCatalogBackup(entries: unknown[], receipts: unknown[], sources: unknown[] = [], documents: unknown[] = []): void {
    if (!Array.isArray(entries) || !Array.isArray(receipts) || entries.length > 100_000 || receipts.length > 100_000) fail();
    const sourceImports = new Set<string>();
    const receiptIds = new Set<number>(), operations = new Map<string, ProstheticsReceipt>();
    for (const value of receipts) {
        const row = keys(value, ['id', 'operationKey', 'receiptJson']);
        if (!count(row.id, Number.MAX_SAFE_INTEGER) || row.id === 0 || receiptIds.has(row.id as number)
            || !sha(row.operationKey) || operations.has(row.operationKey as string) || typeof row.receiptJson !== 'string' || row.receiptJson.length > 8192) fail();
        let parsed: unknown;
        try { parsed = JSON.parse(row.receiptJson as string); } catch { fail(); }
        const receipt = keys(parsed, ['operationKey', 'manifest', 'previousRevision', 'revision', 'applied', 'changes', 'committedAt']);
        const manifest = keys(receipt.manifest, ['contract', 'sourceName', 'sha256', 'bytes', 'metadata', 'counts', ...(object(receipt.manifest).options ? ['options'] : [])]);
        const metadata = keys(manifest.metadata, ['codeSystem', 'version', 'source', 'scope']);
        const counts = keys(manifest.counts, ['total', 'valid', 'invalid', 'duplicates', 'errors']);
        const changes = keys(receipt.changes, ['inserted', 'updated', 'unchanged']);
        if (receipt.operationKey !== row.operationKey || !sha(receipt.previousRevision) || !sha(receipt.revision)
            || !timestamp(receipt.committedAt) || manifest.contract !== PROSTHETICS_CONTRACT || !sha(manifest.sha256)
            || !isProstheticsText(manifest.sourceName) || /[/\\]/u.test(manifest.sourceName)
            || !count(manifest.bytes, PROSTHETICS_MAX_BYTES) || manifest.bytes === 0
            || Object.values(metadata).some(value => !isProstheticsText(value))
            || !count(counts.total, PROSTHETICS_MAX_ROWS) || counts.total === 0 || counts.valid !== counts.total
            || counts.invalid !== 0 || counts.duplicates !== 0 || counts.errors !== 0
            || receipt.applied !== counts.total || Object.values(changes).some(value => !count(value, PROSTHETICS_MAX_ROWS))
            || Number(changes.inserted) + Number(changes.updated) + Number(changes.unchanged) !== counts.total) fail();
        const options = manifest.options === undefined ? undefined : normalizeProstheticsImportOptions(manifest.options);
        if (manifest.options !== undefined && !options) fail();
        const canonicalManifest = {
            contract: manifest.contract, sourceName: manifest.sourceName, sha256: manifest.sha256, bytes: manifest.bytes,
            metadata: { codeSystem: metadata.codeSystem, version: metadata.version, source: metadata.source, scope: metadata.scope },
            ...(options ? { options } : {}),
            counts: { total: counts.total, valid: counts.valid, invalid: counts.invalid, duplicates: counts.duplicates, errors: counts.errors },
        };
        if (createHash('sha256').update(JSON.stringify({ manifest: canonicalManifest, previousRevision: receipt.previousRevision })).digest('hex') !== row.operationKey) fail();
        sourceImports.add(JSON.stringify([manifest.sha256, metadata.source, metadata.version, metadata.scope]));
        operations.set(row.operationKey as string, parsed as ProstheticsReceipt); receiptIds.add(row.id as number);
    }
    if (!Array.isArray(sources) || sources.length > 100_000 || !Array.isArray(documents) || documents.length > 1000) fail();
    const sourceIds = new Set<string>();
    for (const value of sources) {
        const source = keys(value, ['id','name','authority','scope','version','date','sha256','notes']);
        if (!isProstheticsText(source.id, 1024) || sourceIds.has(source.id) || ['name','authority','scope','version'].some(k => !isProstheticsText(source[k]))
            || (source.date !== null && !isProstheticsDate(source.date)) || !sha(source.sha256) || typeof source.notes !== 'string'
            || source.notes.length > 2000 || /[\u0000-\u001f\u007f]/u.test(source.notes)) fail();
        if (!sourceImports.has(JSON.stringify([source.sha256, source.name, source.version, source.scope]))) fail();
        sourceIds.add(source.id as string);
    }
    const documentIds = new Set<string>();
    let totalSize = 0;
    for (const value of documents) {
        const doc = keys(value, ['id','sourceId','name','sha256','size','page','base64']);
        if (typeof doc.id !== 'string' || !/^[a-f0-9-]{36}$/u.test(doc.id) || documentIds.has(doc.id) || !sourceIds.has(String(doc.sourceId))
            || !isProstheticsText(doc.name, 300) || buildAttachmentPath(`attachments/${doc.name}`, doc.name, doc.id) !== `attachments/${doc.name}`
            || !sha(doc.sha256) || !count(doc.size, 25 * 1024 * 1024) || doc.size === 0 || typeof doc.base64 !== 'string'
            || doc.base64.length > Math.ceil(25 * 1024 * 1024 / 3) * 4 || (doc.page !== null && !isProstheticsText(doc.page, 100))) fail();
        const bytes = Buffer.from(doc.base64 as string, 'base64');
        if (bytes.toString('base64') !== doc.base64 || bytes.length !== doc.size || createHash('sha256').update(bytes).digest('hex') !== doc.sha256) fail();
        totalSize += bytes.length; if (totalSize > 100 * 1024 * 1024) fail();
        documentIds.add(doc.id as string);
    }
    const ids = new Set<string>();
    for (const value of entries) {
        const row = keys(value, ['id', 'codeSystem', 'code', 'description', 'version', 'source', 'scope', 'startDate', 'endDate', 'sourceSha256', 'operationKey', 'importedAt', ...(Object.hasOwn(object(value), 'sourceId') ? ['sourceId'] : [])]);
        if (!isProstheticsText(row.description, 2000) || ['codeSystem', 'code', 'version', 'source', 'scope'].some(key => !isProstheticsText(row[key]))
            || (row.startDate !== null && !isProstheticsDate(row.startDate)) || (row.endDate !== null && !isProstheticsDate(row.endDate))
            || (row.startDate && row.endDate && String(row.startDate) > String(row.endDate))
            || !sha(row.sourceSha256) || !sha(row.operationKey) || !timestamp(row.importedAt)) fail();
        const entry = row as ProstheticsEntry;
        if (entry.sourceId !== undefined && (!isProstheticsText(entry.sourceId, 1024) || !sourceIds.has(entry.sourceId))) fail();
        if (entry.id !== (entry.sourceId ? prostheticsIdentity(entry) : JSON.stringify([entry.codeSystem, entry.code, entry.scope])) || ids.has(entry.id)) fail();
        const receipt = operations.get(entry.operationKey);
        if (!receipt || entry.sourceSha256 !== receipt.manifest.sha256 || entry.importedAt !== receipt.committedAt
            || Object.entries(receipt.manifest.metadata!).some(([key, value]) => row[key] !== value)) fail();
        ids.add(entry.id);
    }
}
