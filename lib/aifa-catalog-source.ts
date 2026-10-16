import { aifaConditionalHeaders, aifaSourceMetadata, type AifaCatalogManifest, type AifaSourceMetadata } from './aifa-catalog';
import { AIFA_DOWNLOAD_MAX_BYTES, AIFA_DOWNLOAD_URL } from './aifa-catalog';

export const AIFA_SOURCE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const AIFA_SOURCE_TIMEOUT_MS = 8_000;
export const AIFA_NETWORK_SETTING_KEY = 'aifaNetworkAccess';
export const AIFA_REMOTE_SETTING_KEY = 'aifaCatalogRemoteState';

export type AifaRemoteState = AifaSourceMetadata & {
    checkedAt: string | null;
    outcome: 'available' | 'unchanged' | 'unavailable';
    reason?: 'network_disabled' | 'busy' | 'checking' | 'source_unavailable' | 'metadata_absent' | 'local_metadata_absent';
};

export function compareAifaSource(remote: AifaRemoteState, manifest: AifaCatalogManifest | null, count: number): AifaRemoteState {
    if (remote.outcome === 'unavailable') return remote;
    if (!count) return { ...remote, outcome: 'available' };
    if (!manifest || manifest.sourceUrl !== AIFA_DOWNLOAD_URL) return { ...remote, outcome: 'unavailable', reason: 'local_metadata_absent' };
    const comparable = remote.etag && manifest.etag ? remote.etag.replace(/^W\//, '') === manifest.etag.replace(/^W\//, '')
        : remote.lastModified && manifest.lastModified ? remote.lastModified === manifest.lastModified : null;
    return { ...remote, outcome: comparable === null ? 'unavailable' : comparable ? 'unchanged' : 'available',
        ...(comparable === null ? { reason: 'local_metadata_absent' as const } : {}) };
}

export async function readAifaSource(
    previous: AifaSourceMetadata,
    signal: AbortSignal,
    transport: typeof fetch = fetch,
): Promise<AifaSourceMetadata> {
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    let rejectAbort!: (reason: unknown) => void;
    const interrupted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    const onAbort = () => rejectAbort(controller.signal.reason);
    controller.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('AIFA_HEAD_TIMEOUT')), AIFA_SOURCE_TIMEOUT_MS);
    let response: Response | undefined;
    try {
        controller.signal.throwIfAborted();
        response = await Promise.race([transport(AIFA_DOWNLOAD_URL, {
            method: 'HEAD', redirect: 'error', credentials: 'omit', cache: 'no-store',
            headers: { Accept: 'text/csv', 'Accept-Encoding': 'identity', ...aifaConditionalHeaders(previous) }, signal: controller.signal,
        }).then(received => {
            if (controller.signal.aborted) { void received.body?.cancel().catch(() => undefined); throw controller.signal.reason; }
            return received;
        }), interrupted]);
        controller.signal.throwIfAborted();
        if (response.redirected || (response.url && response.url !== AIFA_DOWNLOAD_URL)) throw new Error('AIFA_HEAD_REDIRECT');
        if (response.status !== 200 && response.status !== 304) throw new Error('AIFA_HEAD_STATUS');
        const metadata = aifaSourceMetadata(response.headers);
        const result = response.status === 304 ? { ...previous, ...metadata } : metadata;
        if ((!result.etag && !result.lastModified) || (result.contentLength !== undefined
            && (result.contentLength < 1 || result.contentLength > AIFA_DOWNLOAD_MAX_BYTES))) throw new Error('AIFA_HEAD_METADATA');
        if (response.status === 304 && !previous.etag && !previous.lastModified) throw new Error('AIFA_HEAD_UNBOUND_304');
        return result;
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        controller.signal.removeEventListener('abort', onAbort);
        void response?.body?.cancel().catch(() => undefined);
        controller.abort();
    }
}
