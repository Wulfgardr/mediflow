import { WHO_CATALOG_URL, WHO_CATALOG_MAX_BYTES, WhoCatalogError } from './icd11-embedded-parser';

export const WHO_DOWNLOAD_TIMEOUT_MS = 60_000;
let active = false;
async function interrupted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    let onAbort!: () => void;
    const stopped = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
    });
    try { return await Promise.race([promise, stopped]); }
    finally { signal.removeEventListener('abort', onAbort); }
}
const dispose = (stream?: { cancel(): Promise<unknown> } | null) => { try { void stream?.cancel().catch(() => undefined); } catch {} };
export async function downloadWhoCatalog<T>(signal: AbortSignal,
    consume: (original: Uint8Array, assertCurrent: () => void) => T,
    transport: typeof fetch = fetch, timeoutMs = WHO_DOWNLOAD_TIMEOUT_MS): Promise<T> {
    if (active) throw new WhoCatalogError('Aggiornamento WHO già in corso', 409);
    active = true;
    const controller = new AbortController(), deadline = Date.now() + timeoutMs;
    const cancel = () => controller.abort(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    const timer = setTimeout(() => controller.abort(new WhoCatalogError('Tempo di download WHO scaduto', 504)), timeoutMs);
    let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const assertCurrent = () => { controller.signal.throwIfAborted(); if (Date.now() >= deadline) throw new WhoCatalogError('Tempo di download WHO scaduto', 504); };
    try {
        assertCurrent();
        const downloaded = await interrupted<Response>(transport(WHO_CATALOG_URL, { method: 'GET', redirect: 'error', credentials: 'omit',
            cache: 'no-store', headers: { Accept: 'application/zip', 'Accept-Encoding': 'identity' }, signal: controller.signal })
            .then(value => { if (controller.signal.aborted) { dispose(value.body); throw controller.signal.reason; } return value; }), controller.signal);
        response = downloaded;
        assertCurrent();
        if (downloaded.status !== 200 || downloaded.redirected || (downloaded.url && downloaded.url !== WHO_CATALOG_URL)
            || !downloaded.body) throw new WhoCatalogError('Risposta della fonte WHO non valida', 502);
        const type = downloaded.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
        if (!type || !['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(type)) throw new WhoCatalogError('La WHO non ha restituito un archivio ZIP');
        const length = downloaded.headers.get('content-length');
        if (length && (!/^\d+$/u.test(length) || Number(length) > WHO_CATALOG_MAX_BYTES)) throw new WhoCatalogError('Archivio WHO oltre il limite di 16 MiB', 413);
        reader = downloaded.body.getReader();
        const chunks: Uint8Array[] = []; let size = 0;
        while (true) {
            assertCurrent();
            const chunk = await interrupted(reader.read(), controller.signal);
            assertCurrent();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > WHO_CATALOG_MAX_BYTES) throw new WhoCatalogError('Archivio WHO oltre il limite di 16 MiB', 413);
            chunks.push(chunk.value);
        }
        if (!size || (length !== null && Number(length) !== size)) throw new WhoCatalogError('Archivio WHO vuoto o troncato');
        const original = Buffer.concat(chunks);
        if (original[0] !== 0x50 || original[1] !== 0x4b) throw new WhoCatalogError('Formato WHO non riconosciuto: atteso ZIP');
        assertCurrent();
        return consume(original, assertCurrent);
    } catch (error) {
        if (error instanceof WhoCatalogError || controller.signal.aborted) throw controller.signal.reason ?? error;
        throw new WhoCatalogError('Download WHO non riuscito. Il catalogo precedente è conservato.', 502);
    } finally {
        clearTimeout(timer); controller.abort(); dispose(reader ?? response?.body);
        try { reader?.releaseLock(); } catch {}
        signal.removeEventListener('abort', cancel); active = false;
    }
}
