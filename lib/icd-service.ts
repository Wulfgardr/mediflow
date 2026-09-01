/* @Codex */
import type { ICDCode } from './icd-codes';

const ICD_PROXY_URL = '/api/icd/proxy';
const QUERY_MAX_BYTES = 160;
const BODY_MAX_BYTES = 131_072;
const RESULT_LIMIT = 25;
const encoder = new TextEncoder();

const SEARCH_ROOT_KEYS = ['schemaVersion', 'entries', 'receipt'] as const;
const ENTRY_KEYS = ['code', 'description', 'system'] as const;
const RECEIPT_KEYS = [
    'schemaVersion', 'operation', 'releaseId', 'language', 'source',
    'resultCount', 'latencyMs', 'completedAt',
] as const;
const READINESS_KEYS = ['schemaVersion', 'status', 'releaseId', 'language'] as const;

export interface ICDSearchResult extends ICDCode {
    isLegacy: false;
}

export type ICDReadinessStatus = 'disabled' | 'credentials_absent' | 'offline'
    | 'configured' | 'available' | 'unavailable';

export type ICDReadiness = Readonly<{
    schemaVersion: 'mediflow.reference-data.icd11-who-readiness.v1';
    status: ICDReadinessStatus;
    releaseId: '2026-01';
    language: 'en';
}>;

export type ICDSearchReceipt = Readonly<{
    schemaVersion: 'mediflow.reference-data.icd11-search-receipt.v1';
    operation: 'mediflow.reference_data.icd11.search.v1';
    releaseId: '2026-01';
    language: 'en';
    source: 'live' | 'cache';
    resultCount: number;
    latencyMs: number;
    completedAt: string;
}>;

export type ICDClientErrorCode = 'unauthorized' | 'request_invalid' | 'service_unavailable'
    | 'upstream_response_invalid' | 'upstream_timeout' | 'response_invalid' | 'transport_unavailable';

export class ICDClientError extends Error {
    constructor(public readonly code: ICDClientErrorCode) {
        super(`ICD reference-data request rejected: ${code}`);
        this.name = 'ICDClientError';
    }
}

export type ICDReferenceDataClient = Readonly<{
    search(query: string): Promise<ICDSearchResult[]>;
    readiness(): Promise<ICDReadiness>;
    lastReceipt(): ICDSearchReceipt | null;
}>;

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length
        || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
    }
    return value as Record<string, unknown>;
}

async function parsedBody(response: Response): Promise<unknown> {
    let body: string;
    try { body = await response.text(); }
    catch { throw new ICDClientError('response_invalid'); }
    if (!body || encoder.encode(body).byteLength > BODY_MAX_BYTES) throw new ICDClientError('response_invalid');
    try { return JSON.parse(body) as unknown; }
    catch { throw new ICDClientError('response_invalid'); }
}

function normalizedQuery(value: string): string {
    const normalized = value.trim().replace(/\s+/gu, ' ');
    if (!normalized || /[\u0000-\u001f\u007f<>\u202a-\u202e\u2066-\u2069]/u.test(normalized)
        || encoder.encode(normalized).byteLength > QUERY_MAX_BYTES) throw new ICDClientError('request_invalid');
    return normalized;
}

function receipt(value: unknown, resultCount: number): ICDSearchReceipt | null {
    const candidate = exactRecord(value, RECEIPT_KEYS);
    if (!candidate
        || candidate.schemaVersion !== 'mediflow.reference-data.icd11-search-receipt.v1'
        || candidate.operation !== 'mediflow.reference_data.icd11.search.v1'
        || candidate.releaseId !== '2026-01' || candidate.language !== 'en'
        || (candidate.source !== 'live' && candidate.source !== 'cache')
        || candidate.resultCount !== resultCount
        || !Number.isSafeInteger(candidate.latencyMs) || (candidate.latencyMs as number) < 0
        || typeof candidate.completedAt !== 'string') return null;
    let canonicalTimestamp: string;
    try { canonicalTimestamp = new Date(candidate.completedAt).toISOString(); }
    catch { return null; }
    if (canonicalTimestamp !== candidate.completedAt) return null;
    return Object.freeze(candidate) as ICDSearchReceipt;
}

function searchResponse(value: unknown): Readonly<{
    entries: ICDSearchResult[];
    receipt: ICDSearchReceipt;
}> | null {
    const root = exactRecord(value, SEARCH_ROOT_KEYS);
    if (!root || root.schemaVersion !== 'mediflow.reference-data.icd11-search-response.v1'
        || !Array.isArray(root.entries) || root.entries.length > RESULT_LIMIT) return null;
    const entries: ICDSearchResult[] = [];
    const seen = new Set<string>();
    for (const rawEntry of root.entries) {
        const entry = exactRecord(rawEntry, ENTRY_KEYS);
        if (!entry || typeof entry.code !== 'string' || !/^[A-Z0-9][A-Z0-9.&/-]{0,31}$/u.test(entry.code)
            || entry.code === 'N/A' || typeof entry.description !== 'string'
            || !entry.description || entry.description.length > 4_096
            || entry.description.trim() !== entry.description
            || /[\u0000-\u001f\u007f<>\u202a-\u202e\u2066-\u2069]/u.test(entry.description)
            || entry.system !== 'ICD-11' || seen.has(entry.code)) return null;
        seen.add(entry.code);
        entries.push(Object.freeze({
            code: entry.code,
            description: entry.description,
            system: 'ICD-11',
            isLegacy: false,
        }));
    }
    const parsedReceipt = receipt(root.receipt, entries.length);
    return parsedReceipt ? Object.freeze({ entries, receipt: parsedReceipt }) : null;
}

function readiness(value: unknown): ICDReadiness | null {
    const candidate = exactRecord(value, READINESS_KEYS);
    if (!candidate || candidate.schemaVersion !== 'mediflow.reference-data.icd11-who-readiness.v1'
        || !['disabled', 'credentials_absent', 'offline', 'configured', 'available', 'unavailable']
            .includes(candidate.status as string)
        || candidate.releaseId !== '2026-01' || candidate.language !== 'en') return null;
    return Object.freeze(candidate) as ICDReadiness;
}

function httpError(status: number): ICDClientError {
    if (status === 401) return new ICDClientError('unauthorized');
    if (status === 400) return new ICDClientError('request_invalid');
    if (status === 502) return new ICDClientError('upstream_response_invalid');
    if (status === 504) return new ICDClientError('upstream_timeout');
    return new ICDClientError('service_unavailable');
}

export function createICDReferenceDataClient(fetchImpl: typeof fetch): ICDReferenceDataClient {
    let observedReceipt: ICDSearchReceipt | null = null;
    const request = async (url: string): Promise<Response> => {
        try {
            return await fetchImpl(url, Object.freeze({
                method: 'GET',
                credentials: 'same-origin',
                headers: { Accept: 'application/json' },
            }));
        } catch { throw new ICDClientError('transport_unavailable'); }
    };
    const search = async (queryValue: string): Promise<ICDSearchResult[]> => {
        const query = normalizedQuery(queryValue);
        const response = await request(`${ICD_PROXY_URL}?q=${encodeURIComponent(query)}`);
        if (!response.ok) throw httpError(response.status);
        const parsed = searchResponse(await parsedBody(response));
        if (!parsed) throw new ICDClientError('response_invalid');
        observedReceipt = parsed.receipt;
        return parsed.entries;
    };
    const readReadiness = async (): Promise<ICDReadiness> => {
        const response = await request(ICD_PROXY_URL);
        const parsed = readiness(await parsedBody(response));
        if (!parsed) throw new ICDClientError('response_invalid');
        if (parsed.status === 'available' && !response.ok) throw new ICDClientError('response_invalid');
        return parsed;
    };
    return Object.freeze({ search, readiness: readReadiness, lastReceipt: () => observedReceipt });
}

const browserClient = createICDReferenceDataClient((input, init) => globalThis.fetch(input, init));

export async function searchICDHybrid(query: string): Promise<ICDSearchResult[]> {
    return browserClient.search(query);
}

export async function getICDReadiness(): Promise<ICDReadiness> {
    return browserClient.readiness();
}

export async function checkApiStatus(client: ICDReferenceDataClient = browserClient): Promise<boolean> {
    try { return (await client.readiness()).status === 'available'; }
    catch { return false; }
}

export function icdClientErrorMessage(error: unknown): string {
    if (!(error instanceof ICDClientError)) return 'Il servizio WHO ICD-11 non è disponibile.';
    switch (error.code) {
        case 'unauthorized': return 'Sessione non valida: accedi di nuovo per consultare ICD-11.';
        case 'request_invalid': return 'La ricerca ICD-11 non è valida.';
        case 'upstream_timeout': return 'Il servizio WHO ICD-11 non ha risposto entro il tempo previsto.';
        case 'upstream_response_invalid':
        case 'response_invalid': return 'La risposta WHO ICD-11 non è verificabile.';
        case 'service_unavailable':
        case 'transport_unavailable': return 'Il servizio WHO ICD-11 non è disponibile.';
        default: return 'Il servizio WHO ICD-11 non è disponibile.';
    }
}
