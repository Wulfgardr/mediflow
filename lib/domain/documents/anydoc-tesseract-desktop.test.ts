/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import profiles from '../../../scripts/anydoc-pdf-renderer-profiles.json' with { type: 'json' };
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
    inspectAnyDocDesktopOcrCapability, runAnyDocTesseractDocument,
    ANYDOC_TESSERACT_ARTIFACT_SET_SHA256,
} from './anydoc-pdf-child-process-owner';
import { continueAnyDocWithTesseractForTest } from './anydoc-apple-vision-ocr-composition';
import { extractAnyDocLocalBytes, extractAnyDocPageRoutingBytes } from './anydoc-local-extraction-runner';

const real = process.env.MEDIFLOW_TEST_TESSERACT_REAL === '1';
const realOptions = { skip: real ? false : 'Provision pinned artifacts and set MEDIFLOW_TEST_TESSERACT_REAL=1; this is not OCR proof.' };
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
function image(blank = false) {
    const canvas = createCanvas(1600, 600); const context = canvas.getContext('2d');
    context.fillStyle = 'white'; context.fillRect(0, 0, 1600, 600);
    if (!blank) return readFileSync(new URL('../../../e2e/fixtures/ocr-desktop-synthetic.png', import.meta.url));
    return canvas.toBuffer('image/png');
}
async function pdf(kind: 'native' | 'scan' | 'mixed' | 'blank') {
    const document = await PDFDocument.create();
    if (kind === 'native' || kind === 'mixed') {
        const font = await document.embedFont(StandardFonts.Helvetica);
        document.addPage([800, 300]).drawText('PAGINA NATIVA SINTETICA. Testo originale conservato senza OCR.',
            { x: 25, y: 220, size: 16, font });
    }
    if (kind !== 'native') {
        const png = await document.embedPng(image(kind === 'blank'));
        document.addPage([800, 300]).drawImage(png, { x: 0, y: 0, width: 800, height: 300 });
    }
    return Buffer.from(await document.save());
}

// No artifact dependency: malformed and oversized input is denied before launching an engine.
test('desktop OCR rejects malformed raster and over-limit document before recognition', async () => {
    for (const input of [null, [], [Buffer.from('%PDF-1.7')], Array(17).fill(image())]) {
        const result = await runAnyDocTesseractDocument(input);
        assert.equal(result.status, 'failed');
        if (result.status === 'failed') assert.equal(result.reason, 'invalid_request');
    }
});

test('real desktop OCR prerequisites are explicitly required for qualification runs', realOptions, () => {
    assert.equal(inspectAnyDocDesktopOcrCapability().status, 'artifacts_verified');
    assert.equal(inspectAnyDocDesktopOcrCapability().qualification, 'pending_target_benchmark');
});

test('real WASM recognizes Italian raster with digest-bound non-Apple provenance', realOptions, async () => {
    const png = image(); const before = sha256(png);
    const result = await runAnyDocTesseractDocument([png, png]);
    assert.equal(result.status, 'recognized');
    if (result.status !== 'recognized') return;
    assert.equal(result.pages.length, 2);
    for (const page of result.pages) {
        assert.match(page.text, /DOCUMENTO INTERAMENTE SINTETICO/);
        assert.match(page.text, /Qualità locale/);
        assert.match(page.text, /12\/03\/2026 quantità 25 mg/);
        assert.equal(page.receipt.engine, 'tesseract_wasm');
        assert.equal(page.receipt.inputSha256, before);
        assert.equal(page.receipt.artifactSetSha256, ANYDOC_TESSERACT_ARTIFACT_SET_SHA256);
        assert.equal(page.receipt.outputSha256, sha256(page.text));
    }
    assert.equal(sha256(png), before);
});

test('real WASM rejects blank pages without partial success and allows retry', realOptions, async () => {
    const result = await runAnyDocTesseractDocument([image(), image(true)]);
    assert.equal(result.status, 'failed');
    if (result.status === 'failed') assert.equal(result.reason, 'empty_output');
    assert.equal('pages' in result, false);
    assert.equal((await runAnyDocTesseractDocument([image()])).status, 'recognized');
});

test('missing and altered engine fail closed with actionable preflight and recover after restoration', realOptions, async () => {
    const artifact = path.resolve('node_modules/mediflow-ocr-tesseract/tesseract-core-lstm.wasm');
    const saved = readFileSync(artifact);
    renameSync(artifact, `${artifact}.test-held`);
    try {
        const capability = inspectAnyDocDesktopOcrCapability();
        assert.equal(capability.status, 'unavailable'); assert.equal(capability.reason, 'artifact_missing');
        assert.match(capability.guidance, /Provisionare localmente/);
        const cli = spawnSync(process.execPath, ['scripts/run-strip-types.mjs', 'scripts/check-anydoc-desktop-ocr.ts'], { encoding: 'utf8' });
        assert.equal(cli.status, 1); assert.match(cli.stdout, /artifact_missing/);
        assert.equal((await runAnyDocTesseractDocument([image()])).status, 'failed');
        const altered = Buffer.from(saved); altered[0] ^= 1; writeFileSync(artifact, altered);
        assert.equal(inspectAnyDocDesktopOcrCapability().reason, 'artifact_invalid');
        assert.equal((await runAnyDocTesseractDocument([image()])).status, 'failed');
    } finally {
        renameSync(`${artifact}.test-held`, artifact);
    }
    assert.equal(inspectAnyDocDesktopOcrCapability().status, 'artifacts_verified');
    assert.equal((await runAnyDocTesseractDocument([image()])).status, 'recognized');
});

test('real AnyDoc plus WASM preserves native page and recognizes only the late needsOcr page', realOptions, async () => {
    const bytes = await pdf('mixed'); const initial = await extractAnyDocLocalBytes('synthetic.desktop', bytes);
    const routing = await extractAnyDocPageRoutingBytes(bytes);
    assert.deepEqual(routing, { schemaVersion: 'mediflow.anydoc_page_routing.v1', pageCount: 2, pages: [2] });
    const result = await continueAnyDocWithTesseractForTest('synthetic.desktop', bytes, initial);
    assert.equal(result.status, 'extracted');
    if (result.status !== 'extracted') return;
    assert.match(result.markdown, /PAGINA NATIVA SINTETICA/);
    assert.match(result.markdown, /DOCUMENTO INTERAMENTE SINTETICO/);
    assert.ok(result.markdown.indexOf('PAGINA NATIVA') < result.markdown.indexOf('DOCUMENTO INTERAMENTE'));
    assert.equal(result.receipt.ocrProvenance?.engine, 'tesseract_wasm');
    assert.equal(result.receipt.ocrProvenance?.pageCount, 2);
    assert.equal(result.receipt.ocrProvenance?.ocrPageCount, 1);
    assert.equal(result.provenance.sourceSha256, sha256(bytes));
    assert.equal(result.candidateUse, 'review_only'); assert.equal(result.writes, 0); assert.equal(result.apply, 'none');
    assert.equal(await continueAnyDocWithTesseractForTest('synthetic.desktop', Buffer.from('changed'), initial), initial);
});

test('native-only PDF bypasses OCR and scanned PDF with blank page remains blocked', realOptions, async () => {
    const bytes = await pdf('native'); const initial = await extractAnyDocLocalBytes('synthetic.native', bytes);
    assert.equal(initial.status, 'extracted');
    const result = await continueAnyDocWithTesseractForTest('synthetic.native', bytes, initial);
    assert.equal(result, initial);
    if (result.status === 'extracted') assert.equal(result.receipt.ocrProvenance, undefined);
    const blank = await pdf('blank'); const failed = await extractAnyDocLocalBytes('synthetic.blank', blank);
    const empty = await continueAnyDocWithTesseractForTest('synthetic.blank', blank, failed);
    assert.equal(empty.status, 'review_required'); assert.equal(empty.candidateUse, 'blocked');
});

/* @Codex */
test('preflight detects missing and altered native renderer payload before OCR availability', realOptions, () => {
    const profile = profiles.find((entry) => entry.platform === process.platform && entry.arch === process.arch);
    assert.ok(profile);
    const file = path.resolve('node_modules', profile.package, profile.binary);
    const bytes = readFileSync(file);
    renameSync(file, `${file}.test-held`);
    try {
        assert.equal(inspectAnyDocDesktopOcrCapability().reason, 'renderer_unavailable');
        const changed = Buffer.from(bytes); changed[0] ^= 1; writeFileSync(file, changed);
        assert.equal(inspectAnyDocDesktopOcrCapability().reason, 'renderer_unavailable');
    } finally { renameSync(`${file}.test-held`, file); }
    assert.equal(inspectAnyDocDesktopOcrCapability().status, 'artifacts_verified');
});

/* @Codex */
test('real WASM shares immediate child admission and permits retry after process close', realOptions, async () => {
    const first = runAnyDocTesseractDocument([image()]);
    const concurrent = await runAnyDocTesseractDocument([image()]);
    assert.equal(concurrent.status, 'failed');
    if (concurrent.status === 'failed') assert.equal(concurrent.reason, 'busy');
    assert.equal((await first).status, 'recognized');
    assert.equal((await runAnyDocTesseractDocument([image()])).status, 'recognized');
});
