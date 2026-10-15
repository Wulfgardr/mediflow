/* @Codex */
import { createHash } from 'node:crypto';
import { aifaConditionalHeaders, aifaSourceMetadata, type AifaCatalogManifestInput, type AifaSourceMetadata } from './aifa-catalog';
import { acquireAifaCatalogOperation, AifaUpdateError } from './aifa-catalog-lock';
export { AifaUpdateError, AifaReductionError } from './aifa-catalog-lock';

import { AIFA_DOWNLOAD_URL, AIFA_DOWNLOAD_MAX_BYTES } from './aifa-catalog';
export { AIFA_DOWNLOAD_URL, AIFA_DOWNLOAD_MAX_BYTES } from './aifa-catalog';
export const AIFA_DOWNLOAD_TIMEOUT_MS = 180_000;

export type AifaDownloadProgress = { receivedBytes: number; totalBytes: number | null; phase: 'downloading' | 'validating' };
let progress: AifaDownloadProgress | null = null;
export function getAifaDownloadProgress(): AifaDownloadProgress | null { return progress; }

// A producer may take indefinitely to finish cancellation. Observe failures, but
// do not let disposal retain single-flight or replace the original outcome.
function cancelQuietly(stream: { cancel(): Promise<void> } | null | undefined): void {
    try { void stream?.cancel().catch(() => undefined); } catch { /* Best-effort disposal. */ }
}

async function interruptible<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    let onAbort!: () => void;
    const interrupted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
    });
    try { return await Promise.race([work, interrupted]); }
    finally { signal.removeEventListener('abort', onAbort); }
}

// The lock and deadline include validation and replacement, not just response headers.
export async function withAifaDownload<T>(
    signal: AbortSignal,
    consume: (file: File, acquisition: AifaCatalogManifestInput, signal: AbortSignal, assertDeadline: () => void) => Promise<T>,
    transport: typeof fetch = fetch,
    options: { validators?: AifaSourceMetadata; notModified?: (assertDeadline: () => void) => Promise<T>; assertAllowed?: () => void } = {},
): Promise<T> {
    const release = acquireAifaCatalogOperation();
    progress = { receivedBytes: 0, totalBytes: null, phase: 'downloading' };
    const controller = new AbortController();
    const cancel = () => controller.abort(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    const deadline = Date.now() + AIFA_DOWNLOAD_TIMEOUT_MS;
    const assertDeadline = () => {
        controller.signal.throwIfAborted();
        if (Date.now() >= deadline) throw new AifaUpdateError('Tempo di aggiornamento AIFA scaduto', 504);
    };
    const timer = setTimeout(() => controller.abort(new AifaUpdateError('Tempo di aggiornamento AIFA scaduto', 504)), AIFA_DOWNLOAD_TIMEOUT_MS);
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
        controller.signal.throwIfAborted();
        options.assertAllowed?.();
        const downloaded = await interruptible(transport(AIFA_DOWNLOAD_URL, {
            method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store',
            headers: { Accept: 'text/csv', 'Accept-Encoding': 'identity', ...aifaConditionalHeaders(options.validators ?? {}) },
            signal: controller.signal,
        }).then((received) => {
            // Also dispose responses delivered *after* this update has settled.
            if (controller.signal.aborted) {
                cancelQuietly(received.body);
                throw controller.signal.reason;
            }
            response = received; // Cleanup still owns it if abort wins the await.
            return received;
        }), controller.signal);
        if (downloaded.redirected || (downloaded.url && downloaded.url !== AIFA_DOWNLOAD_URL)) {
            throw new AifaUpdateError('Risposta della fonte AIFA non valida', 502);
        }
        if (downloaded.status === 304) {
            if (!options.notModified || (!options.validators?.etag && !options.validators?.lastModified)) {
                throw new AifaUpdateError('Risposta AIFA senza una versione locale confrontabile', 502);
            }
            options.assertAllowed?.();
            assertDeadline();
            return await options.notModified(assertDeadline);
        }
        reader = downloaded.body?.getReader();
        controller.signal.throwIfAborted();
        if (downloaded.status !== 200 || !reader || downloaded.redirected
            || (downloaded.url && downloaded.url !== AIFA_DOWNLOAD_URL)) {
            throw new AifaUpdateError('Risposta della fonte AIFA non valida', 502);
        }
        const contentType = downloaded.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
        if (!contentType || !['text/csv', 'application/csv', 'text/plain', 'application/octet-stream'].includes(contentType)) {
            throw new AifaUpdateError('La fonte AIFA non ha restituito un CSV', 422);
        }
        const length = downloaded.headers.get('content-length');
        if (length && (!/^\d+$/.test(length) || Number(length) > AIFA_DOWNLOAD_MAX_BYTES)) {
            throw new AifaUpdateError('File AIFA superiore a 100 MiB', 413);
        }
        progress = { receivedBytes: 0, totalBytes: length ? Number(length) : null, phase: 'downloading' };
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let size = 0;
        while (true) {
            controller.signal.throwIfAborted();
            const chunk = await interruptible(reader.read(), controller.signal);
            controller.signal.throwIfAborted();
            if (chunk.done) break;
            options.assertAllowed?.();
            size += chunk.value.byteLength;
            progress = { ...progress, receivedBytes: size };
            if (size > AIFA_DOWNLOAD_MAX_BYTES) throw new AifaUpdateError('File AIFA superiore a 100 MiB', 413);
            chunks.push(new Uint8Array(chunk.value));
        }
        if (length && size !== Number(length)) throw new AifaUpdateError('Download AIFA incompleto: dimensione diversa da quella dichiarata; catalogo conservato', 422);
        progress = { ...progress, phase: 'validating' };
        if (!size) throw new AifaUpdateError('File AIFA vuoto', 422);
        const file = new File(chunks, 'confezioni_fornitura.csv', { type: 'text/csv' });
        const hash = createHash('sha256');
        for (const chunk of chunks) hash.update(chunk);
        const acquiredAt = new Date().toISOString();
        if (Date.now() >= deadline) throw new AifaUpdateError('Tempo di aggiornamento AIFA scaduto', 504);
        controller.signal.throwIfAborted();
        // Do not race a consumer: it may be inside the guarded transaction. Keep
        // single-flight until it has returned/rolled back, using assertDeadline.
        return await consume(file, {
            ...aifaSourceMetadata(downloaded.headers),
            sourceUrl: AIFA_DOWNLOAD_URL,
            downloadedAt: acquiredAt.slice(0, 10),
            version: `acquisizione-${acquiredAt}-${hash.digest('hex').slice(0, 16)}`,
        }, controller.signal, assertDeadline);
    } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason;
        throw error;
    } finally {
        try {
            controller.abort();
            cancelQuietly(reader ?? response?.body);
            try { reader?.releaseLock(); } catch { /* Never mask the update outcome. */ }
        } finally {
            clearTimeout(timer);
            signal.removeEventListener('abort', cancel);
            progress = null;
            release();
        }
    }
}
