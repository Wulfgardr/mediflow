/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { ANYDOC_LOCAL_EXTRACTION_MAX_MARKDOWN_BYTES } from './anydoc-local-extraction-contract';
import { buildAnyDocPageManifest } from './anydoc-page-manifest';
import { materializeAnyDocPdfPages } from './anydoc-pdf-page-materializer';
import {
    ANYDOC_PDF_PAGE_RENDERER_DPI,
    ANYDOC_PDF_PAGE_RENDERER_ENGINE_DESCRIPTOR,
    ANYDOC_PDF_PAGE_RENDERER_ENGINE_SHA256,
    ANYDOC_PDF_PAGE_RENDERER_INTERNAL_TEST_SEAM,
    ANYDOC_PDF_PAGE_RENDERER_MAX_DIMENSION_PIXELS,
    ANYDOC_PDF_PAGE_RENDERER_MAX_RASTER_BYTES,
    ANYDOC_PDF_PAGE_RENDERER_MAX_TOTAL_RASTER_BYTES,
    ANYDOC_PDF_PAGE_RENDERER_RUNTIME_PROFILE_ID,
    renderAnyDocNeedsOcrPages,
} from './anydoc-pdf-page-renderer';

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const SOURCE_REF = 'a'.repeat(64);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const routing = (pageCount: number, pages: readonly number[]) => ({
    schemaVersion: 'mediflow.anydoc_page_routing.v1' as const, pages, pageCount,
});

async function syntheticPdf(kinds: readonly ('scan' | 'text')[], sizes?: readonly (readonly [number, number])[]) {
    const pdf = await PDFDocument.create({ updateMetadata: false });
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const image = await pdf.embedPng(Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
    ));
    kinds.forEach((kind, index) => {
        const [width, height] = sizes?.[index] ?? [144, 72];
        const page = pdf.addPage([width, height]);
        if (kind === 'text') page.drawText(`Synthetic native page ${index + 1}`, { x: 12, y: height - 24, font, size: 12 });
        else page.drawImage(image, { x: 0, y: 0, width, height });
    });
    return Buffer.from(await pdf.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false }));
}

async function acceptedFixture() {
    const source = await syntheticPdf(['scan', 'text', 'scan'], [[144, 72], [180, 90], [216, 108]]);
    const route = routing(3, [1, 3]);
    const materialization = await materializeAnyDocPdfPages(source, sha256(source), route);
    assert.equal(materialization.status, 'materialized');
    if (materialization.status !== 'materialized') throw new Error('synthetic materialization failed');
    const sourceBinding = { documentSourceRef: SOURCE_REF, documentRevision: 7,
        documentFreshnessEpoch: 11, sourceSha256: sha256(source), sourceByteLength: source.byteLength };
    const manifest = await buildAnyDocPageManifest(sourceBinding, route, materialization);
    assert.equal(manifest.status, 'classified', JSON.stringify(manifest));
    return { sourceBinding, manifest, materialization };
}

function syntheticNoiseJpeg(size: number) {
    const canvas = createCanvas(size, size); const context = canvas.getContext('2d');
    const image = context.createImageData(size, size); let state = 0x1234_5678;
    for (let index = 0; index < image.data.length; index += 4) {
        state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
        image.data[index] = state & 0xff; image.data[index + 1] = (state >>> 8) & 0xff;
        image.data[index + 2] = (state >>> 16) & 0xff; image.data[index + 3] = 0xff;
    }
    context.putImageData(image, 0, 0); return canvas.toBuffer('image/jpeg', 80);
}

async function classifiedNoiseFixture(jpeg: Buffer, size: number, pageCount: number) {
    const pdf = await PDFDocument.create({ updateMetadata: false }); const image = await pdf.embedJpg(jpeg);
    for (let index = 0; index < pageCount; index += 1) {
        const page = pdf.addPage([size / 2, size / 2]); page.drawImage(image, { x: 0, y: 0, width: size / 2, height: size / 2 });
    }
    const source = Buffer.from(await pdf.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false }));
    const route = routing(pageCount, Array.from({ length: pageCount }, (_, index) => index + 1));
    const materialization = await materializeAnyDocPdfPages(source, sha256(source), route);
    assert.equal(materialization.status, 'materialized'); if (materialization.status !== 'materialized') throw new Error('noise materialization failed');
    const binding = { documentSourceRef: SOURCE_REF, documentRevision: 7, documentFreshnessEpoch: 11,
        sourceSha256: sha256(source), sourceByteLength: source.byteLength };
    const manifest = await buildAnyDocPageManifest(binding, route, materialization);
    assert.equal(manifest.status, 'classified'); return { manifest, materialization };
}

test('renders only canonical needsOcr pages in stable order with bounded PHI-safe receipts', async () => {
    const fixture = await acceptedFixture();
    const result = await renderAnyDocNeedsOcrPages(fixture.manifest, fixture.materialization);

    assert.equal(result.status, 'rendered', JSON.stringify(result));
    if (result.status !== 'rendered') return;
    assert.deepEqual(result.pages.map((page) => page.page), [1, 3]);
    assert.deepEqual(result.pages.map((page) => [page.receipt.widthPixels, page.receipt.heightPixels]), [[288, 144], [432, 216]]);
    for (const page of result.pages) {
        assert.equal(page.pngBytes.subarray(0, 8).equals(PNG_SIGNATURE), true);
        assert.equal(page.receipt.admission, 'needsOcr');
        assert.equal(page.receipt.documentSourceRef, SOURCE_REF);
        assert.equal(page.receipt.documentRevision, 7);
        assert.equal(page.receipt.documentFreshnessEpoch, 11);
        assert.equal(page.receipt.sourceSha256, fixture.sourceBinding.sourceSha256);
        assert.equal(page.receipt.pageSha256, fixture.manifest.pages[page.page - 1]?.pageSha256);
        assert.equal(page.receipt.rasterSha256, sha256(page.pngBytes));
        assert.equal(page.receipt.rasterByteLength, page.pngBytes.byteLength);
        assert.equal(page.receipt.format, 'png'); assert.equal(page.receipt.dpi, 144);
        assert.equal(page.receipt.rendererProfileId, ANYDOC_PDF_PAGE_RENDERER_RUNTIME_PROFILE_ID);
        assert.equal(page.receipt.rendererSha256, ANYDOC_PDF_PAGE_RENDERER_ENGINE_SHA256);
        assert.equal(page.receipt.engine, 'pdfjs-dist'); assert.equal(page.receipt.engineVersion, '4.10.38');
        assert.equal(page.receipt.backend, '@napi-rs/canvas');
        assert.equal(page.receipt.backendVersion, '0.1.100');
        assert.equal(page.receipt.backendProfile, '@napi-rs/canvas-darwin-arm64');
        assert.ok(page.receipt.durationMs >= 0 && page.receipt.durationMs <= page.receipt.timeoutMs);
    }
    assert.equal(ANYDOC_PDF_PAGE_RENDERER_DPI, 144);
    assert.doesNotMatch(JSON.stringify(result), /Synthetic native|\/tmp\/|markdown/iu);
    assert.equal(result.review, 'required'); assert.equal(result.writes, 0); assert.equal(result.apply, 'none');
});

test('produces deterministic raster bytes and digests on the exact renderer profile', async () => {
    const fixture = await acceptedFixture();
    const first = await renderAnyDocNeedsOcrPages(fixture.manifest, fixture.materialization);
    const second = await renderAnyDocNeedsOcrPages(fixture.manifest, fixture.materialization);
    assert.equal(first.status, 'rendered'); assert.equal(second.status, 'rendered');
    if (first.status !== 'rendered' || second.status !== 'rendered') return;
    assert.deepEqual(first.pages.map((page) => page.receipt.rasterSha256), second.pages.map((page) => page.receipt.rasterSha256));
    assert.deepEqual(first.pages.map((page, index) => Buffer.compare(page.pngBytes, second.pages[index]!.pngBytes)), [0, 0]);
});

test('rejects global review, alternate spelling, routing, order, digest and binding mismatches', async () => {
    const fixture = await acceptedFixture();
    const cases: Array<[unknown, unknown, string]> = [
        [{ ...fixture.manifest, status: 'review_required' }, fixture.materialization, 'invalid_manifest'],
        [{ ...fixture.manifest, pages: fixture.manifest.pages.map((page, index) => index === 0
            ? { ...page, status: 'needs_ocr' } : page) }, fixture.materialization, 'invalid_manifest'],
        [{ ...fixture.manifest, routingSha256: '0'.repeat(64) }, fixture.materialization, 'routing_manifest_mismatch'],
        [{ ...fixture.manifest, pages: [fixture.manifest.pages[1], fixture.manifest.pages[0], fixture.manifest.pages[2]] }, fixture.materialization, 'invalid_manifest'],
        [{ ...fixture.manifest, pages: fixture.manifest.pages.map((page, index) => index === 0
            ? { ...page, pageSha256: '0'.repeat(64) } : page) }, fixture.materialization, 'page_evidence_mismatch'],
        [fixture.manifest, { ...fixture.materialization, sourceSha256: '0'.repeat(64) }, 'source_binding_mismatch'],
        [fixture.manifest, { ...fixture.materialization,
            pages: [fixture.materialization.pages[1], fixture.materialization.pages[0], fixture.materialization.pages[2]] }, 'page_evidence_mismatch'],
    ];
    for (const [manifest, materialization, reason] of cases) {
        const result = await renderAnyDocNeedsOcrPages(manifest, materialization);
        assert.deepEqual(result, { schemaVersion: 'mediflow.anydoc_pdf_page_renderer.v1', status: 'review_required',
            reason, review: 'required', writes: 0, apply: 'none' });
    }
});

test('rejects reconstructed native evidence with invalid exact receipt fields', async () => {
    const fixture = await acceptedFixture(); const native = fixture.manifest.pages[1]!.nativeEvidence!;
    const cases = [
        { ...native, receiptId: 'not-a-digest' },
        { ...native, markdownSha256: '0'.repeat(63) },
        { ...native, markdownByteLength: 0 },
        { ...native, markdownByteLength: 1.5 },
        { ...native, markdownByteLength: ANYDOC_LOCAL_EXTRACTION_MAX_MARKDOWN_BYTES + 1 },
        { ...native, extra: true },
    ];
    for (const nativeEvidence of cases) {
        const manifest = { ...fixture.manifest, pages: fixture.manifest.pages.map((page, index) =>
            index === 1 ? { ...page, nativeEvidence } : page) };
        const result = await renderAnyDocNeedsOcrPages(manifest, fixture.materialization);
        assert.equal(result.status, 'review_required');
        if (result.status === 'review_required') assert.equal(result.reason, 'invalid_manifest');
    }
});

test('copies bytes before async rendering and denies malformed, hostile and oversized pages without partial output', async () => {
    const fixture = await acceptedFixture();
    const firstPage = fixture.materialization.pages[0]!; const original = Buffer.from(firstPage.pdfBytes);
    const pending = renderAnyDocNeedsOcrPages(fixture.manifest, fixture.materialization);
    firstPage.pdfBytes.fill(0);
    assert.equal((await pending).status, 'rendered'); firstPage.pdfBytes.set(original);

    const malformed = Buffer.from('%PDF-1.4\nmalformed\n');
    const malformedMaterialization = { ...fixture.materialization, pages: fixture.materialization.pages.map((page, index) =>
        index === 0 ? { ...page, pdfBytes: malformed, receipt: { ...page.receipt,
            pageSha256: sha256(malformed), pageByteLength: malformed.byteLength } } : page) };
    const malformedManifest = { ...fixture.manifest, pages: fixture.manifest.pages.map((page, index) =>
        index === 0 ? { ...page, pageSha256: sha256(malformed), pageByteLength: malformed.byteLength } : page) };
    let result = await renderAnyDocNeedsOcrPages(malformedManifest, malformedMaterialization);
    assert.equal(result.status, 'review_required');
    if (result.status === 'review_required') assert.equal(result.reason, 'render_failed');

    const huge = await syntheticPdf(['scan'], [[ANYDOC_PDF_PAGE_RENDERER_MAX_DIMENSION_PIXELS, 72]]);
    const route = routing(1, [1]); const pages = await materializeAnyDocPdfPages(huge, sha256(huge), route);
    assert.equal(pages.status, 'materialized'); if (pages.status !== 'materialized') return;
    const binding = { ...fixture.sourceBinding, sourceSha256: sha256(huge), sourceByteLength: huge.byteLength };
    const manifest = await buildAnyDocPageManifest(binding, route, pages);
    result = await renderAnyDocNeedsOcrPages(manifest, pages);
    assert.equal(result.status, 'review_required'); if (result.status === 'review_required') assert.equal(result.reason, 'resource_limit');

    let reads = 0; const hostilePages = [...fixture.manifest.pages];
    Object.defineProperty(hostilePages, '0', { enumerable: true, get() { reads += 1; throw new Error('raw'); } });
    result = await renderAnyDocNeedsOcrPages({ ...fixture.manifest, pages: hostilePages }, fixture.materialization);
    assert.equal(result.status, 'review_required'); assert.equal(reads, 0);
    result = await renderAnyDocNeedsOcrPages(new Proxy(fixture.manifest, {}), fixture.materialization);
    assert.equal(result.status, 'review_required');

    const revokedManifestPages = Proxy.revocable([...fixture.manifest.pages], {}); revokedManifestPages.revoke();
    result = await renderAnyDocNeedsOcrPages({ ...fixture.manifest, pages: revokedManifestPages.proxy }, fixture.materialization);
    assert.equal(result.status, 'review_required');
    if (result.status === 'review_required') assert.equal(result.reason, 'invalid_manifest');
    const revokedMaterializationPages = Proxy.revocable([...fixture.materialization.pages], {}); revokedMaterializationPages.revoke();
    result = await renderAnyDocNeedsOcrPages(fixture.manifest,
        { ...fixture.materialization, pages: revokedMaterializationPages.proxy });
    assert.equal(result.status, 'review_required');
    if (result.status === 'review_required') assert.equal(result.reason, 'page_evidence_mismatch');
});

test('post-fences stalled render and cooperatively observes cleanup through an internal fake-engine seam', async () => {
    const pending = new Promise<void>(() => undefined); let cancelled = 0; let pageCleaned = 0;
    let documentCleaned = 0; let loadingDestroyed = 0;
    const page = { getViewport: () => ({ width: 1, height: 1 }),
        render: () => ({ promise: pending, cancel: () => { cancelled += 1; } }),
        cleanup: () => { pageCleaned += 1; } };
    const document = { numPages: 1, getPage: async () => page,
        cleanup: () => { documentCleaned += 1; return pending; } };
    const loading = { promise: Promise.resolve(document),
        destroy: () => { loadingDestroyed += 1; return pending; } };
    const engine = { getDocument: () => loading,
        createCanvas: () => ({ width: 1, height: 1, getContext: () => ({}), toBuffer: () => PNG_SIGNATURE }) };
    const started = performance.now();
    await assert.rejects(ANYDOC_PDF_PAGE_RENDERER_INTERNAL_TEST_SEAM.renderPage(engine, Buffer.from('%PDF-test')), {
        name: 'PageRenderTimeout',
    });
    assert.ok(performance.now() - started < 500);
    assert.deepEqual([cancelled, pageCleaned, documentCleaned, loadingDestroyed], [1, 1, 1, 1]);
});

test('denies synchronous PNG encoding that returns after the page deadline', async () => {
    const page = { getViewport: () => ({ width: 1, height: 1 }),
        render: () => ({ promise: Promise.resolve(), cancel: () => undefined }), cleanup: () => undefined };
    const document = { numPages: 1, getPage: async () => page, cleanup: async () => undefined };
    const loading = { promise: Promise.resolve(document), destroy: async () => undefined };
    const engine = { getDocument: () => loading, createCanvas: () => ({ width: 1, height: 1, getContext: () => ({}),
        toBuffer: () => { const until = performance.now() + 35; while (performance.now() < until) { /* cooperative stall */ }
            return Buffer.concat([PNG_SIGNATURE, Buffer.from([1])]); } }) };
    await assert.rejects(ANYDOC_PDF_PAGE_RENDERER_INTERNAL_TEST_SEAM.renderPage(engine, Buffer.from('%PDF-test')), {
        name: 'PageRenderTimeout',
    });
});

test('post-fences cooperative synchronous cleanup that returns after the page deadline', async () => {
    const stall = () => { const until = performance.now() + 35; while (performance.now() < until) { /* cooperative stall */ } };
    const page = { getViewport: () => ({ width: 1, height: 1 }),
        render: () => ({ promise: Promise.resolve(), cancel: () => undefined }), cleanup: stall };
    const document = { numPages: 1, getPage: async () => page, cleanup: async () => undefined };
    const loading = { promise: Promise.resolve(document), destroy: async () => undefined };
    const engine = { getDocument: () => loading, createCanvas: () => ({ width: 1, height: 1, getContext: () => ({}),
        toBuffer: () => Buffer.concat([PNG_SIGNATURE, Buffer.from([1])]) }) };
    const started = performance.now();
    await assert.rejects(ANYDOC_PDF_PAGE_RENDERER_INTERNAL_TEST_SEAM.renderPage(engine, Buffer.from('%PDF-test')), {
        name: 'PageRenderTimeout',
    });
    assert.ok(performance.now() - started >= 35);
});

test('enforces per-page and cumulative PNG byte limits without returning partial rasters', async () => {
    const jpeg = syntheticNoiseJpeg(1850);
    const single = await classifiedNoiseFixture(jpeg, 1850, 1);
    const admitted = await renderAnyDocNeedsOcrPages(single.manifest, single.materialization);
    assert.equal(admitted.status, 'rendered');
    if (admitted.status !== 'rendered') return;
    assert.ok(admitted.pages[0]!.pngBytes.byteLength < ANYDOC_PDF_PAGE_RENDERER_MAX_RASTER_BYTES);

    const cumulative = await classifiedNoiseFixture(jpeg, 1850, 3);
    const denied = await renderAnyDocNeedsOcrPages(cumulative.manifest, cumulative.materialization);
    assert.equal(denied.status, 'review_required'); assert.equal('pages' in denied, false);
    if (denied.status === 'review_required') assert.equal(denied.reason, 'resource_limit');
    assert.equal(ANYDOC_PDF_PAGE_RENDERER_MAX_TOTAL_RASTER_BYTES, 32 * 1024 * 1024);
});

test('pins the local engine graph and excludes URL, worker, path, model, parser and persistence surfaces', () => {
    const root = new URL('../../../', import.meta.url);
    const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
    const lock = JSON.parse(readFileSync(new URL('package-lock.json', root), 'utf8'));
    const source = readFileSync(new URL('./anydoc-pdf-page-renderer.ts', import.meta.url), 'utf8');
    assert.equal(pkg.dependencies['pdfjs-dist'], '4.10.38');
    const expected = [
        ['node_modules/pdfjs-dist', '4.10.38', 'sha512-/Y3fcFrXEAsMjJXeL9J8+ZG9U01LbuWaYypvDW2ycW1jL269L3js3DVBjDJ0Up9Np1uqDXsDrRihHANhZOlwdQ==', 'Apache-2.0'],
        ['node_modules/@napi-rs/canvas', '0.1.100', 'sha512-xglYA6q3XO5P3BNJYxVZ1IV7DLVjp1Py6nwag88YntrS+3vKHyYcMqXVS4ZztJmwz2uGvz1FWhI/4LgbR5uQDA==', 'MIT'],
        ['node_modules/@napi-rs/canvas-darwin-arm64', '0.1.100', 'sha512-2PcswRaC7Ly645DGt88///zuFDhJxJYdKAs1uU3mfk1atYkXufgcgLfBpk6Tm12nCQBaNt1wpybuPZ4qOhTo8A==', 'MIT'],
    ];
    for (const [path, version, integrity, license] of expected) assert.deepEqual(
        [lock.packages[path]?.version, lock.packages[path]?.integrity, lock.packages[path]?.license],
        [version, integrity, license],
    );
    for (const [path] of expected) assert.equal(lock.packages[path]?.hasInstallScript, undefined);
    assert.equal(lock.packages['node_modules/@napi-rs/canvas']?.optional, true);
    assert.equal(lock.packages['node_modules/@napi-rs/canvas-darwin-arm64']?.optional, true);
    assert.equal(pkg.dependencies['@napi-rs/canvas'], undefined);
    assert.match(source, /disableWorker: true/u); assert.match(source, /isEvalSupported: false/u);
    assert.match(source, /useSystemFonts: false/u); assert.match(source, /\.cancel\(\)/u);
    assert.match(source, /\.cleanup\(\)/u); assert.match(source, /\.destroy\(\)/u);
    assert.doesNotMatch(source, /Math\.min\(ANYDOC_PDF_PAGE_RENDERER_PAGE_TIMEOUT_MS/u);
    assert.doesNotMatch(source, /\b(?:url|workerSrc|GlobalWorkerOptions)\s*:|fetch\(|https?:|readFile|writeFile|child_process|spawn\(|exec\(|DeepSeek|Ollama|Apple Vision|@firecrawl\/anydoc|app\/api|dbServer|lib\/schema|markdown(?:Bytes|Text|\s*:)/iu);
    assert.equal(renderAnyDocNeedsOcrPages.length, 2);
    assert.equal(ANYDOC_PDF_PAGE_RENDERER_RUNTIME_PROFILE_ID, 'mediflow.pdfjs_png.node24.darwin_arm64.v1');
    assert.equal(sha256(ANYDOC_PDF_PAGE_RENDERER_ENGINE_DESCRIPTOR), ANYDOC_PDF_PAGE_RENDERER_ENGINE_SHA256);
    assert.equal(ANYDOC_PDF_PAGE_RENDERER_ENGINE_SHA256, 'bad022a53e98dd0449e6a4e4b643da80aeabcc80252c949ae2cf2674b757f6d2');
    assert.match(source, /1011b38553532d7078c59f26b15a471f8dae00f101b60e2add9b8511737a1ce0/u);
    assert.match(source, /ec7dc504d4ade7fd36846d16643e50eed5c914335f3a86b6a2a8d632391e5bfa/u);
    assert.match(source, /c7c8dcb69aae6ddb58fe23e5f20d1c772a8065b077560f5a18336307779add91/u);
});
