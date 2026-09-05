/* @Codex */
import { createHash } from 'node:crypto';
import { types } from 'node:util';

import { ANYDOC_LOCAL_EXTRACTION_MAX_MARKDOWN_BYTES, ANYDOC_LOCAL_EXTRACTION_MAX_SOURCE_BYTES } from './anydoc-local-extraction-contract';
import { ANYDOC_PAGE_ROUTING_MAX_PAGE_COUNT, ANYDOC_PAGE_ROUTING_SCHEMA_VERSION, extractAnyDocLocalBytes } from './anydoc-local-extraction-runner';
import { ANYDOC_PDF_PAGE_MATERIALIZER_MAX_OUTPUT_BYTES, ANYDOC_PDF_PAGE_MATERIALIZER_SCHEMA_VERSION,
    ANYDOC_PDF_PAGE_MATERIALIZER_SHA256 } from './anydoc-pdf-page-materializer';

export const ANYDOC_PAGE_MANIFEST_SCHEMA_VERSION = 'mediflow.anydoc_page_manifest.v1' as const;
export type AnyDocPageManifestPageStatus = 'native' | 'needsOcr' | 'review_required';
export type AnyDocPageManifestFailureReason =
    | 'invalid_source_binding' | 'invalid_routing' | 'invalid_materialization'
    | 'source_binding_mismatch' | 'routing_materialization_mismatch'
    | 'page_evidence_mismatch' | 'resource_limit' | 'isolated_anydoc_failure';
export type AnyDocPageManifestSourceBinding = Readonly<{ documentSourceRef: string; documentRevision: number;
    documentFreshnessEpoch: number; sourceSha256: string; sourceByteLength: number }>;
export type AnyDocPageNativeEvidence = Readonly<{ receiptId: string; markdownSha256: string; markdownByteLength: number }>;
export interface AnyDocPageManifestEntry {
    readonly page: number; readonly status: AnyDocPageManifestPageStatus; readonly pageSha256: string;
    readonly pageByteLength: number; readonly materializerSha256: typeof ANYDOC_PDF_PAGE_MATERIALIZER_SHA256;
    readonly nativeEvidence: AnyDocPageNativeEvidence | null;
}
export interface AnyDocPageManifestResult {
    readonly schemaVersion: typeof ANYDOC_PAGE_MANIFEST_SCHEMA_VERSION; readonly status: 'classified' | 'review_required';
    readonly reason: AnyDocPageManifestFailureReason | null; readonly sourceBinding: AnyDocPageManifestSourceBinding | null;
    readonly routingSha256: string | null; readonly pageCount: number; readonly pages: readonly AnyDocPageManifestEntry[];
    readonly review: 'required'; readonly writes: 0; readonly apply: 'none';
}
type Routing = Readonly<{ pages: readonly number[]; pageCount: number }>;
type PageSnapshot = Readonly<{ page: number; pdfBytes: Buffer; pageSha256: string; pageByteLength: number }>;
type SnapshotResult = Readonly<{ pages: readonly PageSnapshot[]; failure: null }>
    | Readonly<{ pages: null; failure: AnyDocPageManifestFailureReason }>;
type Exact = Record<string, unknown>;
const SHA256 = /^[a-f0-9]{64}$/u;
const SOURCE_REF = /^[a-f0-9]{64}$/u;
const EMPTY_PAGES = Object.freeze([]) as readonly AnyDocPageManifestEntry[];
const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
function exact(value: unknown, keys: readonly string[]): Exact | null {
    if (!value || typeof value !== 'object' || types.isProxy(value)
        || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== keys.length) return null;
    const result: Exact = Object.create(null);
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return null;
        result[key] = descriptor.value;
    }
    return result;
}
function arrayValues(value: unknown, maximum: number): readonly unknown[] | null {
    if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<string, PropertyDescriptor>;
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum
        || Reflect.ownKeys(descriptors).length !== length + 1) return null;
    const output: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[index];
        if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return null;
        output.push(descriptor.value);
    }
    return output;
}
function sourceBinding(value: unknown): AnyDocPageManifestSourceBinding | null {
    const input = exact(value, [
        'documentSourceRef', 'documentRevision', 'documentFreshnessEpoch', 'sourceSha256', 'sourceByteLength',
    ]);
    if (!input || typeof input.documentSourceRef !== 'string' || !SOURCE_REF.test(input.documentSourceRef)
        || !Number.isSafeInteger(input.documentRevision) || (input.documentRevision as number) < 1
        || !Number.isSafeInteger(input.documentFreshnessEpoch) || (input.documentFreshnessEpoch as number) < 1
        || typeof input.sourceSha256 !== 'string' || !SHA256.test(input.sourceSha256)
        || !Number.isSafeInteger(input.sourceByteLength) || (input.sourceByteLength as number) < 1
        || (input.sourceByteLength as number) > ANYDOC_LOCAL_EXTRACTION_MAX_SOURCE_BYTES) return null;
    return Object.freeze({ documentSourceRef: input.documentSourceRef, documentRevision: input.documentRevision as number,
        documentFreshnessEpoch: input.documentFreshnessEpoch as number, sourceSha256: input.sourceSha256,
        sourceByteLength: input.sourceByteLength as number });
}
function routing(value: unknown): Routing | null {
    const input = exact(value, ['schemaVersion', 'pages', 'pageCount']);
    const pages = arrayValues(input?.pages, ANYDOC_PAGE_ROUTING_MAX_PAGE_COUNT);
    if (!input || input.schemaVersion !== ANYDOC_PAGE_ROUTING_SCHEMA_VERSION || !pages
        || !Number.isSafeInteger(input.pageCount) || (input.pageCount as number) < 1
        || (input.pageCount as number) > ANYDOC_PAGE_ROUTING_MAX_PAGE_COUNT
        || pages.length < 1 || pages.length > (input.pageCount as number)
        || pages.some((page, index) => !Number.isSafeInteger(page) || (page as number) < 1
            || (page as number) > (input.pageCount as number)
            || (index > 0 && (page as number) <= (pages[index - 1] as number)))) return null;
    return Object.freeze({ pages: Object.freeze(pages as number[]), pageCount: input.pageCount as number });
}
function denied(reason: AnyDocPageManifestFailureReason): AnyDocPageManifestResult {
    return Object.freeze({
        schemaVersion: ANYDOC_PAGE_MANIFEST_SCHEMA_VERSION, status: 'review_required', reason,
        sourceBinding: null, routingSha256: null, pageCount: 0, pages: EMPTY_PAGES,
        review: 'required', writes: 0, apply: 'none',
    });
}
const snapshotFailure = (failure: AnyDocPageManifestFailureReason): SnapshotResult =>
    Object.freeze({ pages: null, failure });
function snapshotPages(value: unknown, source: AnyDocPageManifestSourceBinding, route: Routing): SnapshotResult {
    const input = exact(value, [
        'schemaVersion', 'status', 'sourceSha256', 'sourceByteLength', 'pageCount', 'pages', 'review', 'writes', 'apply',
    ]);
    if (!input || input.schemaVersion !== ANYDOC_PDF_PAGE_MATERIALIZER_SCHEMA_VERSION || input.status !== 'materialized'
        || input.review !== 'required' || input.writes !== 0 || input.apply !== 'none'
        || typeof input.sourceSha256 !== 'string' || !SHA256.test(input.sourceSha256)
        || !Number.isSafeInteger(input.sourceByteLength) || !Number.isSafeInteger(input.pageCount))
        return snapshotFailure('invalid_materialization');
    if (input.sourceSha256 !== source.sourceSha256 || input.sourceByteLength !== source.sourceByteLength)
        return snapshotFailure('source_binding_mismatch');
    if (input.pageCount !== route.pageCount)
        return snapshotFailure('routing_materialization_mismatch');
    const values = arrayValues(input.pages, route.pageCount);
    if (!values || values.length !== route.pageCount)
        return snapshotFailure('page_evidence_mismatch');
    const output: PageSnapshot[] = []; let totalBytes = 0;
    for (let index = 0; index < values.length; index += 1) {
        const page = exact(values[index], ['page', 'pdfBytes', 'receipt']);
        const receipt = exact(page?.receipt, [
            'sourceSha256', 'sourceByteLength', 'page', 'pageSha256', 'pageByteLength', 'materializerSha256',
        ]);
        if (!page || page.page !== index + 1 || !receipt || receipt.page !== index + 1
            || receipt.sourceSha256 !== source.sourceSha256 || receipt.sourceByteLength !== source.sourceByteLength
            || typeof receipt.pageSha256 !== 'string' || !SHA256.test(receipt.pageSha256)
            || !Number.isSafeInteger(receipt.pageByteLength) || (receipt.pageByteLength as number) < 1
            || receipt.materializerSha256 !== ANYDOC_PDF_PAGE_MATERIALIZER_SHA256
            || types.isProxy(page.pdfBytes) || !(page.pdfBytes instanceof Uint8Array))
            return snapshotFailure('page_evidence_mismatch');
        let pdfBytes: Buffer;
        try { pdfBytes = Buffer.from(page.pdfBytes); }
        catch { return snapshotFailure('page_evidence_mismatch'); }
        totalBytes += pdfBytes.byteLength;
        if (pdfBytes.byteLength > ANYDOC_PDF_PAGE_MATERIALIZER_MAX_OUTPUT_BYTES
            || totalBytes > ANYDOC_PDF_PAGE_MATERIALIZER_MAX_OUTPUT_BYTES)
            return snapshotFailure('resource_limit');
        if (receipt.pageByteLength !== pdfBytes.byteLength || sha256(pdfBytes) !== receipt.pageSha256)
            return snapshotFailure('page_evidence_mismatch');
        output.push(Object.freeze({ page: index + 1, pdfBytes, pageSha256: receipt.pageSha256, pageByteLength: pdfBytes.byteLength }));
    }
    return Object.freeze({ pages: Object.freeze(output), failure: null });
}
function pageEntry(page: PageSnapshot, status: AnyDocPageManifestPageStatus,
    nativeEvidence: AnyDocPageNativeEvidence | null): AnyDocPageManifestEntry {
    return Object.freeze({ page: page.page, status, pageSha256: page.pageSha256,
        pageByteLength: page.pageByteLength, materializerSha256: ANYDOC_PDF_PAGE_MATERIALIZER_SHA256, nativeEvidence });
}
async function classify(source: AnyDocPageManifestSourceBinding, route: Routing,
    snapshots: readonly PageSnapshot[]): Promise<AnyDocPageManifestResult> {
    const needsOcr = new Set(route.pages); const pages: AnyDocPageManifestEntry[] = []; let failed = false;
    for (const page of snapshots) {
        if (needsOcr.has(page.page)) { pages.push(pageEntry(page, 'needsOcr', null)); continue; }
        const result = await extractAnyDocLocalBytes(`${source.documentSourceRef}:page:${page.page}`, page.pdfBytes);
        const markdownSha256 = result.status === 'extracted' ? result.receipt.markdownSha256 : undefined;
        const valid = result.status === 'extracted' && typeof markdownSha256 === 'string' && SHA256.test(markdownSha256)
            && result.provenance.sourceSha256 === page.pageSha256 && result.provenance.byteLength === page.pageByteLength
            && result.receipt.sourceSha256 === page.pageSha256 && result.receipt.sourceByteLength === page.pageByteLength
            && result.receipt.parser === 'anydoc-local' && result.receipt.outcome === 'extracted'
            && SHA256.test(result.receipt.receiptId) && result.receipt.markdownByteLength > 0
            && result.receipt.markdownByteLength <= ANYDOC_LOCAL_EXTRACTION_MAX_MARKDOWN_BYTES
            && Buffer.byteLength(result.markdown, 'utf8') === result.receipt.markdownByteLength
            && sha256(result.markdown) === markdownSha256;
        if (!valid) { failed = true; pages.push(pageEntry(page, 'review_required', null)); continue; }
        pages.push(pageEntry(page, 'native', Object.freeze({ receiptId: result.receipt.receiptId,
            markdownSha256, markdownByteLength: result.receipt.markdownByteLength })));
    }
    return Object.freeze({
        schemaVersion: ANYDOC_PAGE_MANIFEST_SCHEMA_VERSION,
        status: failed ? 'review_required' : 'classified',
        reason: failed ? 'isolated_anydoc_failure' : null,
        sourceBinding: source,
        routingSha256: sha256(`${ANYDOC_PAGE_ROUTING_SCHEMA_VERSION}|${route.pageCount}|${route.pages.join(',')}`),
        pageCount: route.pageCount, pages: Object.freeze(pages), review: 'required', writes: 0, apply: 'none',
    });
}
/** Snapshots validated evidence synchronously, then reruns AnyDoc only for the original native complement. */
export function buildAnyDocPageManifest(
    sourceInput: unknown, routingInput: unknown, materializationInput: unknown,
): Promise<AnyDocPageManifestResult> {
    const source = sourceBinding(sourceInput); if (!source) return Promise.resolve(denied('invalid_source_binding'));
    const route = routing(routingInput); if (!route) return Promise.resolve(denied('invalid_routing'));
    const snapshot = snapshotPages(materializationInput, source, route);
    return snapshot.pages ? classify(source, route, snapshot.pages) : Promise.resolve(denied(snapshot.failure));
}
