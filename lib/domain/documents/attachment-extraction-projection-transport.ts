/* @Codex */
import { ATTACHMENT_EXTRACTION_MAX_SOURCE_BYTES } from './attachment-extraction-projection-protocol';

/** Browser projections never leave the local authenticated application's origin. No forwarded-header trust. */
export function isLocalAttachmentExtractionRequest(request: Request): boolean {
    try {
        const url = new URL(request.url);
        const loopback = (value: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(value.hostname);
        // Next constructs request.url with its internal localhost hostname. Bind the
        // browser Origin to the actual Host header, never X-Forwarded-Host/Origin.
        const host = request.headers.get('host');
        const publicUrl = host === null ? url : new URL(`${url.protocol}//${host}`);
        return (url.protocol === 'http:' || url.protocol === 'https:') && loopback(url) && loopback(publicUrl)
            && (host === null || publicUrl.host === host) && publicUrl.port === url.port
            && request.headers.get('origin') === publicUrl.origin
            && (!request.headers.has('sec-fetch-site') || request.headers.get('sec-fetch-site') === 'same-origin')
            && !request.headers.has('content-encoding');
    } catch { return false; }
}

type LiveRead = Readonly<{ signal: AbortSignal; current: () => boolean }>;
/** The sole allocation is bounded even with missing/lying Content-Length or a chunked request. */
export async function readAttachmentExtractionProjectionBytes(request: Request, use: LiveRead): Promise<Uint8Array | null> {
    if (request.headers.get('content-type') !== 'application/octet-stream' || !request.body
        || request.signal.aborted || use.signal.aborted || !use.current()) return null;
    const rawLength = request.headers.get('content-length');
    let declared: number | null = null;
    if (rawLength !== null) {
        if (!/^[1-9][0-9]*$/u.test(rawLength)) return null;
        declared = Number(rawLength);
        if (!Number.isSafeInteger(declared) || declared > ATTACHMENT_EXTRACTION_MAX_SOURCE_BYTES) return null;
    }
    const reader = request.body.getReader();
    const bytes = new Uint8Array(declared ?? ATTACHMENT_EXTRACTION_MAX_SOURCE_BYTES);
    let length = 0; let delivered = false;
    const cancelled = () => request.signal.aborted || use.signal.aborted || !use.current();
    const cancel = () => { bytes.fill(0); void reader.cancel().catch(() => {}); };
    request.signal.addEventListener('abort', cancel, { once: true });
    use.signal.addEventListener('abort', cancel, { once: true });
    try {
        while (true) {
            if (cancelled()) return null;
            const next = await reader.read();
            if (cancelled()) return null;
            if (next.done) break;
            if (!(next.value instanceof Uint8Array) || next.value.byteLength > bytes.byteLength - length) return null;
            bytes.set(next.value, length); length += next.value.byteLength;
        }
        if (!length || (declared !== null && length !== declared) || cancelled()) return null;
        delivered = true; return bytes.subarray(0, length);
    } catch { return null; }
    finally {
        request.signal.removeEventListener('abort', cancel); use.signal.removeEventListener('abort', cancel);
        if (!delivered) { bytes.fill(0); void reader.cancel().catch(() => {}); }
        reader.releaseLock();
    }
}

/** Next's adapter may expose an empty stream instead of body=null for an empty POST/DELETE. */
export async function hasEmptyAttachmentExtractionBody(request: Request): Promise<boolean> {
    if (request.signal.aborted || (request.headers.has('content-length') && request.headers.get('content-length') !== '0')) return false;
    if (!request.body) return true;
    const reader = request.body.getReader();
    const timeout = AbortSignal.timeout(2000);
    const cancel = () => { void reader.cancel().catch(() => {}); };
    timeout.addEventListener('abort', cancel, { once: true }); request.signal.addEventListener('abort', cancel, { once: true });
    try {
        for (let count = 0; count < 16; count += 1) {
            if (timeout.aborted || request.signal.aborted) return false;
            const next = await reader.read();
            if (timeout.aborted || request.signal.aborted) return false;
            if (next.done) return true;
            if (next.value.byteLength !== 0) return false;
        }
        return false;
    } catch { return false; }
    finally { timeout.removeEventListener('abort', cancel); request.signal.removeEventListener('abort', cancel); cancel(); reader.releaseLock(); }
}
