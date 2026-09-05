/* @Codex */
import { types as nodeUtilTypes } from 'node:util';

export const ICD11_WHO_SEARCH_OPERATION = 'mediflow.reference_data.icd11.search.v1' as const;
export const ICD11_WHO_TRANSPORT_TARGET = 'who.icd-api.v2.official' as const;
export const ICD11_WHO_BINDING = Object.freeze({
    apiVersion: 'v2' as const, releaseId: '2026-01' as const, linearization: 'mms' as const,
    language: 'en' as const, queryMaxBytes: 160, resultLimit: 25, maxResponseBytes: 65_536,
    timeoutMs: 5_000, auditTimeoutMs: 1_000, cacheTtlMs: 86_400_000,
});

const RUNTIME_KEYS = ['schemaVersion', 'network', 'egress', 'credential'] as const;
const DEPENDENCY_KEYS = ['readRuntimeState', 'now', 'audit', 'transport'] as const;
const RESULT_KEYS = ['schemaVersion', 'releaseId', 'language', 'entries'] as const;
const ENTRY_KEYS = ['code', 'description'] as const;
const ISO_DATE_MAX_MS = 8_640_000_000_000_000;
const encoder = new TextEncoder();

export type Icd11WhoRuntimeState = Readonly<{
    schemaVersion: 'mediflow.reference-data.icd11-who-runtime.v1';
    network: 'online' | 'offline'; egress: 'enabled' | 'disabled';
    credential: 'absent' | 'configured' | 'validated' | 'enabled' | 'disabled' | 'revoked_local';
}>;
export type Icd11WhoTransportRequest = Readonly<{
    target: typeof ICD11_WHO_TRANSPORT_TARGET; releaseId: typeof ICD11_WHO_BINDING.releaseId;
    linearization: typeof ICD11_WHO_BINDING.linearization; language: typeof ICD11_WHO_BINDING.language;
    query: string; limit: number; maxResponseBytes: number; signal: AbortSignal;
}>;
export type Icd11WhoSearchReceipt = Readonly<{
    schemaVersion: 'mediflow.reference-data.icd11-search-receipt.v1';
    operation: typeof ICD11_WHO_SEARCH_OPERATION; releaseId: typeof ICD11_WHO_BINDING.releaseId;
    language: typeof ICD11_WHO_BINDING.language; source: 'live' | 'cache'; resultCount: number;
    latencyMs: number; completedAt: string;
}>;
export type Icd11WhoSearchResult = Readonly<{
    entries: ReadonlyArray<Readonly<{ code: string; description: string; system: 'ICD-11' }>>;
    receipt: Icd11WhoSearchReceipt;
}>;
type Dependencies = Readonly<{
    readRuntimeState: () => unknown; now: () => unknown;
    audit: (receipt: Icd11WhoSearchReceipt) => void | Promise<void>;
    transport: (request: Icd11WhoTransportRequest) => unknown | Promise<unknown>;
}>;

export type Icd11WhoServiceErrorCode = 'input_invalid' | 'runtime_state_invalid' | 'egress_disabled'
    | 'credential_unavailable' | 'offline_unavailable' | 'request_timeout' | 'request_cancelled'
    | 'upstream_unavailable' | 'response_invalid' | 'audit_unavailable' | 'service_disposed';
export class Icd11WhoServiceError extends Error {
    readonly code: Icd11WhoServiceErrorCode;
    constructor(code: Icd11WhoServiceErrorCode) {
        super(`ICD-11 WHO service rejected: ${code}`); this.name = 'Icd11WhoServiceError';
        this.code = code;
    }
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || nodeUtilTypes.isProxy(value) || Array.isArray(value)) return null;
        const prototype = Object.getPrototypeOf(value); const descriptors = Object.getOwnPropertyDescriptors(value);
        const ownKeys = Reflect.ownKeys(value);
        if ((prototype !== Object.prototype && prototype !== null) || ownKeys.length !== keys.length
            || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        for (const key of keys) if (!descriptors[key] || !('value' in descriptors[key]!)) return null;
        return Object.fromEntries(keys.map((key) => [key, descriptors[key]!.value]));
    } catch { return null; }
}

function clock(source: () => unknown, minimum = 0): number {
    let value: unknown;
    try { value = source(); } catch { throw new Icd11WhoServiceError('runtime_state_invalid'); }
    if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > ISO_DATE_MAX_MS) {
        throw new Icd11WhoServiceError('runtime_state_invalid');
    }
    return value as number;
}

function runtimeState(source: () => unknown): Icd11WhoRuntimeState {
    let value: unknown;
    try { value = source(); } catch { throw new Icd11WhoServiceError('runtime_state_invalid'); }
    const state = record(value, RUNTIME_KEYS);
    if (!state || state.schemaVersion !== 'mediflow.reference-data.icd11-who-runtime.v1'
        || (state.network !== 'online' && state.network !== 'offline')
        || (state.egress !== 'enabled' && state.egress !== 'disabled')
        || !['absent', 'configured', 'validated', 'enabled', 'disabled', 'revoked_local'].includes(state.credential as string)) {
        throw new Icd11WhoServiceError('runtime_state_invalid');
    }
    return Object.freeze(state) as Icd11WhoRuntimeState;
}

function query(value: unknown): string {
    const input = record(value, ['query']);
    if (!input || typeof input.query !== 'string') throw new Icd11WhoServiceError('input_invalid');
    const normalized = input.query.trim().replace(/\s+/g, ' ');
    if (!normalized || /[\u0000-\u001f\u007f<>\u202a-\u202e\u2066-\u2069]/i.test(normalized)
        || encoder.encode(normalized).byteLength > ICD11_WHO_BINDING.queryMaxBytes) {
        throw new Icd11WhoServiceError('input_invalid');
    }
    return normalized;
}

function arrayValues(value: unknown, maximum: number): unknown[] | null {
    try {
        if (nodeUtilTypes.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
        if (!lengthDescriptor || !('value' in lengthDescriptor)) return null;
        const length = lengthDescriptor.value;
        if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return null;
        const keys = Reflect.ownKeys(descriptors);
        if (keys.length !== length + 1 || !keys.includes('length')) return null;
        const values: unknown[] = [];
        for (let index = 0; index < length; index += 1) {
            const descriptor = descriptors[String(index)];
            if (!descriptor || !('value' in descriptor)) return null;
            values.push(descriptor.value);
        }
        return values;
    } catch { return null; }
}

function nativePromise(value: unknown): value is Promise<unknown> {
    try {
        return !nodeUtilTypes.isProxy(value) && nodeUtilTypes.isPromise(value)
            && Object.getPrototypeOf(value) === Promise.prototype;
    } catch { return false; }
}

function transportResult(value: unknown) {
    const result = record(value, RESULT_KEYS);
    if (!result || result.schemaVersion !== 'mediflow.reference-data.icd11-who-transport-result.v1'
        || result.releaseId !== ICD11_WHO_BINDING.releaseId || result.language !== ICD11_WHO_BINDING.language
    ) return null;
    const rawEntries = arrayValues(result.entries, ICD11_WHO_BINDING.resultLimit); if (!rawEntries) return null;
    const seen = new Set<string>(); const entries: Array<Readonly<{ code: string; description: string; system: 'ICD-11' }>> = [];
    let bytes = 0;
    for (const rawEntry of rawEntries) {
        const entry = record(rawEntry, ENTRY_KEYS);
        const normalizedDescription = typeof entry?.description === 'string'
            ? entry.description.trim().replace(/\s+/g, ' ')
            : '';
        if (!entry || typeof entry.code !== 'string' || !/^[A-Z0-9][A-Z0-9.&/-]{0,31}$/.test(entry.code)
            || typeof entry.description !== 'string' || !normalizedDescription || entry.description !== normalizedDescription
            || /[\u0000-\u001f\u007f<>\u202a-\u202e\u2066-\u2069]/i.test(entry.description)
            || seen.has(entry.code)) return null;
        bytes += encoder.encode(entry.code).byteLength + encoder.encode(entry.description).byteLength;
        if (bytes > ICD11_WHO_BINDING.maxResponseBytes) return null;
        seen.add(entry.code); entries.push(Object.freeze({ code: entry.code, description: entry.description, system: 'ICD-11' as const }));
    }
    return Object.freeze(entries);
}

export function createIcd11WhoReferenceDataService(dependencies: Dependencies) {
    const dependencyRecord = record(dependencies, DEPENDENCY_KEYS);
    if (!dependencyRecord || typeof dependencyRecord.readRuntimeState !== 'function' || typeof dependencyRecord.now !== 'function'
        || typeof dependencyRecord.audit !== 'function' || typeof dependencyRecord.transport !== 'function') {
        throw new Icd11WhoServiceError('input_invalid');
    }
    const sources = dependencyRecord as unknown as Dependencies;
    const cache = new Map<string, Readonly<{ entries: Icd11WhoSearchResult['entries']; expiresAt: number }>>();
    const active = new Map<AbortController, { code: 'request_timeout' | 'request_cancelled' }>(); let disposed = false;
    const auditWaiters = new Set<() => void>();
    const requireActive = (): void => {
        if (disposed) throw new Icd11WhoServiceError('service_disposed');
    };
    const publish = async (entries: Icd11WhoSearchResult['entries'], source: 'live' | 'cache',
        startedAt: number, completedAtMs: number): Promise<Icd11WhoSearchResult> => {
        requireActive();
        const receipt = Object.freeze({ schemaVersion: 'mediflow.reference-data.icd11-search-receipt.v1' as const,
            operation: ICD11_WHO_SEARCH_OPERATION, releaseId: ICD11_WHO_BINDING.releaseId,
            language: ICD11_WHO_BINDING.language, source, resultCount: entries.length,
            latencyMs: completedAtMs - startedAt, completedAt: new Date(completedAtMs).toISOString() });
        let audited: unknown;
        try { audited = sources.audit(receipt); requireActive(); }
        catch { requireActive(); throw new Icd11WhoServiceError('audit_unavailable'); }
        if (audited !== undefined) {
            if (!nativePromise(audited)) throw new Icd11WhoServiceError('audit_unavailable');
            let rejectDisposed!: () => void;
            const disposedDuringAudit = new Promise<never>((_resolve, reject) => {
                rejectDisposed = () => reject(new Icd11WhoServiceError('service_disposed'));
                auditWaiters.add(rejectDisposed);
            });
            let timer: ReturnType<typeof setTimeout> | undefined;
            const timedOut = new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Icd11WhoServiceError('audit_unavailable')),
                    ICD11_WHO_BINDING.auditTimeoutMs);
            });
            try {
                const outcome = await Promise.race([audited, disposedDuringAudit, timedOut]);
                requireActive();
                if (outcome !== undefined) throw new Icd11WhoServiceError('audit_unavailable');
            } catch {
                requireActive(); throw new Icd11WhoServiceError('audit_unavailable');
            } finally {
                if (timer) clearTimeout(timer);
                auditWaiters.delete(rejectDisposed);
            }
        }
        return Object.freeze({ entries, receipt });
    };
    const search = async (input: unknown): Promise<Icd11WhoSearchResult> => {
        requireActive();
        const normalizedQuery = query(input); const startedAt = clock(sources.now);
        requireActive();
        const cacheKey = normalizedQuery.toLocaleLowerCase('en'); const cached = cache.get(cacheKey);
        if (cached && cached.expiresAt > startedAt) return publish(cached.entries, 'cache', startedAt, startedAt);
        if (cached) cache.delete(cacheKey);
        const state = runtimeState(sources.readRuntimeState);
        requireActive();
        if (state.network !== 'online') throw new Icd11WhoServiceError('offline_unavailable');
        if (state.egress !== 'enabled') throw new Icd11WhoServiceError('egress_disabled');
        if (state.credential !== 'enabled') throw new Icd11WhoServiceError('credential_unavailable');
        const controller = new AbortController(); const cancellation = { code: 'request_cancelled' as const } as {
            code: 'request_timeout' | 'request_cancelled';
        };
        active.set(controller, cancellation);
        const cancelled = new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort',
            () => reject(new Icd11WhoServiceError(cancellation.code)), { once: true }));
        void cancelled.catch(() => undefined);
        const timer = setTimeout(() => { cancellation.code = 'request_timeout'; controller.abort(); }, ICD11_WHO_BINDING.timeoutMs);
        let response: unknown;
        try {
            const transported = sources.transport(Object.freeze({ target: ICD11_WHO_TRANSPORT_TARGET,
                releaseId: ICD11_WHO_BINDING.releaseId, linearization: ICD11_WHO_BINDING.linearization,
                language: ICD11_WHO_BINDING.language, query: normalizedQuery, limit: ICD11_WHO_BINDING.resultLimit,
                maxResponseBytes: ICD11_WHO_BINDING.maxResponseBytes, signal: controller.signal }));
            requireActive();
            response = await Promise.race([transported, cancelled]);
            requireActive();
        } catch (error) {
            if (error instanceof Icd11WhoServiceError) throw error;
            requireActive();
            throw new Icd11WhoServiceError('upstream_unavailable');
        } finally { clearTimeout(timer); active.delete(controller); }
        const entries = transportResult(response); if (!entries) throw new Icd11WhoServiceError('response_invalid');
        const completedAtMs = clock(sources.now, startedAt);
        requireActive();
        const result = await publish(entries, 'live', startedAt, completedAtMs);
        requireActive();
        if (completedAtMs <= ISO_DATE_MAX_MS - ICD11_WHO_BINDING.cacheTtlMs) {
            cache.set(cacheKey, Object.freeze({ entries, expiresAt: completedAtMs + ICD11_WHO_BINDING.cacheTtlMs }));
        }
        return result;
    };
    const dispose = (): boolean => {
        if (disposed) return false;
        disposed = true; cache.clear();
        for (const [controller, cancellation] of active) { cancellation.code = 'request_cancelled'; controller.abort(); }
        active.clear();
        for (const rejectDisposed of auditWaiters) rejectDisposed();
        auditWaiters.clear(); return true;
    };
    return Object.freeze({ search, dispose });
}
