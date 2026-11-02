import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

for (const mask of ['smask', 'mask']) test(`real PDF ${mask} refuses the resolved oversized image; without oversized allocations before rejection`, t => {
    const script = `
      import fs from 'node:fs';
      import assert from 'node:assert/strict';
      globalThis.DOMMatrix=class {}; globalThis.Path2D=class {}; globalThis.ImageData=class {};
      const allocations=[], Original=Uint8ClampedArray;
      globalThis.Uint8ClampedArray=new Proxy(Original,{construct(target,args){
        if(typeof args[0]==='number' && args[0]>=12000000) allocations.push(args[0]);
        return Reflect.construct(target,args);
      }});
      const pdfjs=await import(${JSON.stringify(new URL('../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href)});
      const {preparePdfRasterInput}=await import(${JSON.stringify(new URL('../lib/pdf-raster-preflight.mjs', import.meta.url).href)});
      const bytes=new Uint8Array(fs.readFileSync(new URL(${JSON.stringify(new URL('../scripts/fixtures/preview-large-' + mask + '.pdf', import.meta.url).href)})));
      let task;
      try {
        await assert.rejects(async()=>{
          const checked=await preparePdfRasterInput(bytes,{maxPixels:12000000,maxDimension:8192,maxBytes:25*1024*1024});
          task=pdfjs.getDocument({data:checked,maxImageSize:12000000,stopAtErrors:true,isOffscreenCanvasSupported:false,verbosity:0});
          const doc=await task.promise;
          const page=await doc.getPage(1);
          await page.getOperatorList();
        }, {message:'pdf_raster_limit'});
        console.log(JSON.stringify({mask:${JSON.stringify(mask)},allocations,predecodeBounded:allocations.length===0}));
      } finally {await task?.destroy();}
    `;
    const result = spawnSync(process.execPath, ['--no-addons', '--import', new URL('../scripts/register-strip-types-loader.mjs', import.meta.url).href,
        '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    const line = result.stdout.trim().split('\n').at(-1);
    assert.ok(line);
    const observation = JSON.parse(line);
    t.diagnostic(JSON.stringify(observation));
    assert.deepEqual(observation.allocations, []);
});

import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import { preparePdfRasterInput } from '../lib/pdf-raster-preflight.mjs';

const limits = { maxPixels: 12_000_000, maxDimension: 8192, maxBytes: 25 * 1024 * 1024 };

async function maskedPdf(location: string, invalid: string) {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([20, 20]);
    const context = pdf.context;
    const mask = context.flateStream(new Uint8Array([255, 255, 255, 255]), {
        Type: 'XObject', Subtype: 'Image', Width: 2, Height: 2, ColorSpace: 'DeviceGray', BitsPerComponent: 8,
    });
    const maskRef = context.register(mask);
    const image = context.flateStream(new Uint8Array([0, 0, 0, 0]), {
        Type: 'XObject', Subtype: 'Image', Width: 2, Height: 2, ColorSpace: 'DeviceGray', BitsPerComponent: 8, SMask: maskRef,
    });
    if (invalid === 'large') mask.dict.set(PDFName.of('Width'), PDFNumber.of(8_000_000));
    if (invalid === 'unknown') mask.dict.delete(PDFName.of('Width'));
    if (invalid === 'depth') mask.dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(128));
    if (invalid === 'nested') {
        const huge = context.flateStream(new Uint8Array([0]), { Width: 4000, Height: 4000, BitsPerComponent: 8 });
        mask.dict.set(PDFName.of('Mask'), context.register(huge));
    }
    if (invalid === 'main') image.dict.set(PDFName.of('Height'), PDFNumber.of(8_000_000));
    if (invalid === 'combined') {
        image.dict.set(PDFName.of('Width'), PDFNumber.of(8192));
        mask.dict.set(PDFName.of('Height'), PDFNumber.of(8192));
    }
    const resources = context.obj({ XObject: { Im: context.register(image) } });
    if (location === 'inherited') {
        page.node.Parent()!.set(PDFName.of('Resources'), resources);
        page.node.delete(PDFName.of('Resources'));
    } else if (location === 'form' || location === 'pattern') {
        const form = context.flateStream('/Im Do', {
            Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 20, 20], Resources: resources,
            ...(location === 'pattern' ? { Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1, XStep: 20, YStep: 20 } : {}),
        });
        page.node.set(PDFName.of('Resources'), context.obj(location === 'form'
            ? { XObject: { F: context.register(form) } } : { Pattern: { P: context.register(form) } }));
    } else page.node.set(PDFName.of('Resources'), resources);
    page.node.set(PDFName.of('Contents'), context.register(context.flateStream('q 20 0 0 20 0 0 cm /Im Do Q')));
    return pdf.save({ useObjectStreams: true });
}

test('refuses oversized and unmeasurable rasters throughout the resource graph', async () => {
    for (const location of ['page', 'inherited', 'form', 'pattern']) {
        for (const invalid of ['large', 'unknown', 'depth', 'nested', 'main', 'combined']) {
            await assert.rejects(preparePdfRasterInput(await maskedPdf(location, invalid), limits),
                { message: 'pdf_raster_limit' }, `${location}: ${invalid}`);
        }
    }
});

test('small soft mask survives structural validation and real PDF.js painting', async () => {
    const { createCanvas, DOMMatrix, Path2D } = await import('@napi-rs/canvas');
    Object.assign(globalThis, { DOMMatrix, Path2D });
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const bytes = await preparePdfRasterInput(await maskedPdf('page', ''), limits);
    const task = pdfjs.getDocument({ data: bytes, isOffscreenCanvasSupported: false, maxImageSize: limits.maxPixels, verbosity: 0 });
    try {
        const doc = await task.promise;
        const page = await doc.getPage(1);
        const canvas = createCanvas(20, 20);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: page.getViewport({ scale: 1 }) }).promise;
        assert.ok(canvas.getContext('2d').getImageData(10, 10, 1, 1).data[0] < 128);
    } finally { await task.destroy(); }
});
