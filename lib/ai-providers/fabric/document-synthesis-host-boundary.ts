/* @Codex */

export const DOCUMENT_SYNTHESIS_HOST_BOUNDARY_SCHEMA_VERSION = 'mediflow.document-synthesis.host-boundary.v1' as const;

export type DocumentSynthesisDisposition = 'deterministic' | 'generative';
export type DocumentSynthesisHostBoundaryDenialCode =
    | 'input_invalid'
    | 'document_mismatch'
    | 'revision_mismatch'
    | 'freshness_mismatch'
    | 'handle_expired';

export type DocumentSynthesisDocumentPresentation = Readonly<{
    documentHandle: string;
    revision: number;
    freshness: string;
}>;

export type DocumentSynthesisProposalMetadata = Readonly<{
    schemaVersion: typeof DOCUMENT_SYNTHESIS_HOST_BOUNDARY_SCHEMA_VERSION;
    disposition: DocumentSynthesisDisposition;
    document: DocumentSynthesisDocumentPresentation;
    review: 'review_only';
    provenanceRef: string;
    receiptRef: string;
}>;

export type DocumentSynthesisHostBoundaryResult =
    | Readonly<{
        status: 'available';
        code: null;
        metadata: DocumentSynthesisProposalMetadata;
        writesPerformed: 0;
        applyPolicy: 'none';
    }>
    | Readonly<{
        status: 'denied';
        code: DocumentSynthesisHostBoundaryDenialCode;
        metadata: null;
        writesPerformed: 0;
        applyPolicy: 'none';
    }>;

type HostAuthority = Readonly<{
    document: DocumentSynthesisDocumentPresentation;
    disposition: DocumentSynthesisDisposition;
    provenanceRef: string;
    receiptRef: string;
    now: () => number;
}>;

const OPAQUE_DOCUMENT_HANDLE = /^dsh_[a-f0-9]{32}$/u;
const OPAQUE_REFERENCE = /^(?:provenance|receipt)_[A-Za-z0-9._:-]{16,128}$/u;
const COMMON = Object.freeze({ writesPerformed: 0 as const, applyPolicy: 'none' as const });

export class DocumentSynthesisHostBoundaryConfigurationError extends Error {
    constructor() {
        super('Document synthesis host boundary configuration rejected');
        this.name = 'DocumentSynthesisHostBoundaryConfigurationError';
    }
}

function isPlainRecord(value: unknown): value is Record<PropertyKey, unknown> {
    try {
        return typeof value === 'object' && value !== null && !Array.isArray(value)
            && Object.getPrototypeOf(value) === Object.prototype;
    } catch {
        return false;
    }
}

function hasOnlyDataKeys(value: Record<PropertyKey, unknown>, keys: readonly string[]): boolean {
    try {
        const ownKeys = Reflect.ownKeys(value);
        if (ownKeys.length !== keys.length || !keys.every((key) => ownKeys.includes(key))) return false;
        return keys.every((key) => {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            return descriptor !== undefined && 'value' in descriptor;
        });
    } catch {
        return false;
    }
}

function isCanonicalTimestamp(value: unknown): value is string {
    return typeof value === 'string' && Number.isFinite(Date.parse(value))
        && new Date(value).toISOString() === value;
}

function parsePresentation(value: unknown): DocumentSynthesisDocumentPresentation | null {
    try {
        if (!isPlainRecord(value) || !hasOnlyDataKeys(value, ['documentHandle', 'revision', 'freshness'])) return null;
        const { documentHandle, revision, freshness } = value;
        if (typeof documentHandle !== 'string' || !OPAQUE_DOCUMENT_HANDLE.test(documentHandle)
            || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0
            || !isCanonicalTimestamp(freshness)) return null;
        return Object.freeze({ documentHandle, revision, freshness });
    } catch {
        return null;
    }
}

function parseAuthority(value: unknown): HostAuthority | null {
    try {
        if (!isPlainRecord(value) || !hasOnlyDataKeys(value, ['document', 'disposition', 'provenanceRef', 'receiptRef', 'now'])) return null;
        if (!isPlainRecord(value.document) || !hasOnlyDataKeys(value.document, ['handle', 'revision', 'freshness'])) return null;
        const document = parsePresentation(
            { documentHandle: value.document.handle, revision: value.document.revision, freshness: value.document.freshness },
        );
        if (!document || (value.disposition !== 'deterministic' && value.disposition !== 'generative')
            || typeof value.provenanceRef !== 'string' || !OPAQUE_REFERENCE.test(value.provenanceRef)
            || typeof value.receiptRef !== 'string' || !OPAQUE_REFERENCE.test(value.receiptRef)
            || typeof value.now !== 'function') return null;
        return Object.freeze({
            document: Object.freeze({ documentHandle: document.documentHandle, revision: document.revision, freshness: document.freshness }),
            disposition: value.disposition,
            provenanceRef: value.provenanceRef,
            receiptRef: value.receiptRef,
            now: value.now as () => number,
        });
    } catch {
        return null;
    }
}

function denied(code: DocumentSynthesisHostBoundaryDenialCode): DocumentSynthesisHostBoundaryResult {
    return Object.freeze({ status: 'denied', code, metadata: null, ...COMMON });
}

function available(authority: HostAuthority): DocumentSynthesisHostBoundaryResult {
    const document = Object.freeze({ ...authority.document });
    const metadata = Object.freeze({
        schemaVersion: DOCUMENT_SYNTHESIS_HOST_BOUNDARY_SCHEMA_VERSION,
        disposition: authority.disposition,
        document,
        review: 'review_only' as const,
        provenanceRef: authority.provenanceRef,
        receiptRef: authority.receiptRef,
    });
    return Object.freeze({ status: 'available', code: null, metadata, ...COMMON });
}

/**
 * The only caller-facing entry point for document synthesis. The host fixes
 * the disposition and validates the patient-bound opaque document handle.
 * This boundary intentionally performs no document lookup, provider call,
 * persistence, or apply operation.
 */
export function createDocumentSynthesisHostBoundary(configuration: unknown): Readonly<{
    present(value: unknown): DocumentSynthesisHostBoundaryResult;
}> {
    const authority = parseAuthority(configuration);
    if (!authority) throw new DocumentSynthesisHostBoundaryConfigurationError();

    return Object.freeze({
        present(value: unknown): DocumentSynthesisHostBoundaryResult {
            const presentation = parsePresentation(value);
            if (!presentation) return denied('input_invalid');
            if (presentation.documentHandle !== authority.document.documentHandle) return denied('document_mismatch');
            if (presentation.revision !== authority.document.revision) return denied('revision_mismatch');
            if (presentation.freshness !== authority.document.freshness) return denied('freshness_mismatch');
            let now: number;
            try { now = authority.now(); } catch { return denied('handle_expired'); }
            if (!Number.isFinite(now) || now >= Date.parse(authority.document.freshness)) return denied('handle_expired');
            return available(authority);
        },
    });
}
