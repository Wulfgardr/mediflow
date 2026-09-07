/* @Codex */
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
export function assertProstheticsCatalogBackup(entries: unknown[], receipts: unknown[]): void {
    if (!Array.isArray(entries) || !Array.isArray(receipts) || entries.length > 100_000 || receipts.length > 100_000) fail();
    const receiptIds = new Set<number>(), operations = new Map<string, ProstheticsReceipt>();
    for (const value of receipts) {
        const row = keys(value, ['id', 'operationKey', 'receiptJson']);
        if (!count(row.id, Number.MAX_SAFE_INTEGER) || row.id === 0 || receiptIds.has(row.id as number)
            || !sha(row.operationKey) || operations.has(row.operationKey as string) || typeof row.receiptJson !== 'string' || row.receiptJson.length > 8192) fail();
        let parsed: unknown;
        try { parsed = JSON.parse(row.receiptJson as string); } catch { fail(); }
        const receipt = keys(parsed, ['operationKey', 'manifest', 'previousRevision', 'revision', 'applied', 'changes', 'committedAt']);
        const manifest = keys(receipt.manifest, ['contract', 'sourceName', 'sha256', 'bytes', 'metadata', 'counts']);
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
        const canonicalManifest = {
            contract: manifest.contract, sourceName: manifest.sourceName, sha256: manifest.sha256, bytes: manifest.bytes,
            metadata: { codeSystem: metadata.codeSystem, version: metadata.version, source: metadata.source, scope: metadata.scope },
            counts: { total: counts.total, valid: counts.valid, invalid: counts.invalid, duplicates: counts.duplicates, errors: counts.errors },
        };
        if (createHash('sha256').update(JSON.stringify({ manifest: canonicalManifest, previousRevision: receipt.previousRevision })).digest('hex') !== row.operationKey) fail();
        operations.set(row.operationKey as string, parsed as ProstheticsReceipt); receiptIds.add(row.id as number);
    }
    const ids = new Set<string>();
    for (const value of entries) {
        const row = keys(value, ['id', 'codeSystem', 'code', 'description', 'version', 'source', 'scope', 'startDate', 'endDate', 'sourceSha256', 'operationKey', 'importedAt']);
        if (!isProstheticsText(row.description, 2000) || ['codeSystem', 'code', 'version', 'source', 'scope'].some(key => !isProstheticsText(row[key]))
            || (row.startDate !== null && !isProstheticsDate(row.startDate)) || (row.endDate !== null && !isProstheticsDate(row.endDate))
            || (row.startDate && row.endDate && String(row.startDate) > String(row.endDate))
            || !sha(row.sourceSha256) || !sha(row.operationKey) || !timestamp(row.importedAt)) fail();
        const entry = row as ProstheticsEntry;
        if (entry.id !== prostheticsIdentity(entry) || ids.has(entry.id)) fail();
        const receipt = operations.get(entry.operationKey);
        if (!receipt || entry.sourceSha256 !== receipt.manifest.sha256 || entry.importedAt !== receipt.committedAt
            || Object.entries(receipt.manifest.metadata!).some(([key, value]) => row[key] !== value)) fail();
        ids.add(entry.id);
    }
}
