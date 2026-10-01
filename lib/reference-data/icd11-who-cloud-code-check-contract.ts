// Data-only prerequisite. No transport or production composition.
import { isWhoCheckCode, isWhoCheckStemUri, parseWhoStemTitle, whoCodeInfoReference } from './icd11-who-code-check-contract';
import { whoExactRecord, WHO_LOCAL_ATTRIBUTION } from './icd11-who-local-contract';

// Same pinned request profile as cloud Search; independent of the unmerged Search contract.
export const WHO_CLOUD_CODE_CHECK_REFERENCE = Object.freeze({
    apiVersion: 'v2' as const, releaseId: '2026-01' as const, linearization: 'mms' as const,
    language: 'en' as const, bindingId: 'who.icd11.v2.2026-01.mms.en.cloud.v1' as const,
    attribution: WHO_LOCAL_ATTRIBUTION,
});
export const WHO_CLOUD_CODE_CHECK_SCHEMA = 'mediflow.reference-data.icd11-cloud-code-check.v1' as const;
export type WhoCloudCheckedCode = Readonly<{
    codeInfoResourceUri: string;
    codeInfoResourceUriProvenance: 'request';
    stemUri: string;
    stemUriProvenance: 'codeinfo.stemId+linearization.@id';
    stemCode: string; stemTitle: string;
    simplifiedCode: string | null; simplifiedStemCode: string | null;
}>;
export type WhoCloudCodeCheckReceipt = Readonly<typeof WHO_CLOUD_CODE_CHECK_REFERENCE & {
    schemaVersion: 'mediflow.reference-data.icd11-cloud-code-check-receipt.v1';
    operation: 'mediflow.reference_data.icd11.cloud_code_check.v1';
    source: 'live'; found: boolean; checkedAt: string; latencyMs: number;
}>;
export type WhoCloudCodeCheckResult = Readonly<{
    schemaVersion: typeof WHO_CLOUD_CODE_CHECK_SCHEMA; code: string;
    receipt: WhoCloudCodeCheckReceipt;
} & ({ status: 'found'; entry: WhoCloudCheckedCode } | { status: 'not_found'; entry: null })>;

function dataRecord(value: unknown): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value)
            || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const descriptors = Object.getOwnPropertyDescriptors(value);
        // A null-prototype snapshot cannot acquire inherited identity through assignment.
        // Reject poison keys and transport/error envelope metadata instead of projecting them away.
        const copy: Record<string, unknown> = Object.create(null);
        for (const key of Reflect.ownKeys(value)) {
            if (typeof key !== 'string' || ['__proto__', 'error', 'errors', 'status', 'partial', 'resultChopped'].includes(key)) return null;
            const descriptor = descriptors[key];
            if (!descriptor?.enumerable || !('value' in descriptor)) return null;
            copy[key] = descriptor.value;
        }
        return copy;
    } catch { return null; }
}

function simplifications(raw: Record<string, unknown>): {
    simplifiedCode: string | null; simplifiedStemCode: string | null;
} | null {
    const simplifiedCode = Object.hasOwn(raw, 'simplifiedCode') ? raw.simplifiedCode ?? null : null;
    const simplifiedStemCode = Object.hasOwn(raw, 'simplifiedStemCode') ? raw.simplifiedStemCode ?? null : null;
    if (simplifiedCode !== null && !isWhoCheckCode(simplifiedCode)) return null;
    if (simplifiedStemCode !== null && (!isWhoCheckCode(simplifiedStemCode) || /[&/]/u.test(simplifiedStemCode))) return null;
    if (typeof simplifiedCode === 'string' && typeof simplifiedStemCode === 'string'
        && simplifiedCode.split(/[&/]/u)[0] !== simplifiedStemCode) return null;
    return { simplifiedCode, simplifiedStemCode };
}

/** Projects identity evidence, not all CodeInfo axes. Null means invalid evidence, never not_found.
 * WHO Swagger v2.6.0 CodeInfo has no @id or title. The entity body verifies only the first stem.
 * Additional axis fields are ignored. Accept only successful complete bodies admitted by transport;
 * known error/status/partial metadata is rejected, but this parser cannot verify HTTP status itself.
 */
export function parseWhoCloudCodeInfo(codeInfo: unknown, stemEntity: unknown, requestedCode: string): WhoCloudCheckedCode | null {
    if (!isWhoCheckCode(requestedCode)) return null;
    const raw = dataRecord(codeInfo); const entity = dataRecord(stemEntity);
    const stemCode = requestedCode.split(/[&/]/u)[0];
    if (!raw || !entity || !['code', 'stemCode', 'stemId'].every(key => Object.hasOwn(raw, key))
        || !['@id', 'code', 'title'].every(key => Object.hasOwn(entity, key))
        || Object.hasOwn(raw, '@id') || raw.code !== requestedCode
        || raw.stemCode !== stemCode || !isWhoCheckStemUri(raw.stemId)) return null;
    const simplified = simplifications(raw);
    const codeInfoResourceUri = whoCodeInfoReference(requestedCode);
    const stemTitle = parseWhoStemTitle(entity, { canonicalUri: codeInfoResourceUri, stemUri: raw.stemId, stemCode });
    return simplified && stemTitle ? Object.freeze({
        codeInfoResourceUri, codeInfoResourceUriProvenance: 'request',
        stemUri: raw.stemId, stemUriProvenance: 'codeinfo.stemId+linearization.@id',
        stemCode, stemTitle, ...simplified,
    }) : null;
}

export function parseWhoCloudCodeCheckReceipt(value: unknown): WhoCloudCodeCheckReceipt | null {
    const r = whoExactRecord(value, [...Object.keys(WHO_CLOUD_CODE_CHECK_REFERENCE),
        'schemaVersion', 'operation', 'source', 'found', 'checkedAt', 'latencyMs']);
    if (!r || Object.entries(WHO_CLOUD_CODE_CHECK_REFERENCE).some(([key, expected]) => r[key] !== expected)
        || r.schemaVersion !== 'mediflow.reference-data.icd11-cloud-code-check-receipt.v1'
        || r.operation !== 'mediflow.reference_data.icd11.cloud_code_check.v1' || r.source !== 'live'
        || typeof r.found !== 'boolean' || !Number.isSafeInteger(r.latencyMs) || (r.latencyMs as number) < 0
        || typeof r.checkedAt !== 'string') return null;
    try { if (new Date(r.checkedAt).toISOString() !== r.checkedAt) return null; } catch { return null; }
    return Object.freeze(r) as WhoCloudCodeCheckReceipt;
}

/** Validates a host result; does not manufacture success/not_found from an absent or failed response. */
export function parseWhoCloudCodeCheckResult(value: unknown, requestedCode: string): WhoCloudCodeCheckResult | null {
    const root = whoExactRecord(value, ['schemaVersion', 'code', 'status', 'entry', 'receipt']);
    if (!root || root.schemaVersion !== WHO_CLOUD_CODE_CHECK_SCHEMA || !isWhoCheckCode(requestedCode)
        || root.code !== requestedCode || !['found', 'not_found'].includes(root.status as string)) return null;
    const receipt = parseWhoCloudCodeCheckReceipt(root.receipt);
    if (!receipt || receipt.found !== (root.status === 'found')) return null;
    if (root.status === 'not_found') return root.entry === null
        ? Object.freeze({ schemaVersion: WHO_CLOUD_CODE_CHECK_SCHEMA, code: requestedCode, status: 'not_found', entry: null, receipt }) : null;
    const entry = whoExactRecord(root.entry, ['codeInfoResourceUri', 'codeInfoResourceUriProvenance',
        'stemUri', 'stemUriProvenance', 'stemCode', 'stemTitle', 'simplifiedCode', 'simplifiedStemCode']);
    if (!entry || entry.codeInfoResourceUri !== whoCodeInfoReference(requestedCode)
        || entry.codeInfoResourceUriProvenance !== 'request'
        || entry.stemUriProvenance !== 'codeinfo.stemId+linearization.@id'
        || entry.simplifiedCode === undefined || entry.simplifiedStemCode === undefined) return null;
    // Validate the projection's internal consistency. This is not independent response evidence.
    const checked = parseWhoCloudCodeInfo({ code: requestedCode, stemCode: entry.stemCode, stemId: entry.stemUri,
        simplifiedCode: entry.simplifiedCode, simplifiedStemCode: entry.simplifiedStemCode },
    { '@id': entry.stemUri, code: entry.stemCode, title: { '@language': 'en', '@value': entry.stemTitle } }, requestedCode);
    return checked ? Object.freeze({ schemaVersion: WHO_CLOUD_CODE_CHECK_SCHEMA, code: requestedCode,
        status: 'found', entry: checked, receipt }) : null;
}
