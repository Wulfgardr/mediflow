/* @Codex */
import { createHash } from 'node:crypto';
import { types } from 'node:util';

import { ANYDOC_LOCAL_EXTRACTION_MAX_SOURCE_BYTES } from './anydoc-local-extraction-contract';
import {
    ANYDOC_PAGE_ROUTING_MAX_PAGE_COUNT,
    ANYDOC_PAGE_ROUTING_SCHEMA_VERSION,
    type AnyDocPageRoutingEvidence,
} from './anydoc-local-extraction-runner';
import {
    ANYDOC_PDF_CHILD_PROTOCOL_SCHEMA_VERSION,
    ANYDOC_PDF_CHILD_MAX_OLD_SPACE_MB,
    ANYDOC_PDF_CHILD_WORKER_SHA256,
    runAnyDocPdfMaterializationChild,
    type AnyDocPdfChildFailureReason,
} from './anydoc-pdf-child-process-owner';

export const ANYDOC_PDF_PAGE_MATERIALIZER_SCHEMA_VERSION = 'mediflow.anydoc_pdf_page_materializer.v1' as const;
export const ANYDOC_PDF_PAGE_MATERIALIZER_MAX_OUTPUT_BYTES = 25 * 1024 * 1024;
export const ANYDOC_PDF_PAGE_MATERIALIZER_DESCRIPTOR = [
    'engine=pdf-lib@1.17.1',
    `isolation=${ANYDOC_PDF_CHILD_PROTOCOL_SCHEMA_VERSION};workerSha256=${ANYDOC_PDF_CHILD_WORKER_SHA256};maxOldSpaceMb=${ANYDOC_PDF_CHILD_MAX_OLD_SPACE_MB};permission=readOnlyPackageRoot,noWrite,noChild,noWorker;addons=denied;networkGuard=closedImportsAndGlobals`,
    `limits=source:${ANYDOC_LOCAL_EXTRACTION_MAX_SOURCE_BYTES},pages:${ANYDOC_PAGE_ROUTING_MAX_PAGE_COUNT},output:${ANYDOC_PDF_PAGE_MATERIALIZER_MAX_OUTPUT_BYTES}`,
    'options=ignoreEncryption:false,throwOnInvalidObject:true,updateMetadata:false,useObjectStreams:false',
].join('\n');
export const ANYDOC_PDF_PAGE_MATERIALIZER_SHA256 = '750792ee20855cf0060a5936efd9ad72907ab612db43c9ec28ff2d323918d8db' as const;

export type AnyDocPdfPageMaterializationFailureReason =
    | 'invalid_input' | 'source_digest_mismatch' | 'invalid_routing'
    | 'malformed_or_encrypted_pdf' | 'page_count_mismatch' | 'resource_limit'
    | 'timeout' | 'worker_unavailable';

export interface AnyDocPdfPageMaterializationReceipt {
    readonly sourceSha256: string;
    readonly sourceByteLength: number;
    readonly page: number;
    readonly pageSha256: string;
    readonly pageByteLength: number;
    readonly materializerSha256: typeof ANYDOC_PDF_PAGE_MATERIALIZER_SHA256;
}

export interface AnyDocMaterializedPdfPage {
    readonly page: number;
    readonly pdfBytes: Buffer;
    readonly receipt: AnyDocPdfPageMaterializationReceipt;
}

export type AnyDocPdfPageMaterializationResult = Readonly<{
    schemaVersion: typeof ANYDOC_PDF_PAGE_MATERIALIZER_SCHEMA_VERSION;
    status: 'materialized';
    sourceSha256: string;
    sourceByteLength: number;
    pageCount: number;
    pages: readonly AnyDocMaterializedPdfPage[];
    review: 'required'; writes: 0; apply: 'none';
}> | Readonly<{
    schemaVersion: typeof ANYDOC_PDF_PAGE_MATERIALIZER_SCHEMA_VERSION;
    status: 'review_required';
    reason: AnyDocPdfPageMaterializationFailureReason;
    review: 'required'; writes: 0; apply: 'none';
}>;

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function denied(reason: AnyDocPdfPageMaterializationFailureReason): AnyDocPdfPageMaterializationResult {
    return Object.freeze({
        schemaVersion: ANYDOC_PDF_PAGE_MATERIALIZER_SCHEMA_VERSION,
        status: 'review_required', reason, review: 'required', writes: 0, apply: 'none',
    });
}

function validatedRouting(input: unknown): AnyDocPageRoutingEvidence | null {
    if (typeof input !== 'object' || input === null || types.isProxy(input)
        || Object.getPrototypeOf(input) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== 3 || !['schemaVersion', 'pages', 'pageCount'].every((key) => keys.includes(key))) return null;
    const values = ['schemaVersion', 'pages', 'pageCount'].map((key) => descriptors[key]);
    if (values.some((descriptor) => !descriptor || !('value' in descriptor))) return null;
    const schemaVersion = descriptors.schemaVersion!.value;
    const pagesInput = descriptors.pages!.value;
    const pageCount = descriptors.pageCount!.value;
    if (schemaVersion !== ANYDOC_PAGE_ROUTING_SCHEMA_VERSION || types.isProxy(pagesInput)
        || !Array.isArray(pagesInput) || Object.getPrototypeOf(pagesInput) !== Array.prototype
        || !Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > ANYDOC_PAGE_ROUTING_MAX_PAGE_COUNT) return null;
    const pageDescriptors = Object.getOwnPropertyDescriptors(pagesInput) as unknown as Record<string, PropertyDescriptor>;
    const pageLength = pageDescriptors.length?.value;
    if (!Number.isSafeInteger(pageLength) || pageLength < 1 || pageLength > pageCount
        || Reflect.ownKeys(pageDescriptors).length !== pageLength + 1) return null;
    const pages: unknown[] = [];
    for (let index = 0; index < pageLength; index += 1) {
        const descriptor = pageDescriptors[index]; if (!descriptor || !('value' in descriptor)) return null;
        pages.push(descriptor.value);
    }
    if (pages.some((page, index) => !Number.isSafeInteger(page) || (page as number) < 1
        || (page as number) > pageCount || (index > 0 && (page as number) <= (pages[index - 1] as number)))) return null;
    return Object.freeze({ schemaVersion: ANYDOC_PAGE_ROUTING_SCHEMA_VERSION,
        pages: Object.freeze(pages as number[]), pageCount });
}

function childFailure(reason: AnyDocPdfChildFailureReason): AnyDocPdfPageMaterializationResult {
    if (reason === 'malformed_or_encrypted_pdf' || reason === 'page_count_mismatch'
        || reason === 'resource_limit' || reason === 'timeout') return denied(reason);
    return denied('worker_unavailable');
}

async function materialize(bytes: Buffer, sourceSha256: string, routing: AnyDocPageRoutingEvidence) {
    const isolated = await runAnyDocPdfMaterializationChild(bytes, routing.pageCount);
    if (isolated.status !== 'materialized') return childFailure(isolated.reason);
    if (isolated.pages.length !== routing.pageCount) return denied('worker_unavailable');
    const pages: AnyDocMaterializedPdfPage[] = [];
    let totalBytes = 0;
    for (let index = 0; index < isolated.pages.length; index += 1) {
        const page = isolated.pages[index];
        if (!page || page.page !== index + 1 || !(page.pdfBytes instanceof Uint8Array))
            return denied('worker_unavailable');
        const pdfBytes = Buffer.from(page.pdfBytes);
        totalBytes += pdfBytes.byteLength;
        if (pdfBytes.byteLength < 1 || pdfBytes.byteLength > ANYDOC_PDF_PAGE_MATERIALIZER_MAX_OUTPUT_BYTES
            || totalBytes > ANYDOC_PDF_PAGE_MATERIALIZER_MAX_OUTPUT_BYTES) return denied('resource_limit');
        const receipt = Object.freeze({
            sourceSha256, sourceByteLength: bytes.byteLength, page: index + 1,
            pageSha256: sha256(pdfBytes), pageByteLength: pdfBytes.byteLength,
            materializerSha256: ANYDOC_PDF_PAGE_MATERIALIZER_SHA256,
        });
        pages.push(Object.freeze({ page: index + 1, pdfBytes, receipt }));
    }
    return Object.freeze({
        schemaVersion: ANYDOC_PDF_PAGE_MATERIALIZER_SCHEMA_VERSION, status: 'materialized' as const,
        sourceSha256, sourceByteLength: bytes.byteLength, pageCount: routing.pageCount,
        pages: Object.freeze(pages), review: 'required' as const, writes: 0 as const, apply: 'none' as const,
    });
}

/** Copies one bounded source snapshot before async work; accepts no path, locator, parser option, or fallback. */
export function materializeAnyDocPdfPages(
    input: unknown, expectedSourceSha256: unknown, routingInput: unknown,
): Promise<AnyDocPdfPageMaterializationResult> {
    if (types.isProxy(input) || !(input instanceof Uint8Array)) return Promise.resolve(denied('invalid_input'));
    let bytes: Buffer;
    try { bytes = Buffer.from(input); } catch { return Promise.resolve(denied('invalid_input')); }
    if (bytes.byteLength < 1) return Promise.resolve(denied('invalid_input'));
    if (bytes.byteLength > ANYDOC_LOCAL_EXTRACTION_MAX_SOURCE_BYTES) return Promise.resolve(denied('resource_limit'));
    if (typeof expectedSourceSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(expectedSourceSha256))
        return Promise.resolve(denied('invalid_input'));
    if (sha256(bytes) !== expectedSourceSha256) return Promise.resolve(denied('source_digest_mismatch'));
    const routing = validatedRouting(routingInput);
    if (!routing) return Promise.resolve(denied('invalid_routing'));
    return materialize(bytes, expectedSourceSha256, routing);
}
