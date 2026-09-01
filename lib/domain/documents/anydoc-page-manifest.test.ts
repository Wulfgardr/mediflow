/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { ANYDOC_PAGE_MANIFEST_SCHEMA_VERSION, buildAnyDocPageManifest } from './anydoc-page-manifest';
import { ANYDOC_PDF_PAGE_MATERIALIZER_MAX_OUTPUT_BYTES, ANYDOC_PDF_PAGE_MATERIALIZER_SHA256,
    materializeAnyDocPdfPages } from './anydoc-pdf-page-materializer';
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const SOURCE_REF = 'a'.repeat(64);
const routing = (pageCount: number, pages: readonly number[]) =>
    ({ schemaVersion: 'mediflow.anydoc_page_routing.v1' as const, pages, pageCount });
const sourceBinding = (source: Uint8Array) => ({ documentSourceRef: SOURCE_REF, documentRevision: 7,
    documentFreshnessEpoch: 11, sourceSha256: sha256(source), sourceByteLength: source.byteLength });
async function syntheticPdf(pageKinds: readonly ('text' | 'scan')[]): Promise<Buffer> {
    const pdf = await PDFDocument.create({ updateMetadata: false });
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const image = await pdf.embedPng(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
    pageKinds.forEach((kind, index) => {
        const page = pdf.addPage([612, 792]);
        if (kind === 'text') page.drawText(`Synthetic page ${index + 1}`, { x: 72, y: 700, font, size: 18 });
        else page.drawImage(image, { x: 72, y: 72, width: 468, height: 648 });
    });
    return Buffer.from(await pdf.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false }));
}
async function materialized(kinds: readonly ('text' | 'scan')[], needsOcrPages: readonly number[]) {
    const source = await syntheticPdf(kinds); const evidence = routing(kinds.length, needsOcrPages);
    const pages = await materializeAnyDocPdfPages(source, sha256(source), evidence);
    assert.equal(pages.status, 'materialized');
    if (pages.status !== 'materialized') throw new Error('synthetic materialization failed');
    return { source, evidence, pages };
}
test('classifies a mixed PDF in stable order and publishes no partial native text', async () => {
    const fixture = await materialized(['text', 'scan', 'text'], [2]);
    const result = await buildAnyDocPageManifest(sourceBinding(fixture.source), fixture.evidence, fixture.pages);

    assert.equal(result.schemaVersion, ANYDOC_PAGE_MANIFEST_SCHEMA_VERSION);
    assert.equal(result.status, 'classified', JSON.stringify(result));
    assert.equal(result.reason, null);
    assert.deepEqual(result.pages.map((page) => [page.page, page.status]), [[1, 'native'], [2, 'needsOcr'], [3, 'native']]);
    assert.deepEqual(result.sourceBinding, sourceBinding(fixture.source));
    assert.equal(result.review, 'required'); assert.equal(result.writes, 0); assert.equal(result.apply, 'none');
    assert.ok((result.pages[0]?.nativeEvidence?.markdownByteLength ?? 0) > 0);
    assert.match(result.pages[0]?.nativeEvidence?.markdownSha256 ?? '', /^[a-f0-9]{64}$/u);
    assert.equal(result.pages[1]?.nativeEvidence, null);
    assert.doesNotMatch(JSON.stringify(result), /Synthetic page/u);
    assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.pages), true);
});
test('keeps every originally flagged scanned page out of the isolated native rerun', async () => {
    const fixture = await materialized(['scan', 'scan'], [1, 2]);
    const result = await buildAnyDocPageManifest(sourceBinding(fixture.source), fixture.evidence, fixture.pages);

    assert.equal(result.status, 'classified', JSON.stringify(result));
    assert.deepEqual(result.pages.map((page) => page.status), ['needsOcr', 'needsOcr']);
    assert.deepEqual(result.pages.map((page) => page.nativeEvidence), [null, null]);
});
test('fails the whole manifest without partial Markdown when an alleged native complement still needs OCR', async () => {
    const fixture = await materialized(['text', 'scan', 'scan'], [3]);
    const result = await buildAnyDocPageManifest(sourceBinding(fixture.source), fixture.evidence, fixture.pages);

    assert.equal(result.status, 'review_required'); assert.equal(result.reason, 'isolated_anydoc_failure');
    assert.deepEqual(result.pages.map((page) => [page.page, page.status]), [[1, 'native'], [2, 'review_required'], [3, 'needsOcr']]);
    assert.deepEqual(Object.keys(result.pages[0]?.nativeEvidence ?? {}), ['receiptId', 'markdownSha256', 'markdownByteLength']);
    assert.doesNotMatch(JSON.stringify(result), /Synthetic page|"markdown"/u);
});
test('fails closed on source, routing, page-count, order and digest mismatches', async () => {
    const fixture = await materialized(['text', 'scan'], [2]);
    const source = sourceBinding(fixture.source);
    const cases: Array<[unknown, unknown, unknown, string]> = [
        [{ ...source, documentRevision: 0 }, fixture.evidence, fixture.pages, 'invalid_source_binding'],
        [{ ...source, sourceSha256: '0'.repeat(64) }, fixture.evidence, fixture.pages, 'source_binding_mismatch'],
        [source, routing(3, [2]), fixture.pages, 'routing_materialization_mismatch'],
        [source, fixture.evidence, { ...fixture.pages, pages: [fixture.pages.pages[1], fixture.pages.pages[0]] }, 'page_evidence_mismatch'],
        [source, fixture.evidence, { ...fixture.pages, pages: fixture.pages.pages.slice(0, 1) }, 'page_evidence_mismatch'],
        [source, fixture.evidence, { ...fixture.pages, pages: fixture.pages.pages.map((page, index) => index === 0
            ? { ...page, receipt: { ...page.receipt, pageSha256: '0'.repeat(64) } } : page) }, 'page_evidence_mismatch'],
    ];
    for (const [binding, evidence, pages, reason] of cases) {
        const result = await buildAnyDocPageManifest(binding, evidence, pages);
        assert.equal(result.status, 'review_required'); assert.equal(result.reason, reason);
        assert.deepEqual(result.pages, []);
    }
});
test('denies revoked routing and materialization page arrays without throwing', async () => {
    const fixture = await materialized(['text', 'scan'], [2]); const binding = sourceBinding(fixture.source);
    const routingPages = Proxy.revocable([...fixture.evidence.pages], {}); routingPages.revoke();
    let result = await buildAnyDocPageManifest(binding, { ...fixture.evidence, pages: routingPages.proxy }, fixture.pages);
    assert.equal(result.status, 'review_required'); assert.equal(result.reason, 'invalid_routing');
    const materializedPages = Proxy.revocable([...fixture.pages.pages], {}); materializedPages.revoke();
    result = await buildAnyDocPageManifest(binding, fixture.evidence, { ...fixture.pages, pages: materializedPages.proxy });
    assert.equal(result.status, 'review_required'); assert.equal(result.reason, 'page_evidence_mismatch');
});
test('rejects cumulative materialized output beyond the reviewed bound before parsing', async () => {
    const fixture = await materialized(['scan'], [1]);
    const bytes = Buffer.alloc(ANYDOC_PDF_PAGE_MATERIALIZER_MAX_OUTPUT_BYTES + 1);
    const oversized = {
        ...fixture.pages,
        pages: [{ page: 1, pdfBytes: bytes, receipt: { sourceSha256: fixture.pages.sourceSha256,
            sourceByteLength: fixture.pages.sourceByteLength, page: 1, pageSha256: '0'.repeat(64),
            pageByteLength: bytes.byteLength, materializerSha256: ANYDOC_PDF_PAGE_MATERIALIZER_SHA256 } }],
    };
    const result = await buildAnyDocPageManifest(sourceBinding(fixture.source), fixture.evidence, oversized);

    assert.equal(result.status, 'review_required'); assert.equal(result.reason, 'resource_limit');
    assert.deepEqual(result.pages, []);
});
test('copies currentness and materialized page bytes before the first asynchronous rerun', async () => {
    const fixture = await materialized(['text', 'scan'], [2]);
    const binding = sourceBinding(fixture.source);
    const originalPageSha256 = fixture.pages.pages[0]!.receipt.pageSha256;
    const pending = buildAnyDocPageManifest(binding, fixture.evidence, fixture.pages);
    binding.documentRevision = 99;
    fixture.pages.pages[0]!.pdfBytes.fill(0);
    const result = await pending;

    assert.equal(result.status, 'classified');
    assert.equal(result.sourceBinding?.documentRevision, 7);
    assert.equal(result.pages[0]?.pageSha256, originalPageSha256);
    assert.equal(result.pages[0]?.status, 'native');
});
test('keeps the packet local-only and excludes renderer, model, route and persistence boundaries', () => {
    const source = readFileSync(new URL('./anydoc-page-manifest.ts', import.meta.url), 'utf8');
    assert.match(source, /extractAnyDocLocalBytes/u); assert.match(source, /'needsOcr'/u); assert.doesNotMatch(source, /needs_ocr/u);
    assert.doesNotMatch(source, /pdf-lib|DeepSeek|render|fetch\(|https?:|app\/api|dbServer|lib\/schema|Ollama|Apple Vision/iu);
});
