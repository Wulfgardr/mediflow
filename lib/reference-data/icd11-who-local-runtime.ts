/* @Codex */
import { ICD11_WHO_BINDING, Icd11WhoServiceError, type Icd11WhoServiceErrorCode } from './icd11-who-service.ts';
import { parseIcd11WhoOfficialSearchBody } from './icd11-who-official-search-parser.ts';
import { isWhoArtifactDigest, resolveWhoSearchReference, WHO_LOCAL_BINDING_ID, WHO_LOCAL_TTL_MS,
    type WhoLocalEntry, type WhoLocalReceipt, type WhoLocalReadiness, type WhoLocalSearchResult } from './icd11-who-local-contract.ts';

export type WhoLocalTransport = (query: string, signal: AbortSignal) => Promise<Readonly<{ status: number; body: string }>>;
type Sources = Readonly<{
    readEnvironment(name: string): unknown; now(): number;
    transport: WhoLocalTransport; audit(receipt: WhoLocalReceipt): void | Promise<void>;
}>;
type Config = Readonly<{ enabled: boolean; imageDigest: string | null; datasetSnapshotId: string | null }>;
type Cached = Readonly<{ entries: readonly WhoLocalEntry[]; partial: boolean; fetchedAt: number; expiresAt: number; bytes: number }>;
const encoder = new TextEncoder();
const MAX_KEYS = 256, MAX_CACHE_BYTES = 4 * 1024 * 1024;

function configuration(read: Sources['readEnvironment']): Config {
    try {
        if (read('MEDIFLOW_ICD_WHO_ENABLED') !== '1') return { enabled: false, imageDigest: null, datasetSnapshotId: null };
        const image = read('MEDIFLOW_ICD_WHO_LOCAL_IMAGE_DIGEST');
        const dataset = read('MEDIFLOW_ICD_WHO_LOCAL_DATASET_ID');
        return { enabled: true, imageDigest: isWhoArtifactDigest(image) ? image : null,
            datasetSnapshotId: isWhoArtifactDigest(dataset) ? dataset : null };
    } catch { return { enabled: false, imageDigest: null, datasetSnapshotId: null }; }
}

function normalizedQuery(value: string): string {
    if (typeof value !== 'string') throw new Icd11WhoServiceError('input_invalid');
    const query = value.trim().replace(/\s+/gu, ' ');
    if (!query || /[\u0000-\u001f\u007f<>\u202a-\u202e\u2066-\u2069]/u.test(query)
        || encoder.encode(query).byteLength > ICD11_WHO_BINDING.queryMaxBytes) throw new Icd11WhoServiceError('input_invalid');
    return query;
}

function parseResponse(response: Awaited<ReturnType<WhoLocalTransport>>) {
    if (!response || response.status !== 200) throw new Icd11WhoServiceError('upstream_unavailable');
    if (typeof response.body !== 'string' || encoder.encode(response.body).byteLength > ICD11_WHO_BINDING.maxResponseBytes) {
        throw new Icd11WhoServiceError('response_invalid');
    }
    let raw: Record<string, unknown>;
    try { raw = JSON.parse(response.body); } catch { throw new Icd11WhoServiceError('response_invalid'); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.destinationEntities)) {
        throw new Icd11WhoServiceError('response_invalid');
    }
    const uris = new Set<string>(), codes = new Set<string>();
    const entries: WhoLocalEntry[] = [];
    // The byte cap bounds the whole response. Validate every batch, including
    // omitted entries, without widening the historical parser's output contract.
    for (let offset = 0; offset < Math.max(raw.destinationEntities.length, 1); offset += ICD11_WHO_BINDING.resultLimit) {
        const batch = raw.destinationEntities.slice(offset, offset + ICD11_WHO_BINDING.resultLimit);
        const checked = parseIcd11WhoOfficialSearchBody(JSON.stringify({ ...raw, destinationEntities: batch }));
        if (!checked) throw new Icd11WhoServiceError('response_invalid');
        for (const [index, entry] of checked.entries.entries()) {
            const uri = resolveWhoSearchReference(batch[index]?.id, entry.code);
            if (!uri || uris.has(uri) || codes.has(entry.code)
                || entry.description.length > 4096 || entry.code === 'N/A') throw new Icd11WhoServiceError('response_invalid');
            uris.add(uri); codes.add(entry.code);
            if (entries.length < ICD11_WHO_BINDING.resultLimit) entries.push(Object.freeze({ ...entry, system: 'ICD-11', canonicalUri: uri }));
        }
    }
    return Object.freeze({ entries: Object.freeze(entries),
        partial: raw.resultChopped === true || raw.destinationEntities.length > ICD11_WHO_BINDING.resultLimit });
}

async function bounded<T>(work: Promise<T>, controller: AbortController, ms: number, timeout: Icd11WhoServiceErrorCode): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort!: () => void;
    const interrupted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new Icd11WhoServiceError(controller.signal.reason === timeout ? timeout : 'request_cancelled'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
        if (controller.signal.aborted) onAbort();
        else timer = setTimeout(() => controller.abort(timeout), ms);
    });
    try { return await Promise.race([work, interrupted]); }
    finally { if (timer) clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort); }
}

/** Trusted server composition only; callers of Search supply just a terminology query. */
export function createIcd11WhoLocalRuntime(sources: Sources) {
    let config = configuration(sources.readEnvironment), generation = 0, disposed = false;
    let lastClock = 0, lastLive: number | null = null;
    let observed: 'configured' | 'available' | 'unavailable' = 'configured';
    let lastResultSource: 'live' | 'cache' | null = null;
    const active = new Set<AbortController>();
    const cache = new Map<string, Cached>();
    let cacheBytes = 0;
    const invalidate = () => {
        generation++; cache.clear(); cacheBytes = 0; lastLive = null;
        observed = 'configured'; lastResultSource = null;
        for (const controller of active) controller.abort('request_cancelled');
    };
    const sync = () => {
        if (disposed) throw new Icd11WhoServiceError('service_disposed');
        const next = configuration(sources.readEnvironment);
        if (next.enabled !== config.enabled || next.imageDigest !== config.imageDigest
            || next.datasetSnapshotId !== config.datasetSnapshotId) { invalidate(); config = next; }
    };
    const clock = () => {
        const now = sources.now();
        if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000 - WHO_LOCAL_TTL_MS) {
            invalidate(); throw new Icd11WhoServiceError('runtime_state_invalid');
        }
        if (now < lastClock) invalidate();
        lastClock = now;
        return now;
    };
    const gate = () => {
        sync();
        if (!config.enabled) throw new Icd11WhoServiceError('egress_disabled');
        if (!config.imageDigest || !config.datasetSnapshotId) throw new Icd11WhoServiceError('runtime_state_invalid');
    };
    const current = (revision: number, controller?: AbortController) => {
        sync();
        if (revision !== generation || controller?.signal.aborted) throw new Icd11WhoServiceError('request_cancelled');
        gate();
    };
    const remove = (key: string) => { const entry = cache.get(key); if (entry) cacheBytes -= entry.bytes; cache.delete(key); };
    const readiness = (): WhoLocalReadiness => {
        sync(); const now = clock();
        const status = !config.enabled ? 'disabled' : !config.imageDigest || !config.datasetSnapshotId
            ? 'configuration_required' : observed === 'available' && (lastLive === null || now >= lastLive + WHO_LOCAL_TTL_MS)
                ? 'configured' : observed;
        return Object.freeze({ schemaVersion: 'mediflow.reference-data.icd11-who-readiness.v2', status,
            releaseId: '2026-01', language: 'en', deployment: 'local', bindingId: WHO_LOCAL_BINDING_ID,
            imageDigest: config.imageDigest, datasetSnapshotId: config.datasetSnapshotId,
            lastLiveObservedAt: lastLive === null ? null : new Date(lastLive).toISOString(), lastResultSource });
    };
    const search = async (value: string): Promise<WhoLocalSearchResult> => {
        const query = normalizedQuery(value); gate();
        const started = clock(), revision = generation;
        const key = `${WHO_LOCAL_BINDING_ID}|${config.imageDigest}|${config.datasetSnapshotId}|${query}`;
        for (const [oldKey, entry] of cache) if (entry.expiresAt <= started) remove(oldKey);
        let cached = cache.get(key);
        const controller = new AbortController(); active.add(controller);
        try {
            let result: Pick<Cached, 'entries' | 'partial' | 'fetchedAt' | 'expiresAt'>;
            const source = cached ? 'cache' as const : 'live' as const;
            if (cached) { cache.delete(key); cache.set(key, cached); result = cached; }
            else {
                let response: Awaited<ReturnType<WhoLocalTransport>>;
                try { response = await bounded(sources.transport(query, controller.signal), controller, ICD11_WHO_BINDING.timeoutMs, 'request_timeout'); }
                catch (error) {
                    if (error instanceof Icd11WhoServiceError) throw error;
                    throw new Icd11WhoServiceError('upstream_unavailable');
                }
                current(revision, controller);
                const parsed = parseResponse(response), fetchedAt = clock();
                result = { ...parsed, fetchedAt, expiresAt: fetchedAt + WHO_LOCAL_TTL_MS };
            }
            const completed = clock(); current(revision, controller);
            if (completed >= result.expiresAt) throw new Icd11WhoServiceError('response_invalid');
            const receipt: WhoLocalReceipt = Object.freeze({
                schemaVersion: 'mediflow.reference-data.icd11-search-receipt.v2', operation: 'mediflow.reference_data.icd11.search.v2',
                releaseId: '2026-01', language: 'en', deployment: 'local', bindingId: WHO_LOCAL_BINDING_ID,
                imageDigest: config.imageDigest!, datasetSnapshotId: config.datasetSnapshotId!, source,
                resultCount: result.entries.length, latencyMs: completed - started,
                fetchedAt: new Date(result.fetchedAt).toISOString(), expiresAt: new Date(result.expiresAt).toISOString(),
                completedAt: new Date(completed).toISOString(),
            });
            try { await bounded(Promise.resolve(sources.audit(receipt)), controller, ICD11_WHO_BINDING.auditTimeoutMs, 'audit_unavailable'); }
            catch (error) {
                if (error instanceof Icd11WhoServiceError && error.code === 'request_cancelled') throw error;
                throw new Icd11WhoServiceError('audit_unavailable');
            }
            const published = clock(); current(revision, controller);
            if (published >= result.expiresAt) throw new Icd11WhoServiceError('response_invalid');
            if (source === 'live') {
                const bytes = encoder.encode(JSON.stringify(result)).byteLength + encoder.encode(key).byteLength;
                while (cache.size >= MAX_KEYS || cacheBytes + bytes > MAX_CACHE_BYTES) {
                    const oldest = cache.keys().next().value;
                    if (oldest === undefined) break;
                    remove(oldest);
                }
                if (bytes <= MAX_CACHE_BYTES) {
                    remove(key); cached = Object.freeze({ ...result, bytes }); cache.set(key, cached); cacheBytes += bytes;
                }
                lastLive = result.fetchedAt; observed = 'available';
            }
            lastResultSource = source;
            return Object.freeze({ entries: result.entries, partial: result.partial, receipt });
        } catch (error) {
            if (revision === generation && !disposed) observed = 'unavailable';
            throw error;
        } finally { active.delete(controller); }
    };
    const dispose = () => { if (disposed) return false; disposed = true; invalidate(); return true; };
    return Object.freeze({ readiness, search, dispose });
}
export type Icd11WhoLocalRuntime = ReturnType<typeof createIcd11WhoLocalRuntime>;
