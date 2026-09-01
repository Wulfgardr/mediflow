/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PDFDocument } from 'pdf-lib';
import {
    ANYDOC_PDF_PAGE_MATERIALIZER_MAX_OUTPUT_BYTES,
    ANYDOC_PDF_PAGE_MATERIALIZER_SHA256,
    materializeAnyDocPdfPages,
} from './anydoc-pdf-page-materializer';
import { ANYDOC_LOCAL_EXTRACTION_MAX_SOURCE_BYTES } from './anydoc-local-extraction-contract';

const ENGINE_SHA256 = 'a7cc1eaf12e41e612a7be581162a63b18118aefc01e90f6a1f35347b1f324a1c';
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const routing = (pageCount: number, pages: readonly number[] = [1]) => ({
    schemaVersion: 'mediflow.anydoc_page_routing.v1' as const, pages, pageCount,
});

function syntheticPdf(widths: readonly number[], sharedByteLength = 1, encrypted = false): Buffer {
    const pageIds = widths.map((_, index) => 4 + index * 2);
    const image = Buffer.alloc(sharedByteLength, 0x78);
    const objects: Buffer[] = [
        Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
        Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${widths.length} >>`),
        Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${sharedByteLength} /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${sharedByteLength} >>\nstream\n`), image, Buffer.from('\nendstream')]),
    ];
    widths.forEach((width, index) => {
        const content = 'q 1 0 0 1 0 0 cm /Im1 Do Q';
        objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} 792] /Resources << /XObject << /Im1 3 0 R >> >> /Contents ${pageIds[index]! + 1} 0 R >>`));
        objects.push(Buffer.from(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    });
    let encryptId: number | null = null;
    if (encrypted) {
        encryptId = objects.length + 1;
        objects.push(Buffer.from('<< /Filter /Standard /V 1 /R 2 /O <0000000000000000000000000000000000000000000000000000000000000000> /U <0000000000000000000000000000000000000000000000000000000000000000> /P -4 >>'));
    }
    const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')]; const offsets: number[] = [];
    objects.forEach((object, index) => {
        offsets.push(parts.reduce((sum, part) => sum + part.byteLength, 0));
        parts.push(Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n'));
    });
    const xrefOffset = parts.reduce((sum, part) => sum + part.byteLength, 0);
    const xref = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encryptId ? ` /Encrypt ${encryptId} 0 R` : ''} >>\nstartxref\n${xrefOffset}\n%%EOF\n`));
    return Buffer.concat(parts);
}

test('materializes every source page once, in order, with deterministic digest-bound receipts', async () => {
    const source = syntheticPdf([611, 622, 633]); const sourceSha256 = sha256(source);
    const first = await materializeAnyDocPdfPages(source, sourceSha256, routing(3, [1, 3]));
    const second = await materializeAnyDocPdfPages(source, sourceSha256, routing(3, [1, 3]));

    assert.equal(first.status, 'materialized'); assert.equal(second.status, 'materialized');
    if (first.status !== 'materialized' || second.status !== 'materialized') return;
    assert.deepEqual(first.pages.map((page) => page.page), [1, 2, 3]);
    assert.deepEqual(await Promise.all(first.pages.map(async ({ pdfBytes }) => {
        const pdf = await PDFDocument.load(pdfBytes); return [pdf.getPageCount(), pdf.getPage(0).getWidth()];
    })), [[1, 611], [1, 622], [1, 633]]);
    assert.deepEqual(first.pages.map((page) => Buffer.compare(page.pdfBytes, second.pages[page.page - 1]!.pdfBytes)), [0, 0, 0]);
    for (const page of first.pages) assert.deepEqual(page.receipt, {
        sourceSha256, sourceByteLength: source.byteLength, page: page.page,
        pageSha256: sha256(page.pdfBytes), pageByteLength: page.pdfBytes.byteLength,
        materializerSha256: ENGINE_SHA256,
    });
    assert.equal(ANYDOC_PDF_PAGE_MATERIALIZER_SHA256, ENGINE_SHA256);
    assert.equal('text' in first, false); assert.equal('routing' in first, false);
});

test('copies source bytes synchronously and rejects a source digest mismatch without output', async () => {
    const source = syntheticPdf([612]); const sourceSha256 = sha256(source); const callerBytes = Buffer.from(source);
    const pending = materializeAnyDocPdfPages(callerBytes, sourceSha256, routing(1)); callerBytes.fill(0);
    assert.equal((await pending).status, 'materialized');
    const mismatch = await materializeAnyDocPdfPages(source, '0'.repeat(64), routing(1));
    assert.deepEqual(mismatch, {
        schemaVersion: 'mediflow.anydoc_pdf_page_materializer.v1', status: 'review_required',
        reason: 'source_digest_mismatch', review: 'required', writes: 0, apply: 'none',
    });
    assert.equal('pages' in mismatch, false);
});

test('fails closed for malformed, encrypted, page-count mismatch and invalid routing evidence', async () => {
    const malformed = Buffer.from('%PDF-1.4\nmalformed\n'); const encrypted = syntheticPdf([612], 1, true);
    for (const source of [malformed, encrypted]) {
        const result = await materializeAnyDocPdfPages(source, sha256(source), routing(1));
        assert.equal(result.status, 'review_required');
        if (result.status === 'review_required') assert.equal(result.reason, 'malformed_or_encrypted_pdf');
    }
    const twoPages = syntheticPdf([612, 613]);
    const mismatch = await materializeAnyDocPdfPages(twoPages, sha256(twoPages), routing(3));
    assert.equal(mismatch.status, 'review_required');
    if (mismatch.status === 'review_required') assert.equal(mismatch.reason, 'page_count_mismatch');
    const invalid = await materializeAnyDocPdfPages(twoPages, sha256(twoPages), routing(2, [2, 1]));
    assert.equal(invalid.status, 'review_required');
    if (invalid.status === 'review_required') assert.equal(invalid.reason, 'invalid_routing');
    let reads = 0; const accessorPages = [1];
    Object.defineProperty(accessorPages, '0', { enumerable: true, get() { reads += 1; throw new Error('raw'); } });
    const hostile = await materializeAnyDocPdfPages(twoPages, sha256(twoPages), routing(2, accessorPages));
    assert.equal(hostile.status, 'review_required'); assert.equal(reads, 0);
});

test('enforces source, page-count and cumulative output byte limits without partial pages', async () => {
    const oversized = Buffer.alloc(ANYDOC_LOCAL_EXTRACTION_MAX_SOURCE_BYTES + 1);
    let result = await materializeAnyDocPdfPages(oversized, sha256(oversized), routing(1));
    assert.equal(result.status, 'review_required');
    if (result.status === 'review_required') assert.equal(result.reason, 'resource_limit');
    const source = syntheticPdf([612]);
    result = await materializeAnyDocPdfPages(source, sha256(source), routing(501));
    assert.equal(result.status, 'review_required');
    if (result.status === 'review_required') assert.equal(result.reason, 'invalid_routing');
    const amplified = syntheticPdf(Array.from({ length: 14 }, (_, index) => 612 + index), 2 * 1024 * 1024);
    assert.ok(amplified.byteLength < ANYDOC_PDF_PAGE_MATERIALIZER_MAX_OUTPUT_BYTES);
    result = await materializeAnyDocPdfPages(amplified, sha256(amplified), routing(14));
    assert.equal(result.status, 'review_required'); assert.equal('pages' in result, false);
    if (result.status === 'review_required') assert.equal(result.reason, 'resource_limit');
});

test('pins the reviewed engine graph and excludes renderer, parser, routing and fallback imports', () => {
    const root = new URL('../../../', import.meta.url); const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
    const lock = JSON.parse(readFileSync(new URL('package-lock.json', root), 'utf8')); const source = readFileSync(new URL('./anydoc-pdf-page-materializer.ts', import.meta.url), 'utf8');
    assert.equal(pkg.dependencies['pdf-lib'], '1.17.1');
    const expected = [
        ['node_modules/pdf-lib', '1.17.1', 'sha512-V/mpyJAoTsN4cnP31vc0wfNA1+p20evqqnap0KLoRUN0Yk/p3wN52DOEsL4oBFcLdb76hlpKPtzJIgo67j/XLw==', 'MIT'],
        ['node_modules/@pdf-lib/standard-fonts', '1.0.0', 'sha512-hU30BK9IUN/su0Mn9VdlVKsWBS6GyhVfqjwl1FjZN4TxP6cCw0jP2w7V3Hf5uX7M0AZJ16vey9yE0ny7Sa59ZA==', 'MIT'],
        ['node_modules/@pdf-lib/upng', '1.0.1', 'sha512-dQK2FUMQtowVP00mtIksrlZhdFXQZPC+taih1q4CvPZ5vqdxR/LKBaFg0oAfzd1GlHZXXSPdQfzQnt+ViGvEIQ==', 'MIT'],
        ['node_modules/pdf-lib/node_modules/pako', '1.0.11', 'sha512-4hLB8Py4zZce5s4yd9XzopqwVv/yGNhV1Bl8NTmCq1763HeK2+EwVTv+leGeL13Dnh2wfbqowVPXCIO0z4taYw==', '(MIT AND Zlib)'],
        ['node_modules/@pdf-lib/standard-fonts/node_modules/pako', '1.0.11', 'sha512-4hLB8Py4zZce5s4yd9XzopqwVv/yGNhV1Bl8NTmCq1763HeK2+EwVTv+leGeL13Dnh2wfbqowVPXCIO0z4taYw==', '(MIT AND Zlib)'],
        ['node_modules/@pdf-lib/upng/node_modules/pako', '1.0.11', 'sha512-4hLB8Py4zZce5s4yd9XzopqwVv/yGNhV1Bl8NTmCq1763HeK2+EwVTv+leGeL13Dnh2wfbqowVPXCIO0z4taYw==', '(MIT AND Zlib)'],
        ['node_modules/pdf-lib/node_modules/tslib', '1.14.1', 'sha512-Xni35NKzjgMrwevysHTCArtLDpPvye8zV/0E4EyYn43P7/7qvQwPh9BGkHewbMulVntbigmcT7rdX3BNo9wRJg==', '0BSD'],
    ];
    for (const [path, version, integrity, license] of expected) assert.deepEqual(
        [lock.packages[path]?.version, lock.packages[path]?.integrity, lock.packages[path]?.license],
        [version, integrity, license],
    );
    for (const [path] of expected) assert.equal(lock.packages[path]?.hasInstallScript, undefined);
    assert.match(source, /from 'pdf-lib'/u); assert.match(source, /ignoreEncryption: false/u); assert.match(source, /copyPages\(/u); assert.match(source, /\.addPage\(/u); assert.match(source, /\.save\(/u);
    assert.doesNotMatch(source, /@firecrawl\/anydoc|pdfjs-dist|jspdf|pdf-inspector|render|extractText|fetch\(|https?:/iu);
});
