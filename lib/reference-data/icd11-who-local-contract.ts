/* @Codex */
// Public data-only contract. No runtime, environment, HTTP or credential imports.
export const WHO_LOCAL_BINDING_ID = 'who.icd11.v2.2026-01.mms.en.local.v1' as const;
export const WHO_LOCAL_TTL_MS = 86_400_000;
export const WHO_LOCAL_ATTRIBUTION = 'ICD-11 — World Health Organization (WHO), CC BY-ND 3.0 IGO';
export type WhoLocalStatus = 'disabled' | 'configuration_required' | 'configured' | 'available' | 'unavailable';
export type WhoLocalEntry = Readonly<{ code: string; description: string; system: 'ICD-11'; canonicalUri: string }>;
export type WhoLocalReference = Readonly<{ releaseId: '2026-01'; language: 'en'; bindingId: typeof WHO_LOCAL_BINDING_ID;
    imageDigest: string; datasetSnapshotId: string }>;
export type WhoLocalReceipt = Readonly<{
    schemaVersion: 'mediflow.reference-data.icd11-search-receipt.v2';
    operation: 'mediflow.reference_data.icd11.search.v2';
    releaseId: '2026-01'; language: 'en'; deployment: 'local'; bindingId: typeof WHO_LOCAL_BINDING_ID;
    imageDigest: string; datasetSnapshotId: string; source: 'live' | 'cache';
    resultCount: number; latencyMs: number; fetchedAt: string; expiresAt: string; completedAt: string;
}>;
export type WhoLocalSearchResult = Readonly<{
    entries: readonly WhoLocalEntry[]; partial: boolean; receipt: WhoLocalReceipt;
}>;
export type WhoLocalReadiness = Readonly<{
    schemaVersion: 'mediflow.reference-data.icd11-who-readiness.v2';
    status: WhoLocalStatus; releaseId: '2026-01'; language: 'en'; deployment: 'local';
    bindingId: typeof WHO_LOCAL_BINDING_ID; imageDigest: string | null; datasetSnapshotId: string | null;
    lastLiveObservedAt: string | null; lastResultSource: 'live' | 'cache' | null;
}>;

export function isWhoArtifactDigest(value: unknown): value is string {
    return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);
}

export function isWhoCanonicalMmsUri(value: unknown): value is string {
    return typeof value === 'string'
        && /^http:\/\/id\.who\.int\/icd\/release\/11\/2026-01\/mms\/[1-9][0-9]{0,19}(?:\/(?:other|unspecified))?$/u.test(value);
}

export function whoExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value)
            || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const ownKeys = Reflect.ownKeys(value);
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== 'string' || !keys.includes(key))) return null;
        const copy: Record<string, unknown> = {};
        for (const key of keys) {
            const descriptor = descriptors[key];
            if (!descriptor?.enumerable || !('value' in descriptor)) return null;
            copy[key] = descriptor.value;
        }
        return copy;
    } catch { return null; }
}

function timestamp(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    try { return new Date(value).toISOString() === value; } catch { return false; }
}

export function parseWhoLocalReference(value: unknown): WhoLocalReference | null {
    const r = whoExactRecord(value, ['releaseId', 'language', 'bindingId', 'imageDigest', 'datasetSnapshotId']);
    return r && r.releaseId === '2026-01' && r.language === 'en' && r.bindingId === WHO_LOCAL_BINDING_ID
        && isWhoArtifactDigest(r.imageDigest) && isWhoArtifactDigest(r.datasetSnapshotId)
        ? Object.freeze(r) as WhoLocalReference : null;
}

export function parseWhoLocalReceipt(value: unknown, count: number): WhoLocalReceipt | null {
    const r = whoExactRecord(value, ['schemaVersion', 'operation', 'releaseId', 'language', 'deployment',
        'bindingId', 'imageDigest', 'datasetSnapshotId', 'source', 'resultCount', 'latencyMs',
        'fetchedAt', 'expiresAt', 'completedAt']);
    if (!r || r.schemaVersion !== 'mediflow.reference-data.icd11-search-receipt.v2'
        || r.operation !== 'mediflow.reference_data.icd11.search.v2' || r.releaseId !== '2026-01'
        || r.language !== 'en' || r.deployment !== 'local' || r.bindingId !== WHO_LOCAL_BINDING_ID
        || !isWhoArtifactDigest(r.imageDigest) || !isWhoArtifactDigest(r.datasetSnapshotId)
        || !['live', 'cache'].includes(r.source as string) || r.resultCount !== count
        || !Number.isSafeInteger(r.latencyMs) || (r.latencyMs as number) < 0
        || !timestamp(r.fetchedAt) || !timestamp(r.expiresAt) || !timestamp(r.completedAt)) return null;
    const fetched = Date.parse(r.fetchedAt), expires = Date.parse(r.expiresAt), completed = Date.parse(r.completedAt);
    if (expires - fetched !== WHO_LOCAL_TTL_MS || completed < fetched || completed >= expires
        || (r.source === 'live' && completed - fetched > (r.latencyMs as number))) return null;
    return Object.freeze(r) as WhoLocalReceipt;
}

export function parseWhoLocalSearchResponse(value: unknown): WhoLocalSearchResult | null {
    const root = whoExactRecord(value, ['schemaVersion', 'entries', 'partial', 'receipt']);
    if (!root || root.schemaVersion !== 'mediflow.reference-data.icd11-search-response.v2'
        || typeof root.partial !== 'boolean' || !Array.isArray(root.entries) || root.entries.length > 25) return null;
    const seen = new Set<string>();
    const entries: WhoLocalEntry[] = [];
    for (const raw of root.entries) {
        const e = whoExactRecord(raw, ['code', 'description', 'system', 'canonicalUri']);
        if (!e || typeof e.code !== 'string' || !/^[A-Z0-9][A-Z0-9.&/-]{0,31}$/u.test(e.code)
            || e.code === 'N/A' || seen.has(e.code) || e.system !== 'ICD-11'
            || typeof e.description !== 'string' || !e.description || e.description.length > 4096
            || e.description !== e.description.trim().replace(/\s+/gu, ' ')
            || /[\u0000-\u001f\u007f<>\u061c\u200e\u200f\ud800-\udfff\u202a-\u202e\u2066-\u2069]/u.test(e.description)
            || !isWhoCanonicalMmsUri(e.canonicalUri)) return null;
        seen.add(e.code); entries.push(Object.freeze(e) as WhoLocalEntry);
    }
    const receipt = parseWhoLocalReceipt(root.receipt, entries.length);
    return receipt ? Object.freeze({ entries: Object.freeze(entries), partial: root.partial, receipt }) : null;
}

export function parseWhoLocalReadiness(value: unknown): WhoLocalReadiness | null {
    const r = whoExactRecord(value, ['schemaVersion', 'status', 'releaseId', 'language', 'deployment',
        'bindingId', 'imageDigest', 'datasetSnapshotId', 'lastLiveObservedAt', 'lastResultSource']);
    if (!r || r.schemaVersion !== 'mediflow.reference-data.icd11-who-readiness.v2'
        || !['disabled', 'configuration_required', 'configured', 'available', 'unavailable'].includes(r.status as string)
        || r.releaseId !== '2026-01' || r.language !== 'en' || r.deployment !== 'local'
        || r.bindingId !== WHO_LOCAL_BINDING_ID
        || (r.imageDigest !== null && !isWhoArtifactDigest(r.imageDigest))
        || (r.datasetSnapshotId !== null && !isWhoArtifactDigest(r.datasetSnapshotId))
        || (r.lastLiveObservedAt !== null && !timestamp(r.lastLiveObservedAt))
        || ![null, 'live', 'cache'].includes(r.lastResultSource as string | null)) return null;
    if (!['disabled', 'configuration_required'].includes(r.status as string)
        && (!r.imageDigest || !r.datasetSnapshotId)) return null;
    if (r.status === 'available' && r.lastLiveObservedAt === null) return null;
    return Object.freeze(r) as WhoLocalReadiness;
}
