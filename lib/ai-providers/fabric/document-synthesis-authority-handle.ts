/* @Codex */
import 'server-only';

import { createHash } from 'node:crypto';

import {
    createDocumentSynthesisHostBoundary,
    type DocumentSynthesisDisposition,
    type DocumentSynthesisHostBoundaryDenialCode,
    type DocumentSynthesisHostBoundaryResult,
} from './document-synthesis-host-boundary';

export type { DocumentSynthesisDisposition } from './document-synthesis-host-boundary';

export type DocumentSynthesisAuthorityHandleDenialCode =
    | DocumentSynthesisHostBoundaryDenialCode
    | 'entropy_unavailable'
    | 'handle_consumed'
    | 'handle_invalid';

export type DocumentSynthesisAuthorityHandleIssueResult = Readonly<{ status: 'issued' | 'denied'; code: 'entropy_unavailable' | null; documentHandle: string | null }>;

export type DocumentSynthesisAuthorityHandleResult =
    | Extract<DocumentSynthesisHostBoundaryResult, Readonly<{ status: 'available' }>>
    | Readonly<{ status: 'denied'; code: DocumentSynthesisAuthorityHandleDenialCode; metadata: null; writesPerformed: 0; applyPolicy: 'none' }>;

type HostAuthority = Readonly<{ patientRef: string; document: Readonly<{ revision: number; freshness: string }>; disposition: DocumentSynthesisDisposition; provenanceRef: string; receiptRef: string }>;
type HostSources = Readonly<{ clock: () => unknown; entropy: () => unknown }>;

const OPAQUE_PATIENT_REF = /^[A-Za-z][A-Za-z0-9._:-]{15,159}$/u;
const OPAQUE_HANDLE = /^dsh_[a-f0-9]{32}$/u;
const OPAQUE_REFERENCE = /^(?:provenance|receipt)_[A-Za-z0-9._:-]{16,128}$/u;
const COMMON = Object.freeze({ writesPerformed: 0 as const, applyPolicy: 'none' as const });
const productionSources: HostSources = Object.freeze({ clock: () => Date.now(), entropy: () => crypto.getRandomValues(new Uint8Array(16)) });

export class DocumentSynthesisAuthorityHandleConfigurationError extends Error {
    constructor() {
        super('Document synthesis authority handle configuration rejected');
        this.name = 'DocumentSynthesisAuthorityHandleConfigurationError';
    }
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const ownKeys = Reflect.ownKeys(value);
        if (ownKeys.length !== keys.length || !keys.every((key) => ownKeys.includes(key))) return null;
        const snapshot: Record<string, unknown> = {};
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !('value' in descriptor)) return null;
            snapshot[key] = descriptor.value;
        }
        return snapshot;
    } catch {
        return null;
    }
}

function isCanonicalTimestamp(value: unknown): value is string {
    return typeof value === 'string' && Number.isFinite(Date.parse(value))
        && new Date(value).toISOString() === value;
}

function parseAuthority(value: unknown): HostAuthority | null {
    const record = exactRecord(value, ['patientRef', 'document', 'disposition', 'provenanceRef', 'receiptRef']);
    if (!record) return null;
    const document = exactRecord(record.document, ['revision', 'freshness']);
    const revision = document?.revision;
    if (!document || typeof record.patientRef !== 'string' || !OPAQUE_PATIENT_REF.test(record.patientRef)
        || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0
        || !isCanonicalTimestamp(document.freshness)
        || (record.disposition !== 'deterministic' && record.disposition !== 'generative')
        || typeof record.provenanceRef !== 'string' || !OPAQUE_REFERENCE.test(record.provenanceRef)
        || typeof record.receiptRef !== 'string' || !OPAQUE_REFERENCE.test(record.receiptRef)) return null;
    return Object.freeze({
        patientRef: record.patientRef,
        document: Object.freeze({ revision, freshness: document.freshness }),
        disposition: record.disposition,
        provenanceRef: record.provenanceRef,
        receiptRef: record.receiptRef,
    });
}

function parseSources(value: unknown): HostSources | null {
    const record = exactRecord(value, ['clock', 'entropy']);
    if (!record || typeof record.clock !== 'function' || typeof record.entropy !== 'function') return null;
    return Object.freeze({
        clock: record.clock as () => unknown,
        entropy: record.entropy as () => unknown,
    });
}

function readEntropy(entropy: () => unknown, authority: HostAuthority): string | null {
    try {
        const value = entropy();
        if (!(value instanceof Uint8Array) || Object.getPrototypeOf(value) !== Uint8Array.prototype
            || value.byteLength !== 16) return null;
        const copy = Uint8Array.prototype.slice.call(value);
        const binding = [
            authority.patientRef,
            authority.document.revision,
            authority.document.freshness,
            authority.disposition,
            authority.provenanceRef,
            authority.receiptRef,
        ].join('\u0000');
        return `dsh_${createHash('sha256').update(copy).update(binding).digest('hex').slice(0, 32)}`;
    } catch {
        return null;
    }
}

function issue(handle: string | null): DocumentSynthesisAuthorityHandleIssueResult {
    return Object.freeze(handle
        ? { status: 'issued' as const, code: null, documentHandle: handle }
        : { status: 'denied' as const, code: 'entropy_unavailable' as const, documentHandle: null });
}

function denied(code: DocumentSynthesisAuthorityHandleDenialCode): DocumentSynthesisAuthorityHandleResult {
    return Object.freeze({ status: 'denied', code, metadata: null, ...COMMON });
}

function parseConsumeInput(value: unknown): string | null {
    const record = exactRecord(value, ['documentHandle']);
    return record && typeof record.documentHandle === 'string' && OPAQUE_HANDLE.test(record.documentHandle)
        ? record.documentHandle
        : null;
}

/**
 * Server-only, host-owned authority for a selected document. The opaque handle
 * carries no patient identifier or document content; patient, revision,
 * freshness, branch, clock, and entropy stay inside this closure.
 */
export function createDocumentSynthesisAuthorityHandle(
    authorityValue: unknown,
    sourceValue: unknown = productionSources,
): Readonly<{
    issue(): DocumentSynthesisAuthorityHandleIssueResult;
    consume(value: unknown): DocumentSynthesisAuthorityHandleResult;
}> {
    const authority = parseAuthority(authorityValue);
    const sources = parseSources(sourceValue);
    if (!authority || !sources) throw new DocumentSynthesisAuthorityHandleConfigurationError();

    let handle: string | null = null;
    let consumed = false;
    let expired = false;

    return Object.freeze({
        issue(): DocumentSynthesisAuthorityHandleIssueResult {
            if (!handle) handle = readEntropy(sources.entropy, authority);
            return issue(handle);
        },
        consume(value: unknown): DocumentSynthesisAuthorityHandleResult {
            const presentedHandle = parseConsumeInput(value);
            if (!presentedHandle) return denied('input_invalid');
            if (!handle || presentedHandle !== handle) return denied('handle_invalid');
            if (consumed) return denied('handle_consumed');
            if (expired) return denied('handle_expired');

            const boundary = createDocumentSynthesisHostBoundary({
                document: {
                    handle,
                    revision: authority.document.revision,
                    freshness: authority.document.freshness,
                },
                disposition: authority.disposition,
                provenanceRef: authority.provenanceRef,
                receiptRef: authority.receiptRef,
                now: sources.clock,
            });
            const result = boundary.present({
                documentHandle: handle,
                revision: authority.document.revision,
                freshness: authority.document.freshness,
            });
            if (result.status === 'available') consumed = true;
            if (result.status === 'denied' && result.code === 'handle_expired') expired = true;
            return result;
        },
    });
}
