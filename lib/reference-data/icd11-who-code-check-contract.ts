/* @Codex */
import { parseWhoLocalReference, whoExactRecord, type WhoLocalReference } from './icd11-who-local-contract';

const MMS_PREFIX = 'http://id.who.int/icd/release/11/2026-01/mms/';
export const WHO_CODE_CHECK_SCHEMA = 'mediflow.reference-data.icd11-code-check.v1' as const;
export type WhoCodeCheckReceipt = Readonly<WhoLocalReference & {
    schemaVersion: 'mediflow.reference-data.icd11-code-check-receipt.v1';
    operation: 'mediflow.reference_data.icd11.code_check.v1';
    source: 'live'; found: boolean; checkedAt: string; latencyMs: number;
}>;
export type WhoCheckedCode = Readonly<{ canonicalUri: string; stemUri: string; stemCode: string; stemTitle: string }>;
export type WhoCodeCheckResult = Readonly<{
    schemaVersion: typeof WHO_CODE_CHECK_SCHEMA; code: string;
    status: 'found' | 'not_found'; entry: WhoCheckedCode | null; receipt: WhoCodeCheckReceipt;
}>;

export function isWhoCheckCode(value: unknown): value is string {
    return typeof value === 'string' && value.length <= 32 && value !== 'N/A'
        && /^[A-Z0-9][A-Z0-9.-]*(?:[&/][A-Z0-9][A-Z0-9.-]*)*$/u.test(value);
}
export function isWhoCheckStemUri(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith(MMS_PREFIX)
        && /^[1-9][0-9]{0,19}(?:\/(?:other|unspecified))?$/u.test(value.slice(MMS_PREFIX.length));
}
export function whoCodeInfoReference(code: string): string {
    if (!isWhoCheckCode(code)) throw new Error('Invalid WHO code');
    return `${MMS_PREFIX}codeinfo/${encodeURIComponent(code)}`;
}
export function parseWhoCodeInfo(value: unknown, requestedCode: string): Omit<WhoCheckedCode, 'stemTitle'> | null {
    if (!isWhoCheckCode(requestedCode) || !value || typeof value !== 'object' || Array.isArray(value)) return null;
    const raw = value as Record<string, unknown>;
    const stemCode = requestedCode.split(/[&/]/u)[0];
    if (raw.code !== requestedCode || raw['@id'] !== whoCodeInfoReference(requestedCode)
        || !isWhoCheckStemUri(raw.stemId)
        || (/[&/]/u.test(requestedCode) ? raw.stemCode !== stemCode : raw.stemCode !== undefined && raw.stemCode !== stemCode)) return null;
    return Object.freeze({ canonicalUri: raw['@id'] as string, stemUri: raw.stemId, stemCode });
}
export function parseWhoStemTitle(value: unknown, expected: Omit<WhoCheckedCode, 'stemTitle'>): string | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const raw = value as Record<string, unknown>;
    if (raw['@id'] !== expected.stemUri || raw.code !== expected.stemCode) return null;
    const title = whoExactRecord(raw.title, ['@language', '@value']);
    if (!title || title['@language'] !== 'en' || typeof title['@value'] !== 'string') return null;
    const text = title['@value'];
    return text.length > 0 && text.length <= 4096 && text === text.trim().replace(/\s+/gu, ' ')
        && !/[\u0000-\u001f\u007f<>\u061c\u200e\u200f\ud800-\udfff\u202a-\u202e\u2066-\u2069]/u.test(text) ? text : null;
}
export function parseWhoCodeCheckReceipt(value: unknown): WhoCodeCheckReceipt | null {
    const r = whoExactRecord(value, ['schemaVersion', 'operation', 'releaseId', 'language', 'bindingId',
        'imageDigest', 'datasetSnapshotId', 'source', 'found', 'checkedAt', 'latencyMs']);
    if (!r || r.schemaVersion !== 'mediflow.reference-data.icd11-code-check-receipt.v1'
        || r.operation !== 'mediflow.reference_data.icd11.code_check.v1' || r.source !== 'live'
        || typeof r.found !== 'boolean' || !Number.isSafeInteger(r.latencyMs) || (r.latencyMs as number) < 0
        || typeof r.checkedAt !== 'string') return null;
    try { if (new Date(r.checkedAt).toISOString() !== r.checkedAt) return null; } catch { return null; }
    const reference = parseWhoLocalReference({ releaseId: r.releaseId, language: r.language, bindingId: r.bindingId,
        imageDigest: r.imageDigest, datasetSnapshotId: r.datasetSnapshotId });
    return reference ? Object.freeze(r) as WhoCodeCheckReceipt : null;
}
export function parseWhoCodeCheckResult(value: unknown, requestedCode: string): WhoCodeCheckResult | null {
    const root = whoExactRecord(value, ['schemaVersion', 'code', 'status', 'entry', 'receipt']);
    if (!root || root.schemaVersion !== WHO_CODE_CHECK_SCHEMA || !isWhoCheckCode(requestedCode)
        || root.code !== requestedCode || !['found', 'not_found'].includes(root.status as string)) return null;
    const receipt = parseWhoCodeCheckReceipt(root.receipt);
    if (!receipt || receipt.found !== (root.status === 'found')) return null;
    if (root.status === 'not_found') return root.entry === null ? Object.freeze({ ...root, receipt }) as WhoCodeCheckResult : null;
    const entry = whoExactRecord(root.entry, ['canonicalUri', 'stemUri', 'stemCode', 'stemTitle']);
    if (!entry || entry.canonicalUri !== whoCodeInfoReference(requestedCode) || !isWhoCheckStemUri(entry.stemUri)
        || entry.stemCode !== requestedCode.split(/[&/]/u)[0]) return null;
    const title = parseWhoStemTitle({ '@id': entry.stemUri, code: entry.stemCode,
        title: { '@language': 'en', '@value': entry.stemTitle } }, entry as Omit<WhoCheckedCode, 'stemTitle'>);
    return title ? Object.freeze({ ...root, entry: Object.freeze(entry), receipt }) as WhoCodeCheckResult : null;
}
