/* @Codex — real pinned PDF.js render with synthetic standard-font and image pages. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createCanvas, DOMMatrix, Path2D } from '@napi-rs/canvas';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PreviewError } from './document-viewer-policy.ts';
import { readOwnedStandardFont } from './document-viewer-pdf-fonts.ts';

const fontNames = new Set([
    'FoxitDingbats.pfb', 'FoxitFixed.pfb', 'FoxitFixedBold.pfb', 'FoxitFixedBoldItalic.pfb', 'FoxitFixedItalic.pfb',
    'FoxitSerif.pfb', 'FoxitSerifBold.pfb', 'FoxitSerifBoldItalic.pfb', 'FoxitSerifItalic.pfb', 'FoxitSymbol.pfb',
    'LiberationSans-Bold.ttf', 'LiberationSans-BoldItalic.ttf', 'LiberationSans-Italic.ttf', 'LiberationSans-Regular.ttf',
]);
const fontRoot = path.join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts');

class LocalStandardFontDataFactory {
    constructor() {}
    async fetch({ filename }: { filename: unknown }): Promise<Uint8Array> {
        if (typeof filename !== 'string' || !fontNames.has(filename)) throw new Error('synthetic denied font');
        return new Uint8Array(await fs.readFile(path.join(fontRoot, filename)));
    }
}

class LocalCanvasFactory {
    create(width: number, height: number) {
        const canvas = createCanvas(width, height);
        return { canvas, context: canvas.getContext('2d') };
    }
    reset(target: { canvas: ReturnType<typeof createCanvas> }, width: number, height: number) {
        target.canvas.width = width; target.canvas.height = height;
    }
    destroy(target: { canvas: ReturnType<typeof createCanvas> | null; context: unknown }) {
        if (target.canvas) { target.canvas.width = 0; target.canvas.height = 0; }
        target.canvas = null; target.context = null;
    }
}

async function mixedPdf(): Promise<Uint8Array> {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([800, 250]).drawText('PRIMA PAGINA TESTUALE - DOCUMENTO SINTETICO', { x: 30, y: 180, size: 24, font });
    const raster = createCanvas(800, 250);
    const context = raster.getContext('2d');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, 800, 250);
    context.fillStyle = '#000000'; context.fillRect(30, 30, 320, 120);
    const image = await pdf.embedPng(raster.toBuffer('image/png'));
    pdf.addPage([800, 250]).drawImage(image, { x: 0, y: 0, width: 800, height: 250 });
    return new Uint8Array(await pdf.save({ useObjectStreams: false }));
}

function nonWhitePixels(canvas: {
    width: number;
    height: number;
    getContext(type: '2d'): { getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray } };
}): number {
    const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let index = 0; index < bytes.length; index += 4) {
        if (bytes[index] !== 255 || bytes[index + 1] !== 255 || bytes[index + 2] !== 255) count++;
    }
    return count;
}

test('owned standard-font loader permits only emitted allowlist assets', async () => {
    const requested: URL[] = [];
    const bytes = await readOwnedStandardFont('LiberationSans-Regular.ttf', async (input) => {
        assert.ok(input instanceof URL); requested.push(input);
        return new Response(new Uint8Array([1, 2, 3]));
    });
    assert.deepEqual(Array.from(bytes), [1, 2, 3]);
    assert.equal(requested.length, 1);
    assert.match(requested[0].pathname, /pdfjs-dist\/standard_fonts\/LiberationSans-Regular\.ttf$/u);
    await assert.rejects(readOwnedStandardFont('../arbitrary.ttf', async () => {
        throw new Error('must not fetch arbitrary source');
    }), (error: unknown) => error instanceof PreviewError && error.code === 'missing_resource');
});

test('standard font data renders text and raster pages with FontFace disabled', async () => {
    const globals = globalThis as unknown as { DOMMatrix: typeof DOMMatrix; Path2D: typeof Path2D };
    globals.DOMMatrix = DOMMatrix;
    globals.Path2D = Path2D;
    const task = pdfjs.getDocument({
        data: await mixedPdf(), disableWorker: true, isEvalSupported: false, enableXfa: false, useWorkerFetch: false,
        CMapReaderFactory: LocalStandardFontDataFactory, StandardFontDataFactory: LocalStandardFontDataFactory,
        CanvasFactory: LocalCanvasFactory, useSystemFonts: false, disableFontFace: true, stopAtErrors: true,
        disableRange: true, disableStream: true, disableAutoFetch: true, isOffscreenCanvasSupported: false, verbosity: 0,
    });
    try {
        const document = await task.promise;
        const rendered: number[] = [];
        for (const number of [1, 2]) {
            const page = await document.getPage(number);
            const viewport = page.getViewport({ scale: 1 });
            const canvas = createCanvas(viewport.width, viewport.height);
            await page.render({ canvasContext: canvas.getContext('2d'), viewport, background: '#ffffff' }).promise;
            rendered.push(nonWhitePixels(canvas));
        }
        assert.equal(document.numPages, 2);
        assert.ok(rendered[0] > 0, 'pagina testuale Helvetica resa localmente');
        assert.ok(rendered[1] > 0, 'pagina raster resa localmente');
    } finally {
        await task.destroy();
    }
});
