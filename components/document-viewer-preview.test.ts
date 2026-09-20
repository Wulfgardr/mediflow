/* @Codex — synthetic fixtures only; run with Node strip-types, no DB imports. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_PREVIEW_BYTES, PREVIEW_LIMITS, PreviewError, textWindow, previewFailure } from './document-viewer-policy.ts';
import { readDocumentPreview, releaseDocumentPreview } from './document-viewer-preview.ts';
import { inspectRaster } from './document-viewer-image-header.ts';

const signal = () => new AbortController().signal;
const data = (bytes: Uint8Array, type = 'text/plain') => `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
const fails = (code: string) => (error: unknown) => error instanceof PreviewError && error.code === code;

for (const size of [20 * 1024 * 1024, 20 * 1024 * 1024 + 1, 25 * 1024 * 1024, 25 * 1024 * 1024 + 1]) {
    for (const form of ['Blob', 'base64'] as const) {
        test(`${form}: exact decoded-byte boundary ${size}`, async () => {
            const bytes = new Uint8Array(size).fill(97);
            const file = form === 'Blob' ? new Blob([bytes], { type: 'text/plain' }) : data(bytes);
            if (size > MAX_PREVIEW_BYTES) await assert.rejects(readDocumentPreview(file, signal()), fails('size_limit'));
            else {
                const preview = await readDocumentPreview(file, signal());
                assert.equal(preview.kind, 'text');
                if (preview.kind === 'text') assert.equal(preview.text.length, size);
            }
            assert.equal(bytes[0], 97); assert.equal(bytes[size - 1], 97);
            if (file instanceof Blob) assert.equal(await file.slice(size - 1).text(), 'a');
        });
    }
}
test('malformed oversized base64 is NOT a valid size-limit result', async () => {
    const file = data(new Uint8Array(MAX_PREVIEW_BYTES + 1).fill(97));
    await assert.rejects(readDocumentPreview(`${file.slice(0, -5)}!${file.slice(-4)}`, signal()), fails('invalid_base64'));
});
test('exact over-limit explanation and typed errors are stable', () => {
    assert.equal(previewFailure(new PreviewError('size_limit')).message,
        'Il documento supera il limite di 25 MiB per l’anteprima. L’allegato non è stato modificato.');
    assert.ok(!previewFailure(new Error('SYNTHETIC_SECRET')).message.includes('SYNTHETIC_SECRET'));
});
test('strict UTF-8 stays literal; empty text and BOM are valid', async () => {
    const literal = '<b>Documento sintetico</b>\n<script>non eseguire</script> € à 🧪';
    for (const file of [new Blob([literal], { type: 'text/plain;charset=utf-8' }), data(new TextEncoder().encode(literal), 'text/plain;charset=UTF-8')]) {
        assert.deepEqual(await readDocumentPreview(file, signal()), { kind: 'text', text: literal });
    }
    assert.deepEqual(await readDocumentPreview('data:text/plain;base64,', signal()), { kind: 'text', text: '' });
    assert.deepEqual(await readDocumentPreview(data(new Uint8Array([239, 187, 191])), signal()), { kind: 'text', text: '' });
});
test('malformed UTF-8/control bytes are rejected separately', async () => {
    for (const bytes of [new Uint8Array([0xc3, 0x28]), new Uint8Array([0]), new Uint8Array([0xf4, 0x90, 0x80, 0x80])]) {
        await assert.rejects(readDocumentPreview(data(bytes), signal()), fails('invalid_utf8'));
    }
});
test('no URL, HTML/SVG renderer, missing MIME or filename-based admission', async () => {
    for (const input of ['https://example.invalid/test.pdf', '/api/document', 'blob:made-up', 'raw-base64']) {
        await assert.rejects(readDocumentPreview(input, signal()), fails('invalid_source'));
    }
    for (const type of ['text/html', 'image/svg+xml', 'application/octet-stream', 'image/avif']) {
        await assert.rejects(readDocumentPreview(data(new TextEncoder().encode('fixture'), type), signal()), fails('unsupported_type'));
    }
    await assert.rejects(readDocumentPreview(new Blob(['fixture']), signal()), fails('unsupported_type'));
});
test('base64 grammar, canonical padding and UTF-8 declaration', async () => {
    for (const payload of ['YQ=', 'YR==', 'YWJ=', 'Y Q==', 'YQ===', '====', 'YQ==!', 'YQ%3D%3D']) {
        await assert.rejects(readDocumentPreview(`data:text/plain;base64,${payload}`, signal()), fails('invalid_base64'));
    }
    assert.deepEqual(await readDocumentPreview('data:text/plain;base64,YQ==', signal()), { kind: 'text', text: 'a' });
    await assert.rejects(readDocumentPreview('data:text/plain;charset=latin1;base64,YQ==', signal()), fails('unsupported_type'));
});
test('MIME/magic mismatch cannot select a binary renderer', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7\nsynthetic');
    await assert.rejects(readDocumentPreview(data(pdf), signal()), fails('mime_mismatch'));
    await assert.rejects(readDocumentPreview(data(new TextEncoder().encode('literal'), 'application/pdf'), signal()), fails('mime_mismatch'));
    const preview = await readDocumentPreview(data(pdf, 'application/pdf'), signal());
    assert.equal(preview.kind, 'pdf');
    releaseDocumentPreview(preview);
    if (preview.kind === 'pdf') assert.equal(preview.bytes.every((value) => value === 0), true);
    assert.equal(pdf[0], 37);
});
test('abort before decoding and during chunked base64', async () => {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(readDocumentPreview('data:text/plain;base64,YQ==', controller.signal), fails('cancelled'));
    const second = new AbortController();
    const work = readDocumentPreview(data(new Uint8Array(PREVIEW_LIMITS.decodeChunk * 2).fill(97)), second.signal);
    second.abort();
    await assert.rejects(work, fails('cancelled'));
});
test('text windows bound DOM work and never split surrogate pairs', () => {
    const original = 'a'.repeat(PREVIEW_LIMITS.textWindow - 1) + '🧪' + 'b'.repeat(PREVIEW_LIMITS.textWindow + 1);
    const first = textWindow(original, 1), second = textWindow(original, 2), third = textWindow(original, 3);
    assert.equal(first.count, 3);
    assert.equal(first.text + second.text + third.text, original);
    assert.ok(first.text.endsWith('🧪'));
    assert.ok(first.text.length <= PREVIEW_LIMITS.textWindow + 1);
    assert.throws(() => textWindow(original, 0), fails('page_unavailable'));
});
test('bounded static BMP header and binary malformed/limit distinction', async () => {
    const bytes = new Uint8Array(70); const view = new DataView(bytes.buffer);
    bytes.set([66, 77]); view.setUint32(2, 70, true); view.setUint32(10, 54, true); view.setUint32(14, 40, true);
    view.setInt32(18, 2, true); view.setInt32(22, 2, true); view.setUint16(26, 1, true); view.setUint16(28, 24, true);
    assert.deepEqual(inspectRaster(bytes, 'image/bmp'), { width: 2, height: 2 });
    const preview = await readDocumentPreview(data(bytes, 'image/bmp'), signal());
    assert.equal(preview.kind, 'image'); releaseDocumentPreview(preview);
    view.setInt32(18, 100_000, true);
    assert.throws(() => inspectRaster(bytes, 'image/bmp'), fails('image_limit'));
    assert.throws(() => inspectRaster(bytes.slice(0, 20), 'image/bmp'), fails('invalid_image'));
});
