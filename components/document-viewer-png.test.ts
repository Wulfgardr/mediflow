/* @Codex — generated in-memory PNGs, no fixtures/patient data/dependency installs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { pngInputStream, validatePngPixels } from './document-viewer-png.ts';
import { PreviewScope } from './document-viewer-scope.ts';
import { PREVIEW_LIMITS, PreviewError } from './document-viewer-policy.ts';

function chunk(type: string, data: Uint8Array) {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    const output = Buffer.alloc(body.length + 8);
    output.writeUInt32BE(data.length); body.copy(output, 4); output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, body.length + 4);
    return output;
}
function png(raw = Buffer.from([0, 255, 0, 0, 255]), compressed?: Buffer, interlace = 0) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6; header[12] = interlace;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', compressed ?? deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
async function validate(bytes: Uint8Array, signal = new AbortController().signal) {
    const scope = new PreviewScope(signal, 1000);
    try { await validatePngPixels(bytes, scope); } finally { scope.finish(); }
}
test('valid non-interlaced PNG consumes exactly its scanline bytes', async () => { await validate(png()); });
test('valid 1x1 Adam7 PNG accounts for empty passes', async () => { await validate(png(undefined, undefined, 1)); });
test('header-valid PNG with invalid zlib never becomes a blank success', async () => {
    await assert.rejects(validate(png(undefined, Buffer.from('not-zlib'))), { code: 'invalid_image' });
});
test('inflation beyond dimension-derived bytes is rejected', async () => {
    await assert.rejects(validate(png(Buffer.alloc(1024 * 1024))), { code: 'invalid_image' });
});
test('truncated inflated scanline is rejected', async () => {
    await assert.rejects(validate(png(Buffer.from([0, 255]))), { code: 'invalid_image' });
});
test('invalid PNG filter is rejected', async () => {
    await assert.rejects(validate(png(Buffer.from([5, 255, 0, 0, 255]))), { code: 'invalid_image' });
});
test('CRC mismatch rejected before native decoder', async () => {
    const bytes = png(); bytes[29] ^= 1;
    await assert.rejects(validate(bytes), { code: 'invalid_image' });
});
test('PNG validation observes an already cancelled owner', async () => {
    const c = new AbortController(); c.abort();
    await assert.rejects(validate(png(), c.signal), { code: 'cancelled' });
});


test('PNG bridge provides bounded ArrayBuffer-owned copies, never shared source views', async () => {
    const source = new Uint8Array(PREVIEW_LIMITS.decodeChunk + 17).fill(123);
    const stream = pngInputStream([new Uint8Array(0), source], new AbortController().signal);
    const reader = stream.getReader();
    try {
        const first = await reader.read();
        assert.ok(first.value instanceof Uint8Array);
        assert.ok(first.value.buffer instanceof ArrayBuffer);
        assert.notEqual(first.value.buffer, source.buffer);
        assert.equal(first.value.byteLength, PREVIEW_LIMITS.decodeChunk);
        first.value.fill(0); assert.equal(source[0], 123);
        source[PREVIEW_LIMITS.decodeChunk] = 42; // no eager second copy
        const second = await reader.read();
        assert.ok(second.value instanceof Uint8Array);
        assert.equal(second.value.byteLength, 17); assert.equal(second.value[0], 42);
        assert.equal((await reader.read()).done, true);
    } finally { reader.releaseLock(); }
});
test('PNG bridge copies SharedArrayBuffer-backed views into ordinary ArrayBuffers', async () => {
    const source = new Uint8Array(new SharedArrayBuffer(8)).fill(23);
    const reader = pngInputStream([source], new AbortController().signal).getReader();
    try {
        const { value } = await reader.read();
        assert.ok(value instanceof Uint8Array);
        assert.ok(value.buffer instanceof ArrayBuffer);
        source.fill(0); assert.equal(value[0], 23);
        await reader.cancel();
    } finally { reader.releaseLock(); }
});
test('PNG bridge observes pre-abort, abort between reads, and consumer cancellation', async () => {
    const a = new AbortController(); a.abort(new PreviewError('cancelled'));
    const pre = pngInputStream([new Uint8Array([1])], a.signal).getReader();
    try { await assert.rejects(pre.read(), { code: 'cancelled' }); } finally { pre.releaseLock(); }
    const b = new AbortController();
    const stream = pngInputStream([new Uint8Array([1]), new Uint8Array([2])], b.signal);
    const reader = stream.getReader();
    try {
        await reader.read(); b.abort(new PreviewError('timeout'));
        await assert.rejects(reader.read(), { code: 'timeout' });
    } finally { reader.releaseLock(); }
    const c = new AbortController();
    const other = pngInputStream([new Uint8Array([1])], c.signal).getReader();
    await other.cancel(); c.abort();
    assert.equal((await other.read()).done, true); other.releaseLock();
    assert.equal(stream.locked, false);
});
for (const mode of ['success', 'invalid-output', 'invalid-deflate', 'abort', 'timeout'] as const) {
    test(`PNG native pipeline releases both locks on ${mode}`, async (t) => {
        const original = globalThis.DecompressionStream;
        const streams: DecompressionStream[] = [];
        const owner = new AbortController();
        class ObservedDecompressionStream extends original {
            constructor(format: CompressionFormat) {
                super(format); streams.push(this);
                if (mode === 'abort' || mode === 'timeout') {
                    queueMicrotask(() => owner.abort(new PreviewError(mode === 'abort' ? 'cancelled' : 'timeout')));
                }
            }
        }
        Object.defineProperty(globalThis, 'DecompressionStream', { configurable: true, writable: true, value: ObservedDecompressionStream });
        t.after(() => { Object.defineProperty(globalThis, 'DecompressionStream', { configurable: true, writable: true, value: original }); });
        const bytes = mode === 'invalid-output' ? png(Buffer.from([5, 255, 0, 0, 255]))
            : mode === 'invalid-deflate' ? png(undefined, Buffer.from('bad-deflate')) : png();
        const originalBytes = Buffer.from(bytes);
        const work = validate(bytes, owner.signal);
        if (mode === 'success') await work;
        else await assert.rejects(work, { code: mode === 'abort' ? 'cancelled' : mode === 'timeout' ? 'timeout' : 'invalid_image' });
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(streams.length, 1);
        assert.equal(streams[0].readable.locked, false);
        assert.equal(streams[0].writable.locked, false);
        assert.deepEqual(bytes, originalBytes);
    });
}
