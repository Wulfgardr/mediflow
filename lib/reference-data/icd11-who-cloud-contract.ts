// Public data-only Search contract; the binding describes the request, not a WHO body assertion.
import { isWhoCanonicalMmsUri, whoExactRecord, WHO_LOCAL_ATTRIBUTION } from './icd11-who-local-contract.ts';

export const WHO_CLOUD_REFERENCE = Object.freeze({
    apiVersion: 'v2' as const, releaseId: '2026-01' as const, linearization: 'mms' as const,
    language: 'en' as const, bindingId: 'who.icd11.v2.2026-01.mms.en.cloud.v1' as const,
    attribution: WHO_LOCAL_ATTRIBUTION,
});
export type WhoCloudReference = typeof WHO_CLOUD_REFERENCE;
export type WhoCloudEntry = Readonly<{ code: string; description: string; system: 'ICD-11'; canonicalUri: string }>;
export type WhoCloudReceipt = Readonly<WhoCloudReference & {
    schemaVersion: 'mediflow.reference-data.icd11-search-receipt.v3';
    operation: 'mediflow.reference_data.icd11.search.v3'; source: 'live' | 'cache';
    resultCount: number; latencyMs: number; completedAt: string;
}>;

export function parseWhoCloudEntry(value: unknown): WhoCloudEntry | null {
    const e = whoExactRecord(value, ['code', 'description', 'system', 'canonicalUri']);
    return e && typeof e.code === 'string' && /^[A-Z0-9][A-Z0-9.&/-]{0,31}$/u.test(e.code)
        && e.code !== 'N/A' && e.system === 'ICD-11' && typeof e.description === 'string'
        && e.description.length > 0 && e.description.length <= 4096
        && e.description === e.description.trim().replace(/\s+/gu, ' ')
        && !/[\u0000-\u001f\u007f<>\u061c\u200e\u200f\ud800-\udfff\u202a-\u202e\u2066-\u2069]/u.test(e.description)
        && isWhoCanonicalMmsUri(e.canonicalUri, e.code)
        ? Object.freeze(e) as WhoCloudEntry : null;
}

export function parseWhoCloudReceipt(value: unknown, count: number): WhoCloudReceipt | null {
    const r = whoExactRecord(value, [...Object.keys(WHO_CLOUD_REFERENCE), 'schemaVersion',
        'operation', 'source', 'resultCount', 'latencyMs', 'completedAt']);
    if (!r || Object.entries(WHO_CLOUD_REFERENCE).some(([key, expected]) => r[key] !== expected)
        || r.schemaVersion !== 'mediflow.reference-data.icd11-search-receipt.v3'
        || r.operation !== 'mediflow.reference_data.icd11.search.v3'
        || !['live', 'cache'].includes(r.source as string) || r.resultCount !== count
        || !Number.isSafeInteger(r.latencyMs) || (r.latencyMs as number) < 0
        || typeof r.completedAt !== 'string') return null;
    try { if (new Date(r.completedAt).toISOString() !== r.completedAt) return null; }
    catch { return null; }
    return Object.freeze(r) as WhoCloudReceipt;
}

export function parseWhoCloudSearchResponse(value: unknown): Readonly<{
    entries: readonly WhoCloudEntry[]; receipt: WhoCloudReceipt;
}> | null {
    const root = whoExactRecord(value, ['schemaVersion', 'entries', 'receipt']);
    if (!root || root.schemaVersion !== 'mediflow.reference-data.icd11-search-response.v3'
        || !Array.isArray(root.entries) || root.entries.length > 25) return null;
    const entries: WhoCloudEntry[] = []; const seen = new Set<string>();
    for (const raw of root.entries) {
        const entry = parseWhoCloudEntry(raw);
        if (!entry || seen.has(entry.code)) return null;
        seen.add(entry.code); entries.push(entry);
    }
    const receipt = parseWhoCloudReceipt(root.receipt, entries.length);
    return receipt ? Object.freeze({ entries: Object.freeze(entries), receipt }) : null;
}
