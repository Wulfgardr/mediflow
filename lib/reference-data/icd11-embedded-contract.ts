import { isWhoArtifactDigest, isWhoCanonicalMmsUri, whoExactRecord } from './icd11-who-local-contract';

export const WHO_EMBEDDED_BINDING = 'who.icd11.2026-01.mms.en.embedded.v1' as const;
export const WHO_EMBEDDED_LABEL = 'Catalogo WHO incorporato, release 2026-01';
export const WHO_EMBEDDED_ATTRIBUTION = 'ICD-11, World Health Organization (WHO), CC BY-ND 3.0 IGO';
export type WhoEmbeddedReference = Readonly<{ releaseId: '2026-01'; language: 'en';
    bindingId: typeof WHO_EMBEDDED_BINDING; datasetSnapshotId: string }>;
export type WhoEmbeddedReceipt = WhoEmbeddedReference & Readonly<{
    schemaVersion: 'mediflow.reference-data.icd11-search-receipt.v3';
    operation: 'mediflow.reference_data.icd11.search.v3'; source: 'embedded';
    resultCount: number; latencyMs: number; completedAt: string;
}>;
export type WhoEmbeddedEntry = Readonly<{ code: string; description: string; system: 'ICD-11'; canonicalUri: string }>;
export type WhoEmbeddedSearchResult = Readonly<{ entries: readonly WhoEmbeddedEntry[]; partial: boolean; receipt: WhoEmbeddedReceipt }>;
export type WhoEmbeddedReadiness = Readonly<{
    schemaVersion: 'mediflow.reference-data.icd11-who-readiness.v3'; status: 'available' | 'unavailable' | 'disabled';
    releaseId: '2026-01'; language: 'en'; deployment: 'embedded';
    catalogState: 'ready' | 'absent' | 'unverified'; datasetSnapshotId: string | null;
}>;
export function isWhoEmbeddedTitle(value: unknown): value is string {
    return typeof value === 'string' && Boolean(value.trim()) && value.length <= 4096
        && !/[\u0000-\u001f\u007f\u061c\u200e\u200f\ud800-\udfff\u202a-\u202e\u2066-\u2069]/u.test(value)
        && !/[<>]/u.test(value.replace(/[<>](?=\s*\d)/gu, ''));
}
export function parseWhoEmbeddedReference(value: unknown): WhoEmbeddedReference | null {
    const r = whoExactRecord(value, ['releaseId', 'language', 'bindingId', 'datasetSnapshotId']);
    return r && r.releaseId === '2026-01' && r.language === 'en' && r.bindingId === WHO_EMBEDDED_BINDING
        && isWhoArtifactDigest(r.datasetSnapshotId) ? Object.freeze(r) as WhoEmbeddedReference : null;
}
export function parseWhoEmbeddedReadiness(value: unknown): WhoEmbeddedReadiness | null {
    const r = whoExactRecord(value, ['schemaVersion', 'status', 'releaseId', 'language', 'deployment', 'catalogState', 'datasetSnapshotId']);
    if (!r || r.schemaVersion !== 'mediflow.reference-data.icd11-who-readiness.v3' || r.releaseId !== '2026-01'
        || r.language !== 'en' || r.deployment !== 'embedded' || !['ready', 'absent', 'unverified'].includes(r.catalogState as string)
        || !['available', 'unavailable', 'disabled'].includes(r.status as string)
        || (r.datasetSnapshotId !== null && !isWhoArtifactDigest(r.datasetSnapshotId))
        || (r.status === 'available' && (r.catalogState !== 'ready' || !r.datasetSnapshotId))) return null;
    return Object.freeze(r) as WhoEmbeddedReadiness;
}
export function parseWhoEmbeddedSearchResponse(value: unknown): WhoEmbeddedSearchResult | null {
    const root = whoExactRecord(value, ['schemaVersion', 'entries', 'partial', 'receipt']);
    if (!root || root.schemaVersion !== 'mediflow.reference-data.icd11-search-response.v3'
        || !Array.isArray(root.entries) || root.entries.length > 25 || typeof root.partial !== 'boolean') return null;
    const entries: WhoEmbeddedEntry[] = [], seen = new Set<string>();
    for (const raw of root.entries) {
        const e = whoExactRecord(raw, ['code', 'description', 'system', 'canonicalUri']);
        if (!e || typeof e.code !== 'string' || !/^[A-Z0-9][A-Z0-9.-]{0,31}$/u.test(e.code)
            || seen.has(e.code) || e.system !== 'ICD-11' || !isWhoCanonicalMmsUri(e.canonicalUri, e.code)
            || !isWhoEmbeddedTitle(e.description)) return null;
        seen.add(e.code); entries.push(Object.freeze(e) as WhoEmbeddedEntry);
    }
    const r = whoExactRecord(root.receipt, ['schemaVersion', 'operation', 'releaseId', 'language', 'bindingId',
        'datasetSnapshotId', 'source', 'resultCount', 'latencyMs', 'completedAt']);
    if (!r || r.schemaVersion !== 'mediflow.reference-data.icd11-search-receipt.v3'
        || r.operation !== 'mediflow.reference_data.icd11.search.v3' || r.source !== 'embedded'
        || r.resultCount !== entries.length || !Number.isSafeInteger(r.latencyMs) || (r.latencyMs as number) < 0
        || typeof r.completedAt !== 'string' || !parseWhoEmbeddedReference({ releaseId: r.releaseId, language: r.language,
            bindingId: r.bindingId, datasetSnapshotId: r.datasetSnapshotId })) return null;
    try { if (new Date(r.completedAt).toISOString() !== r.completedAt) return null; } catch { return null; }
    return { entries, partial: root.partial, receipt: Object.freeze(r) as WhoEmbeddedReceipt };
}
