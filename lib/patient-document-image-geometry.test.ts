import assert from 'node:assert/strict';
import test from 'node:test';
import zlib from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { preparePdfRasterInput } from './pdf-raster-preflight.mjs';
import { fitImageForLocalOcr, OCR_IMAGE_PIXEL_BUDGET, OCR_MAX_PIXELS, OCR_MAX_RASTER_BYTES, OCR_MAX_SIDE_PIXELS,
    OCR_MIN_SHORT_SIDE_PIXELS, OCR_RENDER_DPI } from './patient-document-image-geometry';

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
    assert.equal(OCR_MAX_RASTER_BYTES, 16 * 1024 * 1024);
    assert.ok(OCR_IMAGE_PIXEL_BUDGET < OCR_MAX_PIXELS);
});

for (const [label, width, height, reduced] of [
    ['A4 150 dpi', 1240, 1754, false], ['A4 200 dpi', 1654, 2339, false], ['A4 300 dpi', 2480, 3508, true],
    ['foto 12 Mpx', 4032, 3024, true], ['screenshot iPhone', 1179, 2556, false], ['A4 600 dpi', 4960, 7016, true],
    ['foto 48 Mpx', 8064, 6048, true], ['foto 50 Mpx', 8160, 6120, true], ['legal 600 dpi', 5100, 8400, true],
    ['immagine piccola', 800, 600, false],
] as const) {
    test(`${label}: the page renders back to pixels within the renderer limits`, async () => {
        const fit = fitImageForLocalOcr(width, height);
        assert.ok(fit.ok);
        assert.equal(fit.scale < 1, reduced);
        assert.ok(!reduced || Math.min(fit.width, fit.height) >= OCR_MIN_SHORT_SIDE_PIXELS);
        const viewport = [Math.ceil(fit.pageWidth * OCR_RENDER_DPI / 72), Math.ceil(fit.pageHeight * OCR_RENDER_DPI / 72)];
        assert.deepEqual(viewport, [fit.width, fit.height], 'the render returns exactly the kept pixels');
        assert.ok(fit.width <= OCR_MAX_SIDE_PIXELS && fit.height <= OCR_MAX_SIDE_PIXELS && fit.width * fit.height <= OCR_IMAGE_PIXEL_BUDGET);
        const pdf = await PDFDocument.create(), image = await pdf.embedPng(whitePng(fit.width, fit.height));
        pdf.addPage([fit.pageWidth, fit.pageHeight]).drawImage(image, { x: 0, y: 0, width: fit.pageWidth, height: fit.pageHeight });
        await preparePdfRasterInput(new Uint8Array(await pdf.save()), { maxPixels: OCR_MAX_PIXELS, maxDimension: OCR_MAX_SIDE_PIXELS, maxBytes: 10 * 1024 * 1024 });
    });
}

/** A grainy photo of a sheet, re-encoded as the browser does: warm paper under uneven light, luminance
 * noise of standard deviation 8 plus a small independent colour noise (sigma 3 per channel), as a phone
 * sensor gives. At 12 Mpx this content renders to about 17 MiB of PNG; at the 8 Mpx budget to about 11. */
async function grainyPhotoPdf(width: number, height: number) {
    const pixels = Buffer.alloc(width * height * 3);
    let seed = 0x2545f491;
    const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) + 0.5) / 4294967296; };
    const gaussian = () => Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        const light = 215 + 25 * (x / width) - 15 * (y / height), grain = 8 * gaussian();
        [light, light - 6, light - 18].forEach((paper, channel) => {
            pixels[(y * width + x) * 3 + channel] = Math.max(0, Math.min(255, Math.round(paper + grain + 3 * gaussian())));
        });
    }
    const jpeg = await sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
    const pdf = await PDFDocument.create(), image = await pdf.embedJpg(jpeg);
    const page = [width * 72 / OCR_RENDER_DPI, height * 72 / OCR_RENDER_DPI] as const;
    pdf.addPage([...page]).drawImage(image, { x: 0, y: 0, width: page[0], height: page[1] });
    return new Uint8Array(await pdf.save());
}

/** Same engine and calls as the page worker: pdfjs legacy, @napi-rs/canvas, 144 DPI, PNG output. */
async function renderedPngBytes(bytes: Uint8Array) {
    process.env.DISABLE_SYSTEM_FONTS_LOAD = '1';
    const [pdfjs, canvasModule] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('@napi-rs/canvas')]);
    const document = await pdfjs.getDocument({ data: bytes, disableWorker: true, isEvalSupported: false, useSystemFonts: false, verbosity: 0 } as Parameters<typeof pdfjs.getDocument>[0]).promise;
    try {
        const page = await document.getPage(1), viewport = page.getViewport({ scale: OCR_RENDER_DPI / 72 });
        const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D, viewport, background: '#ffffff' } as Parameters<typeof page.render>[0]).promise;
        return canvas.toBuffer('image/png').byteLength;
    } finally { await document.destroy(); }
}

test('a grainy 12 Mpx photo, once converted, renders within the 16 MiB PNG limit of the worker', { timeout: 120_000 }, async () => {
    const fit = fitImageForLocalOcr(4032, 3024);
    assert.ok(fit.ok);
    const size = await renderedPngBytes(await grainyPhotoPdf(fit.width, fit.height));
    assert.ok(size <= OCR_MAX_RASTER_BYTES * 0.8, `PNG di ${(size / 1048576).toFixed(1)} MiB: margine sotto il 20% del limite di 16 MiB`);
});

test('only a reduction that leaves the short side below the OCR floor is refused, with the measure', () => {
    const receipt = fitImageForLocalOcr(576, 9000);
    assert.equal(receipt.ok, false);
    assert.equal((receipt as { reason: string }).reason, 'too-elongated');
    assert.ok(((receipt as { shortSide: number }).shortSide) < OCR_MIN_SHORT_SIDE_PIXELS);
    assert.equal(fitImageForLocalOcr(500, 3000).ok, true, 'a small image is not reduced, so it is not refused');
    assert.equal(fitImageForLocalOcr(0, 10).ok, false);
});
