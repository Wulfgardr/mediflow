/* @Codex */
import { createHash } from 'node:crypto';
import { types } from 'node:util';

export const ANYDOC_LOCAL_EXTRACTION_SCHEMA_VERSION = 'mediflow.anydoc_local_extraction.v1';
export const ANYDOC_LOCAL_OCR_PROVENANCE_SCHEMA_VERSION = 'mediflow.anydoc_local_ocr_provenance.v1';
export const ANYDOC_LOCAL_EXTRACTION_MAX_SOURCE_BYTES = 25 * 1024 * 1024;
export const ANYDOC_LOCAL_EXTRACTION_MAX_MARKDOWN_BYTES = 8 * 1024 * 1024;

export type AnyDocLocalFailureSignal =
    | 'unsupported' | 'needsOcr' | 'malformed' | 'encrypted'
    | 'resourceLimit' | 'missingPart' | 'io';
export type LocalExtractionFailureDetail =
    | 'unsupported_format' | 'image_or_scan' | 'malformed_document'
    | 'encrypted_document' | 'resource_limit' | 'incomplete_document'
    | 'io_failure' | 'empty_extraction';

export interface LocalAttachmentByteSource {
    readonly attachmentId: string;
    readonly sourceSha256: string;
    readonly byteLength: number;
}
export interface LocalExtractionOcrProvenance {
    readonly schemaVersion: typeof ANYDOC_LOCAL_OCR_PROVENANCE_SCHEMA_VERSION;
    readonly engine: 'apple_vision';
    readonly scriptSha256: string;
    readonly pageCount: number;
    readonly ocrPageCount: number;
    readonly receiptSetSha256: string;
}
export interface LocalExtractionReceipt {
    readonly receiptId: string;
    readonly parser: 'anydoc-local';
    readonly outcome: 'extracted' | `review_required:${LocalExtractionFailureDetail}`;
    readonly sourceSha256: string;
    readonly sourceByteLength: number;
    readonly markdownSha256?: string;
    readonly markdownByteLength: number;
    readonly ocrProvenance?: LocalExtractionOcrProvenance;
}
interface LocalExtractionBase {
    readonly schemaVersion: typeof ANYDOC_LOCAL_EXTRACTION_SCHEMA_VERSION;
    readonly provenance: LocalAttachmentByteSource;
    readonly receipt: LocalExtractionReceipt;
    readonly review: 'required';
    readonly writes: 0;
    readonly apply: 'none';
}
export interface LocalExtractionSuccess extends LocalExtractionBase {
    readonly status: 'extracted';
    readonly markdown: string;
    readonly candidateUse: 'review_only';
}
export interface LocalExtractionFailure extends LocalExtractionBase {
    readonly status: 'review_required';
    readonly reason: 'unsupported_local_extraction';
    readonly detail: LocalExtractionFailureDetail;
    readonly markdown: '';
    readonly candidateUse: 'blocked';
}
export interface LocalExtractionDenial {
    readonly schemaVersion: typeof ANYDOC_LOCAL_EXTRACTION_SCHEMA_VERSION;
    readonly status: 'denied';
    readonly reason: 'invalid_contract_input';
    readonly field: 'source' | 'signal' | 'markdown' | 'ocrProvenance';
    readonly review: 'required';
    readonly writes: 0;
    readonly apply: 'none';
    readonly candidateUse: 'blocked';
}
export type LocalExtractionResult = LocalExtractionSuccess | LocalExtractionFailure | LocalExtractionDenial;

const DETAILS: Record<AnyDocLocalFailureSignal, LocalExtractionFailureDetail> = {
    unsupported: 'unsupported_format', needsOcr: 'image_or_scan', malformed: 'malformed_document',
    encrypted: 'encrypted_document', resourceLimit: 'resource_limit', missingPart: 'incomplete_document', io: 'io_failure',
};
const SOURCE_KEYS = ['attachmentId', 'sourceSha256', 'byteLength'] as const;
const OCR_PROVENANCE_KEYS = ['schemaVersion', 'engine', 'scriptSha256', 'pageCount', 'ocrPageCount', 'receiptSetSha256'] as const;
const SHA256 = /^[a-f0-9]{64}$/u;

function deny(field: LocalExtractionDenial['field']): LocalExtractionDenial {
    return Object.freeze({ schemaVersion: ANYDOC_LOCAL_EXTRACTION_SCHEMA_VERSION, status: 'denied', reason: 'invalid_contract_input', field, review: 'required', writes: 0, apply: 'none', candidateUse: 'blocked' });
}
function canonicalSource(value: unknown): LocalAttachmentByteSource | undefined {
    if (typeof value !== 'object' || value === null || types.isProxy(value)) return undefined;
    if (Object.getPrototypeOf(value) !== Object.prototype) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== SOURCE_KEYS.length || keys.some((key) => typeof key !== 'string' || !SOURCE_KEYS.includes(key as typeof SOURCE_KEYS[number]))) return undefined;
    for (const key of SOURCE_KEYS) {
        const descriptor = descriptors[key];
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable || !descriptor.configurable || !descriptor.writable) return undefined;
    }
    const attachmentId = descriptors.attachmentId.value;
    const sourceSha256 = descriptors.sourceSha256.value;
    const byteLength = descriptors.byteLength.value;
    if (typeof attachmentId !== 'string' || attachmentId.length < 1 || attachmentId.length > 200) return undefined;
    if (typeof sourceSha256 !== 'string' || !SHA256.test(sourceSha256)) return undefined;
    if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > ANYDOC_LOCAL_EXTRACTION_MAX_SOURCE_BYTES) return undefined;
    return Object.freeze({ attachmentId, sourceSha256, byteLength });
}
function canonicalOcrProvenance(value: unknown): LocalExtractionOcrProvenance | undefined {
    if (typeof value !== 'object' || value === null || types.isProxy(value)
        || Object.getPrototypeOf(value) !== Object.prototype) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== OCR_PROVENANCE_KEYS.length
        || keys.some((key) => typeof key !== 'string' || !OCR_PROVENANCE_KEYS.includes(key as typeof OCR_PROVENANCE_KEYS[number]))) return undefined;
    for (const key of OCR_PROVENANCE_KEYS) {
        const descriptor = descriptors[key];
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return undefined;
    }
    const schemaVersion = descriptors.schemaVersion.value;
    const engine = descriptors.engine.value;
    const scriptSha256 = descriptors.scriptSha256.value;
    const pageCount = descriptors.pageCount.value;
    const ocrPageCount = descriptors.ocrPageCount.value;
    const receiptSetSha256 = descriptors.receiptSetSha256.value;
    if (schemaVersion !== ANYDOC_LOCAL_OCR_PROVENANCE_SCHEMA_VERSION || engine !== 'apple_vision'
        || typeof scriptSha256 !== 'string' || !SHA256.test(scriptSha256)
        || !Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 500
        || !Number.isSafeInteger(ocrPageCount) || ocrPageCount < 1 || ocrPageCount > pageCount
        || typeof receiptSetSha256 !== 'string' || !SHA256.test(receiptSetSha256)) return undefined;
    return Object.freeze({ schemaVersion, engine, scriptSha256, pageCount, ocrPageCount, receiptSetSha256 });
}
function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function minimize(markdown: string): string {
    return markdown.replace(/\0/gu, '').replace(/\r\n?/gu, '\n').split('\n').map((line) => line.trimEnd()).join('\n').replace(/\n{3,}/gu, '\n\n').trim();
}
function receipt(source: LocalAttachmentByteSource, outcome: LocalExtractionReceipt['outcome'], markdown = '',
    ocrProvenance?: LocalExtractionOcrProvenance): LocalExtractionReceipt {
    const markdownSha256 = markdown ? sha256(markdown) : undefined;
    const markdownByteLength = Buffer.byteLength(markdown, 'utf8');
    const identity: Array<string | number> = [ANYDOC_LOCAL_EXTRACTION_SCHEMA_VERSION, outcome, source.attachmentId,
        source.sourceSha256, source.byteLength, markdownSha256 ?? 'no-markdown'];
    if (ocrProvenance) identity.push(ocrProvenance.schemaVersion, ocrProvenance.engine, ocrProvenance.scriptSha256,
        ocrProvenance.pageCount, ocrProvenance.ocrPageCount, ocrProvenance.receiptSetSha256);
    return Object.freeze({
        receiptId: sha256(identity.join('|')),
        parser: 'anydoc-local', outcome, sourceSha256: source.sourceSha256, sourceByteLength: source.byteLength,
        ...(markdownSha256 ? { markdownSha256 } : {}), markdownByteLength,
        ...(ocrProvenance ? { ocrProvenance } : {}),
    });
}
function failure(source: LocalAttachmentByteSource, detail: LocalExtractionFailureDetail): LocalExtractionFailure {
    return Object.freeze({ schemaVersion: ANYDOC_LOCAL_EXTRACTION_SCHEMA_VERSION, provenance: source, receipt: receipt(source, `review_required:${detail}`), review: 'required', writes: 0, apply: 'none', status: 'review_required', reason: 'unsupported_local_extraction', detail, markdown: '', candidateUse: 'blocked' });
}

export function mapAnyDocLocalFailure(sourceInput: unknown, signal: unknown): LocalExtractionFailure | LocalExtractionDenial {
    const source = canonicalSource(sourceInput);
    if (!source) return deny('source');
    if (typeof signal !== 'string' || !Object.hasOwn(DETAILS, signal)) return deny('signal');
    return failure(source, DETAILS[signal as AnyDocLocalFailureSignal]);
}
export function buildAnyDocLocalExtraction(sourceInput: unknown, markdownInput: unknown,
    ocrProvenanceInput?: unknown): LocalExtractionResult {
    const source = canonicalSource(sourceInput);
    if (!source) return deny('source');
    if (typeof markdownInput !== 'string' || Buffer.byteLength(markdownInput, 'utf8') > ANYDOC_LOCAL_EXTRACTION_MAX_MARKDOWN_BYTES) return deny('markdown');
    const ocrProvenance = ocrProvenanceInput === undefined ? undefined : canonicalOcrProvenance(ocrProvenanceInput);
    if (ocrProvenanceInput !== undefined && !ocrProvenance) return deny('ocrProvenance');
    const markdown = minimize(markdownInput);
    if (!markdown) return failure(source, 'empty_extraction');
    return Object.freeze({ schemaVersion: ANYDOC_LOCAL_EXTRACTION_SCHEMA_VERSION, provenance: source,
        receipt: receipt(source, 'extracted', markdown, ocrProvenance), review: 'required', writes: 0, apply: 'none',
        status: 'extracted', markdown, candidateUse: 'review_only' });
}
