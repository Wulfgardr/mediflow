import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { preparePdfRasterInput } from './pdf-raster-preflight.mjs';
import { fitImageForLocalOcr, OCR_MAX_PIXELS, OCR_MAX_SIDE_PIXELS, OCR_MIN_REDUCTION, OCR_RENDER_DPI } from './patient-document-image-geometry';

function crc32(bytes: Buffer) {
    let crc = ~0;
    for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
    return ~crc >>> 0;
}
function chunk(type: string, data: Buffer) {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}
function whitePng(width: number, height: number) {
    const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 0;
    const raw = Buffer.alloc((width + 1) * height, 0xff);
    for (let row = 0; row < height; row += 1) raw[row * (width + 1)] = 0;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header),
        chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('the limits are the ones of the local page renderer', () => {
    const worker = readFileSync(new URL('../scripts/anydoc-pdf-page-worker.mjs', import.meta.url), 'utf8');
    assert.match(worker, new RegExp(`const MAX_DIMENSION_PIXELS = ${OCR_MAX_SIDE_PIXELS};`, 'u'));
    assert.match(worker, new RegExp(`const MAX_PIXELS = ${OCR_MAX_PIXELS.toLocaleString('en-US').replaceAll(',', '_')};`, 'u'));
    assert.match(worker, new RegExp(`const DPI = ${OCR_RENDER_DPI};`, 'u'));
});

for (const [label, width, height, reduced] of [
    ['A4 150 dpi', 1240, 1754, false], ['A4 200 dpi', 1654, 2339, false], ['A4 300 dpi', 2480, 3508, false],
    ['foto 12 Mpx', 4032, 3024, true], ['screenshot iPhone', 1179, 2556, false], ['A4 600 dpi', 4960, 7016, true],
] as const) {
    test(`${label}: the page renders back to pixels within the renderer limits`, async () => {
        const fit = fitImageForLocalOcr(width, height);
        assert.ok(fit.ok);
        assert.equal(fit.scale < 1, reduced);
        assert.ok(fit.scale >= OCR_MIN_REDUCTION);
        const viewport = [Math.ceil(fit.pageWidth * OCR_RENDER_DPI / 72), Math.ceil(fit.pageHeight * OCR_RENDER_DPI / 72)];
        assert.deepEqual(viewport, [fit.width, fit.height], 'the render returns exactly the kept pixels');
        assert.ok(fit.width <= OCR_MAX_SIDE_PIXELS && fit.height <= OCR_MAX_SIDE_PIXELS && fit.width * fit.height <= OCR_MAX_PIXELS);
        const pdf = await PDFDocument.create(), image = await pdf.embedPng(whitePng(fit.width, fit.height));
        pdf.addPage([fit.pageWidth, fit.pageHeight]).drawImage(image, { x: 0, y: 0, width: fit.pageWidth, height: fit.pageHeight });
        await preparePdfRasterInput(new Uint8Array(await pdf.save()), { maxPixels: OCR_MAX_PIXELS, maxDimension: OCR_MAX_SIDE_PIXELS, maxBytes: 10 * 1024 * 1024 });
    });
}

test('an image that would lose more than half its resolution is refused, not shrunk silently', () => {
    assert.deepEqual(fitImageForLocalOcr(8064, 6048).ok, false); // foto da 48 Mpx
    assert.equal((fitImageForLocalOcr(8064, 6048) as { reason: string }).reason, 'too-large');
    assert.equal(fitImageForLocalOcr(0, 10).ok, false);
});
