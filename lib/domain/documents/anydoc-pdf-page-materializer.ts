/* @Codex */
import { createHash } from 'node:crypto';
import { types } from 'node:util';

import { PDFDocument } from 'pdf-lib';
import { ANYDOC_LOCAL_EXTRACTION_MAX_SOURCE_BYTES } from './anydoc-local-extraction-contract';
import {
    ANYDOC_PAGE_ROUTING_MAX_PAGE_COUNT,
    ANYDOC_PAGE_ROUTING_SCHEMA_VERSION,
    type AnyDocPageRoutingEvidence,
} from './anydoc-local-extraction-runner';

export const ANYDOC_PDF_PAGE_MATERIALIZER_SCHEMA_VERSION = 'mediflow.anydoc_pdf_page_materializer.v1' as const;
export const ANYDOC_PDF_PAGE_MATERIALIZER_MAX_OUTPUT_BYTES = 25 * 1024 * 1024;
export const ANYDOC_PDF_PAGE_MATERIALIZER_SHA256 = 'a7cc1eaf12e41e612a7be581162a63b18118aefc01e90f6a1f35347b1f324a1c' as const;

export type AnyDocPdfPageMaterializationFailureReason =
    | 'invalid_input' | 'source_digest_mismatch' | 'invalid_routing'
    | 'malformed_or_encrypted_pdf' | 'page_count_mismatch' | 'resource_limit';

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

async function materialize(bytes: Buffer, sourceSha256: string, routing: AnyDocPageRoutingEvidence) {
    let source: PDFDocument; let pageCount: number;
    try {
        source = await PDFDocument.load(bytes, {
            ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false, capNumbers: true,
        });
        pageCount = source.getPageCount();
    } catch { return denied('malformed_or_encrypted_pdf'); }
    if (pageCount !== routing.pageCount) return denied('page_count_mismatch');

    const pages: AnyDocMaterializedPdfPage[] = []; let totalBytes = 0;
    for (let index = 0; index < routing.pageCount; index += 1) {
        try {
            const target = await PDFDocument.create({ updateMetadata: false });
            const [page] = await target.copyPages(source, [index]);
            if (!page) return denied('page_count_mismatch');
            target.addPage(page);
            const pdfBytes = Buffer.from(await target.save({
                useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false,
            }));
            totalBytes += pdfBytes.byteLength;
            if (pdfBytes.byteLength > ANYDOC_PDF_PAGE_MATERIALIZER_MAX_OUTPUT_BYTES
                || totalBytes > ANYDOC_PDF_PAGE_MATERIALIZER_MAX_OUTPUT_BYTES) return denied('resource_limit');
            const receipt = Object.freeze({
                sourceSha256, sourceByteLength: bytes.byteLength, page: index + 1,
                pageSha256: sha256(pdfBytes), pageByteLength: pdfBytes.byteLength,
                materializerSha256: ANYDOC_PDF_PAGE_MATERIALIZER_SHA256,
            });
            pages.push(Object.freeze({ page: index + 1, pdfBytes, receipt }));
        } catch { return denied('malformed_or_encrypted_pdf'); }
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
