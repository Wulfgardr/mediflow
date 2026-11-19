import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { pdfPagePaintsBeyondText } from './agent-visit-pdf-content';

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const renderer = fileURLToPath(new URL('../plugins/mediflow-ambulatorio/render-pdf.mjs', import.meta.url));

async function paintsBeyondText(bytes: Uint8Array): Promise<boolean> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false, disableFontFace: true, stopAtErrors: true, verbosity: 0 });
    try {
        const pdf = await task.promise;
        let beyond = false;
        for (let index = 1; index <= pdf.numPages; index++) {
            const page = await pdf.getPage(index);
            beyond ||= pdfPagePaintsBeyondText(pdfjs.OPS, await page.getOperatorList(), await page.getAnnotations());
        }
        return beyond;
    } finally { await task.destroy(); }
}

async function syntheticPdf(draw: (document: PDFDocument, page: ReturnType<PDFDocument['addPage']>) => Promise<void> | void) {
    const document = await PDFDocument.create();
    const page = document.addPage([595, 842]);
    page.drawText('Paziente CF RSSMRA80A01H501U. Referto sintetico.', { x: 32, y: 790, size: 10, font: await document.embedFont(StandardFonts.Helvetica) });
    await draw(document, page);
    return document.save();
}

test('L4: a text-only PDF stays presentable, anything painted beside the text sends it to the Web review', async () => {
    assert.equal(await paintsBeyondText(await syntheticPdf(() => undefined)), false);
    assert.equal(await paintsBeyondText(await syntheticPdf(async (document, page) => {
        page.drawImage(await document.embedPng(pixel), { x: 32, y: 600, width: 120, height: 120 });
    })), true);
    assert.equal(await paintsBeyondText(await syntheticPdf((_document, page) => {
        page.drawRectangle({ x: 32, y: 500, width: 200, height: 40, color: rgb(0, 0, 0) });
    })), true);
    assert.equal(await paintsBeyondText(await syntheticPdf((document, page) => {
        document.getForm().createTextField('nota.sintetica').addToPage(page, { x: 32, y: 400, width: 200, height: 24 });
    })), true);
});

test('L4: the note PDF written by the Ambulatorio plugin is text only', async () => {
    const rendered = spawnSync(process.execPath, [renderer], { input: JSON.stringify(['Codice fiscale paziente: RSSMRA80A01H501U', '', 'S: Controllo sintetico.']), maxBuffer: 1 << 24 });
    assert.equal(rendered.status, 0, String(rendered.stderr));
    assert.equal(await paintsBeyondText(new Uint8Array(rendered.stdout)), false);
});
