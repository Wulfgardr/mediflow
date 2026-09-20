/* @Codex — validate PNG pixels before native decoders can publish a blank success.
 * Stream/discard inflation; no full decompressed image buffer. Browser/native
 * decoder allocations remain outside a hard heap quota (see limits.md).
 */
import { assertImageSize, PreviewError, PREVIEW_LIMITS } from './document-viewer-policy.ts';
import { PreviewScope } from './document-viewer-scope.ts';

// BufferSource matches the DOM/Node20 DecompressionStream writable contract.
// Copy on demand: TS 5.9 can prove ArrayBuffer backing, and native inflation
// never retains a view into caller-owned bytes that are erased on retirement.
export function pngInputStream(parts: readonly Uint8Array[], signal: AbortSignal): ReadableStream<BufferSource> {
    let pending = parts;
    let index = 0, offset = 0;
    let owner: ReadableStreamDefaultController<BufferSource> | undefined;
    const release = () => {
        pending = [];
        owner = undefined;
        signal.removeEventListener('abort', abort);
    };
    const abort = () => {
        owner?.error(signal.reason);
        release();
    };
    return new ReadableStream<BufferSource>({
        start(controller) {
            owner = controller;
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
        },
        pull(controller) {
            if (signal.aborted) return;
            while (index < pending.length && offset === pending[index].length) { index++; offset = 0; }
            if (index === pending.length) { controller.close(); release(); return; }
            const part = pending[index];
            const end = Math.min(part.length, offset + PREVIEW_LIMITS.decodeChunk);
            controller.enqueue(new Uint8Array(part.subarray(offset, end)));
            offset = end;
        },
        cancel() { release(); },
    }, { highWaterMark: 0 }); // no eager/prefetched whole-IDAT copy
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
});
export async function validatePngPixels(bytes: Uint8Array, scope: PreviewScope): Promise<void> {
    const bad = () => new PreviewError('invalid_image');
    scope.check();
    if (bytes.length < 45 || bytes.length > PREVIEW_LIMITS.sourceBytes) throw bad();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16), height = view.getUint32(20);
    assertImageSize(width, height);
    const bits = bytes[24], color = bytes[25], interlace = bytes[28];
    const allowed: Record<number, readonly number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
    if (!allowed[color]?.includes(bits) || bytes[26] !== 0 || bytes[27] !== 0 || interlace > 1) throw bad();
    const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
    // Adam7 passes, or the single non-interlaced pass. Each row has one filter byte.
    const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
    const rows: { size: number; count: number }[] = [];
    for (const [x, y, dx, dy] of passes) {
        const w = Math.max(0, Math.ceil((width - x) / dx)), h = Math.max(0, Math.ceil((height - y) / dy));
        if (w && h) rows.push({ size: 1 + Math.ceil(w * bits * channels[color] / 8), count: h });
    }
    const expected = rows.reduce((sum, row) => sum + row.size * row.count, 0);
    // At most 8 bytes/pixel plus bounded scanline/filter overhead.
    if (expected > PREVIEW_LIMITS.imagePixels * 8 + PREVIEW_LIMITS.imageDimension * 7) throw new PreviewError('image_limit');
    const parts: Uint8Array[] = [];
    let scanned = 0, chunks = 0, seenData = false, dataEnded = false;
    for (let at = 8; at < bytes.length;) {
        scope.check();
        if (++chunks > 4096) throw new PreviewError('image_limit');
        if (at + 12 > bytes.length) throw bad();
        const length = view.getUint32(at), end = at + length + 12;
        if (end > bytes.length) throw bad();
        let crc = 0xffffffff;
        for (let pos = at + 4; pos < end - 4; pos++) {
            crc = crcTable[(crc ^ bytes[pos]) & 255] ^ (crc >>> 8);
            if (++scanned % PREVIEW_LIMITS.decodeChunk === 0) await scope.yield();
        }
        if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(end - 4)) throw bad();
        const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
        if (type === 'IDAT') {
            if (dataEnded) throw bad();
            seenData = true;
            parts.push(bytes.subarray(at + 8, end - 4));
        } else if (seenData) dataEnded = true;
        at = end;
    }
    if (!seenData || typeof DecompressionStream === 'undefined') throw new PreviewError(!seenData ? 'invalid_image' : 'runtime_unavailable');
    const decompressor = new DecompressionStream('deflate');
    const reader = decompressor.readable.getReader();
    const owner = new AbortController();
    const removeAbort = scope.onAbort(() => owner.abort(scope.signal.reason));
    // Separate typed pump rather than an invariant pipeThrough<Uint8Array>.
    // Observe rejection immediately, and check it before publishing success.
    const pumped = pngInputStream(parts, owner.signal).pipeTo(decompressor.writable, { signal: owner.signal }).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
    );
    let total = 0, pass = 0, rowCount = 0, rowOffset = 0;
    try {
        for (;;) {
            const { done, value } = await scope.wait(reader.read());
            if (done) break;
            total += value.length;
            if (total > expected) throw bad();
            // Check filters without examining or retaining every pixel sample.
            for (let at = 0; at < value.length;) {
                const row = rows[pass];
                if (!row || (rowOffset === 0 && value[at] > 4)) throw bad();
                const take = Math.min(value.length - at, row.size - rowOffset);
                at += take; rowOffset += take;
                if (rowOffset === row.size) {
                    rowOffset = 0;
                    if (++rowCount === row.count) { pass++; rowCount = 0; }
                }
            }
            scope.check();
            if (total % (1024 * 1024) < value.length) await scope.yield();
        }
        const outcome = await scope.wait(pumped);
        if (!outcome.ok) throw outcome.error;
        scope.check();
        if (total !== expected || pass !== rows.length || rowOffset !== 0) throw bad();
    } catch (error) {
        throw error instanceof PreviewError ? error : bad();
    } finally {
        // Both directions stop on every terminal path, including invalid scanline
        // and output-limit errors. Do not await an unbounded native handshake.
        owner.abort();
        void reader.cancel().catch(() => undefined);
        reader.releaseLock();
        removeAbort();
        parts.length = 0;
    }
}
