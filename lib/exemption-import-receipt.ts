/* @Codex */
import { createHash } from 'node:crypto';
import {
    EXEMPTION_EXCLUDED_COLUMNS, EXEMPTION_IMPORT_POLICY, EXEMPTION_IMPORT_SCHEMA,
    EXEMPTION_IMPORT_VERSION, EXEMPTION_MAX_BYTES, EXEMPTION_MAX_ROWS,
} from './exemption-import-contract.ts';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const isHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const integer = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function fail(): never { throw new Error('EXEMPTION_IMPORT_RECEIPT_INVALID'); }

/** Shared by JSON backup producers/consumer; validates historical facts, never current authority. */
export function assertExemptionImportReceiptRows(rows: unknown): void {
    if (!Array.isArray(rows)) fail();
    const ids = new Set<number>(), operations = new Set<string>();
    for (const row of rows) {
        if (!exact(row, ['id', 'operationKey', 'receiptJson']) || !integer(row.id, 1)
            || !isHash(row.operationKey) || typeof row.receiptJson !== 'string' || row.receiptJson.length > 16_384
            || ids.has(row.id) || operations.has(row.operationKey)) fail();
        ids.add(row.id); operations.add(row.operationKey);
        let receipt: unknown;
        try { receipt = JSON.parse(row.receiptJson); } catch { fail(); }
        if (!exact(receipt, ['operationKey', 'manifest', 'previousRevision', 'revision', 'applied', 'inserted', 'updated', 'committedAt'])
            || receipt.operationKey !== row.operationKey || !isHash(receipt.previousRevision) || !isHash(receipt.revision)
            || !integer(receipt.applied, 1, EXEMPTION_MAX_ROWS) || !integer(receipt.inserted, 0) || !integer(receipt.updated, 0)
            || receipt.inserted + receipt.updated !== receipt.applied || typeof receipt.committedAt !== 'string'
            || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(receipt.committedAt)
            || !Number.isFinite(Date.parse(receipt.committedAt)) || new Date(receipt.committedAt).toISOString() !== receipt.committedAt) fail();
        const m = receipt.manifest;
        if (!exact(m, ['sourceName', 'sourceSha256', 'byteLength', 'parserVersion', 'schemaVersion', 'policy', 'rowCount', 'validRows', 'errorCount', 'duplicateRows', 'excludedColumns'])
            || typeof m.sourceName !== 'string' || !m.sourceName || m.sourceName.length > 120
            || m.sourceName !== m.sourceName.trim() || /[\x00-\x1f\x7f/\\]/u.test(m.sourceName)
            || !isHash(m.sourceSha256) || !integer(m.byteLength, 1, EXEMPTION_MAX_BYTES)
            || m.parserVersion !== EXEMPTION_IMPORT_VERSION || m.schemaVersion !== EXEMPTION_IMPORT_SCHEMA
            || m.policy !== EXEMPTION_IMPORT_POLICY || m.rowCount !== receipt.applied || m.validRows !== receipt.applied
            || m.errorCount !== 0 || m.duplicateRows !== 0 || !Array.isArray(m.excludedColumns)
            || m.excludedColumns.length > EXEMPTION_EXCLUDED_COLUMNS.length) fail();
        let lastIndex = -1;
        for (const column of m.excludedColumns) {
            if (!exact(column, ['name', 'nonNullValues']) || typeof column.name !== 'string'
                || !integer(column.nonNullValues, 0, receipt.applied)) fail();
            const index = (EXEMPTION_EXCLUDED_COLUMNS as readonly string[]).indexOf(column.name);
            if (index <= lastIndex) fail();
            lastIndex = index;
        }
        // Reconstruct parser field order before checking the existing operation-key codec.
        const manifest = {
            sourceName: m.sourceName, sourceSha256: m.sourceSha256, byteLength: m.byteLength,
            parserVersion: m.parserVersion, schemaVersion: m.schemaVersion, policy: m.policy,
            rowCount: m.rowCount, validRows: m.validRows, errorCount: m.errorCount,
            duplicateRows: m.duplicateRows, excludedColumns: m.excludedColumns,
        };
        if (digest({ manifest, previousRevision: receipt.previousRevision }) !== row.operationKey) fail();
    }
}
