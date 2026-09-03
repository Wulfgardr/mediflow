/* @Codex */
import { createHash } from 'node:crypto';
import { types } from 'node:util';

import { buildAnyDocPageManifest } from './anydoc-page-manifest';
import { materializeAnyDocPdfPages } from './anydoc-pdf-page-materializer';
import { ANYDOC_PDF_PAGE_RENDERER_MAX_PAGES, renderAnyDocNeedsOcrPages } from './anydoc-pdf-page-renderer';
import { extractAnyDocAppleVisionImage } from './anydoc-apple-vision-ocr';
import {
    ANYDOC_LOCAL_EXTRACTION_MAX_MARKDOWN_BYTES,
    buildAnyDocLocalExtraction,
    mapAnyDocLocalFailure,
    type LocalExtractionFailure,
    type LocalExtractionResult,
} from './anydoc-local-extraction-contract';
import { extractAnyDocLocalBytes, extractAnyDocPageRoutingBytes } from './anydoc-local-extraction-runner';

const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
function originalFailure(input: LocalExtractionResult): input is LocalExtractionFailure {
    return input.status === 'review_required' && input.detail === 'image_or_scan'
        && input.receipt.outcome === 'review_required:image_or_scan';
}

/** Continues only an AnyDoc image_or_scan result; the outer source authority retains final currentness. */
export async function continueAnyDocImageOrScanWithAppleVision(
    attachmentId: string, input: unknown, initial: LocalExtractionResult,
): Promise<LocalExtractionResult> {
    if (!originalFailure(initial) || initial.provenance.attachmentId !== attachmentId
        || types.isProxy(input) || !(input instanceof Uint8Array)) return initial;
    let bytes: Buffer; try { bytes = Buffer.from(input); } catch { return initial; }
    const sourceSha256 = sha256(bytes);
    if (bytes.byteLength !== initial.provenance.byteLength || sourceSha256 !== initial.provenance.sourceSha256) return initial;
    const source = { attachmentId, sourceSha256, byteLength: bytes.byteLength };
    const routing = await extractAnyDocPageRoutingBytes(bytes);
    if (!routing || routing.pageCount > ANYDOC_PDF_PAGE_RENDERER_MAX_PAGES) return initial;
    const materialization = await materializeAnyDocPdfPages(bytes, sourceSha256, routing);
    if (materialization.status !== 'materialized') return initial;

    // This content-only binding never leaves the fallback. Database currentness remains owned by finalize().
    const manifest = await buildAnyDocPageManifest({ documentSourceRef: sourceSha256, documentRevision: 1,
        documentFreshnessEpoch: 1, sourceSha256, sourceByteLength: bytes.byteLength }, routing, materialization);
    if (manifest.status !== 'classified') return initial;
    const rendering = await renderAnyDocNeedsOcrPages(manifest, materialization);
    if (rendering.status !== 'rendered') return initial;
    const rendered = new Map(rendering.pages.map((page) => [page.page, page] as const));
    const output: string[] = [];
    for (let pageIndex = 0; pageIndex < manifest.pageCount; pageIndex += 1) {
        const page = manifest.pages[pageIndex]; const materialized = materialization.pages[pageIndex];
        if (!page || !materialized || page.page !== pageIndex + 1 || materialized.page !== page.page) return initial;
        let text: string;
        if (page.status === 'needsOcr') {
            const raster = rendered.get(page.page); if (!raster) return initial;
            const recognition = await extractAnyDocAppleVisionImage(raster.pngBytes);
            if (recognition.status !== 'recognized') {
                return recognition.reason === 'empty_output'
                    ? buildAnyDocLocalExtraction(source, '')
                    : mapAnyDocLocalFailure(source, recognition.reason === 'resource_limit' ? 'resourceLimit' : 'io');
            }
            if (recognition.receipt.inputSha256 !== raster.receipt.rasterSha256
                || recognition.receipt.inputByteLength !== raster.receipt.rasterByteLength) return initial;
            text = recognition.text;
        } else if (page.status === 'native') {
            const native = await extractAnyDocLocalBytes(`${sourceSha256}:p${page.page}`, materialized.pdfBytes);
            if (native.status !== 'extracted' || native.provenance.sourceSha256 !== page.pageSha256
                || native.receipt.markdownSha256 !== page.nativeEvidence?.markdownSha256) return initial;
            text = native.markdown;
        } else return initial;
        output.push(manifest.pageCount === 1 ? text : `## Pagina ${page.page}\n\n${text}`);
    }
    const markdown = output.join('\n\n---\n\n');
    return Buffer.byteLength(markdown, 'utf8') > ANYDOC_LOCAL_EXTRACTION_MAX_MARKDOWN_BYTES
        ? mapAnyDocLocalFailure(source, 'resourceLimit')
        : buildAnyDocLocalExtraction(source, markdown);
}
