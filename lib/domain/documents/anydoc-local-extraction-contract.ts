/* @Codex */
import { createHash } from 'node:crypto';

export const ANYDOC_LOCAL_EXTRACTION_SCHEMA_VERSION = 'mediflow.anydoc_local_extraction.v1';

export type AnyDocLocalFailureSignal =
    | 'unsupported'
    | 'needsOcr'
    | 'malformed'
    | 'encrypted'
    | 'resourceLimit'
    | 'missingPart'
    | 'io';

export type LocalExtractionFailureDetail =
    | 'unsupported_format'
    | 'image_or_scan'
    | 'malformed_document'
    | 'encrypted_document'
    | 'resource_limit'
    | 'incomplete_document'
    | 'io_failure'
    | 'empty_extraction';

export interface LocalAttachmentByteSource {
    attachmentId: string;
    sourceSha256: string;
    byteLength: number;
}

export interface LocalExtractionReceipt {
    receiptId: string;
    parser: 'anydoc-local';
    sourceSha256: string;
    sourceByteLength: number;
    markdownSha256?: string;
    markdownByteLength: number;
}

interface LocalExtractionBase {
    schemaVersion: typeof ANYDOC_LOCAL_EXTRACTION_SCHEMA_VERSION;
    provenance: LocalAttachmentByteSource;
    receipt: LocalExtractionReceipt;
    review: 'required';
    writes: 0;
    apply: 'none';
}

export interface LocalExtractionSuccess extends LocalExtractionBase {
    status: 'extracted';
    markdown: string;
    candidateUse: 'review_only';
}

export interface LocalExtractionFailure extends LocalExtractionBase {
    status: 'review_required';
    reason: 'unsupported_local_extraction';
    detail: LocalExtractionFailureDetail;
    markdown: '';
    candidateUse: 'blocked';
}

export type LocalExtractionResult = LocalExtractionSuccess | LocalExtractionFailure;

const FAILURE_DETAIL_BY_SIGNAL: Record<AnyDocLocalFailureSignal, LocalExtractionFailureDetail> = {
    unsupported: 'unsupported_format',
    needsOcr: 'image_or_scan',
    malformed: 'malformed_document',
    encrypted: 'encrypted_document',
    resourceLimit: 'resource_limit',
    missingPart: 'incomplete_document',
    io: 'io_failure',
};

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

export function minimizeExtractedMarkdown(markdown: string): string {
    return markdown
        .replace(/\0/gu, '')
        .replace(/\r\n?/gu, '\n')
        .split('\n')
        .map((line) => line.trimEnd())
        .join('\n')
        .replace(/\n{3,}/gu, '\n\n')
        .trim();
}

function receipt(source: LocalAttachmentByteSource, markdown = ''): LocalExtractionReceipt {
    const markdownSha256 = markdown ? sha256(markdown) : undefined;
    const markdownByteLength = Buffer.byteLength(markdown, 'utf8');
    const receiptId = sha256([
        ANYDOC_LOCAL_EXTRACTION_SCHEMA_VERSION,
        source.attachmentId,
        source.sourceSha256,
        source.byteLength,
        markdownSha256 ?? 'no-markdown',
    ].join('|'));
    return {
        receiptId,
        parser: 'anydoc-local',
        sourceSha256: source.sourceSha256,
        sourceByteLength: source.byteLength,
        ...(markdownSha256 ? { markdownSha256 } : {}),
        markdownByteLength,
    };
}

function base(source: LocalAttachmentByteSource, markdown = ''): LocalExtractionBase {
    return {
        schemaVersion: ANYDOC_LOCAL_EXTRACTION_SCHEMA_VERSION,
        provenance: { ...source },
        receipt: receipt(source, markdown),
        review: 'required',
        writes: 0,
        apply: 'none',
    };
}

function failure(
    source: LocalAttachmentByteSource,
    detail: LocalExtractionFailureDetail,
): LocalExtractionFailure {
    return {
        ...base(source),
        status: 'review_required',
        reason: 'unsupported_local_extraction',
        detail,
        markdown: '',
        candidateUse: 'blocked',
    };
}

export function mapAnyDocLocalFailure(
    source: LocalAttachmentByteSource,
    signal: AnyDocLocalFailureSignal,
): LocalExtractionFailure {
    return failure(source, FAILURE_DETAIL_BY_SIGNAL[signal]);
}

export function buildAnyDocLocalExtraction(
    source: LocalAttachmentByteSource,
    markdown: string,
): LocalExtractionResult {
    const minimized = minimizeExtractedMarkdown(markdown);
    if (!minimized) return failure(source, 'empty_extraction');
    return {
        ...base(source, minimized),
        status: 'extracted',
        markdown: minimized,
        candidateUse: 'review_only',
    };
}
