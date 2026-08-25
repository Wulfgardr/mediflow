/* @Codex */
import { types } from 'node:util';

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
    now: () => unknown;
}>;

const OPAQUE_DOCUMENT_HANDLE = /^dsh_[a-f0-9]{32}$/u;
const OPAQUE_REFERENCE = /^(?:provenance|receipt)_[A-Za-z0-9._:-]{16,128}$/u;
const OBJECT_PROTOTYPE = Object.prototype;
const NATIVE_PROMISE_THEN = Promise.prototype.then;
const ASYNC_FUNCTION_PROTOTYPE = Object.getPrototypeOf(async () => undefined);

function freezeRecord<T extends Record<string, unknown>>(value: T): Readonly<T> {
    return Object.freeze(Object.assign(Object.create(null) as T, value));
}

const COMMON = freezeRecord({ writesPerformed: 0 as const, applyPolicy: 'none' as const });

export class DocumentSynthesisHostBoundaryConfigurationError extends Error {
    constructor() {
        super('Document synthesis host boundary configuration rejected');
        this.name = 'DocumentSynthesisHostBoundaryConfigurationError';
    }
}

function isPlainRecord(value: unknown): value is Record<PropertyKey, unknown> {
    try {
        return typeof value === 'object' && value !== null && !Array.isArray(value) && !types.isProxy(value)
            && Object.getPrototypeOf(value) === OBJECT_PROTOTYPE;
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
            return descriptor !== undefined && descriptor.enumerable && 'value' in descriptor;
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
        return freezeRecord({ documentHandle, revision, freshness });
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
            || typeof value.now !== 'function' || types.isProxy(value.now)
            || Object.getPrototypeOf(value.now) === ASYNC_FUNCTION_PROTOTYPE) return null;
        return freezeRecord({
            document: freezeRecord({ documentHandle: document.documentHandle, revision: document.revision, freshness: document.freshness }),
            disposition: value.disposition,
            provenanceRef: value.provenanceRef,
            receiptRef: value.receiptRef,
            now: value.now as () => unknown,
        });
    } catch {
        return null;
    }
}

function denied(code: DocumentSynthesisHostBoundaryDenialCode): DocumentSynthesisHostBoundaryResult {
    return freezeRecord({ status: 'denied' as const, code, metadata: null, ...COMMON });
}

function available(authority: HostAuthority): DocumentSynthesisHostBoundaryResult {
    const document = freezeRecord({ ...authority.document });
    const metadata = freezeRecord({
        schemaVersion: DOCUMENT_SYNTHESIS_HOST_BOUNDARY_SCHEMA_VERSION,
        disposition: authority.disposition,
        document,
        review: 'review_only' as const,
        provenanceRef: authority.provenanceRef,
        receiptRef: authority.receiptRef,
    });
    return freezeRecord({ status: 'available' as const, code: null, metadata, ...COMMON });
}

function readClock(now: () => unknown): number | null {
    try {
        const value = now();
        if (types.isPromise(value)) {
            try { void NATIVE_PROMISE_THEN.call(value, undefined, () => undefined); } catch { /* fail closed */ }
            return null;
        }
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
    } catch {
        return null;
    }
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
            const now = readClock(authority.now);
            if (now === null || now >= Date.parse(authority.document.freshness)) return denied('handle_expired');
            return available(authority);
        },
    });
}
