/* @Codex */
import 'server-only';

import { createHash } from 'node:crypto';
import { types } from 'node:util';

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
type AuthorityState = 'unissued' | 'issuing' | 'issued' | 'consuming' | 'consumed' | 'expired' | 'poisoned';

const OPAQUE_PATIENT_REF = /^[A-Za-z][A-Za-z0-9._:-]{15,159}$/u;
const OPAQUE_HANDLE = /^dsh_[a-f0-9]{32}$/u;
const OPAQUE_REFERENCE = /^(?:provenance|receipt)_[A-Za-z0-9._:-]{16,128}$/u;
const COMMON = freezeRecord({ writesPerformed: 0 as const, applyPolicy: 'none' as const });
const productionSources: HostSources = Object.freeze({ clock: () => Date.now(), entropy: () => crypto.getRandomValues(new Uint8Array(16)) });
const OBJECT_PROTOTYPE = Object.prototype;
const UINT8_ARRAY_PROTOTYPE = Uint8Array.prototype;
const UINT8_ARRAY_BYTE_LENGTH = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(UINT8_ARRAY_PROTOTYPE), 'byteLength')?.get;
const UINT8_ARRAY_SET = UINT8_ARRAY_PROTOTYPE.set;
const NATIVE_PROMISE_THEN = Promise.prototype.then;
const ASYNC_FUNCTION_PROTOTYPE = Object.getPrototypeOf(async () => undefined);

export class DocumentSynthesisAuthorityHandleConfigurationError extends Error {
    constructor() {
        super('Document synthesis authority handle configuration rejected');
        this.name = 'DocumentSynthesisAuthorityHandleConfigurationError';
    }
}

function freezeRecord<T extends Record<string, unknown>>(value: T): Readonly<T> {
    return Object.freeze(Object.assign(Object.create(null) as T, value));
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (typeof value !== 'object' || value === null || Array.isArray(value) || types.isProxy(value)
            || Object.getPrototypeOf(value) !== OBJECT_PROTOTYPE) return null;
        const ownKeys = Reflect.ownKeys(value);
        if (ownKeys.length !== keys.length || !keys.every((key) => ownKeys.includes(key))) return null;
        const snapshot: Record<string, unknown> = {};
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
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
    return freezeRecord({
        patientRef: record.patientRef,
        document: freezeRecord({ revision, freshness: document.freshness }),
        disposition: record.disposition,
        provenanceRef: record.provenanceRef,
        receiptRef: record.receiptRef,
    });
}

function parseSources(value: unknown): HostSources | null {
    const record = exactRecord(value, ['clock', 'entropy']);
    if (!record || typeof record.clock !== 'function' || typeof record.entropy !== 'function') return null;
    if (types.isProxy(record.clock) || types.isProxy(record.entropy)
        || Object.getPrototypeOf(record.clock) === ASYNC_FUNCTION_PROTOTYPE
        || Object.getPrototypeOf(record.entropy) === ASYNC_FUNCTION_PROTOTYPE) return null;
    return Object.freeze({
        clock: record.clock as () => unknown,
        entropy: record.entropy as () => unknown,
    });
}

function discardPromise(value: unknown): boolean {
    if (!types.isPromise(value)) return false;
    try { void NATIVE_PROMISE_THEN.call(value, undefined, () => undefined); } catch { /* fail closed */ }
    return true;
}

function readEntropy(entropy: () => unknown, authority: HostAuthority): string | null {
    try {
        const value = entropy();
        if (discardPromise(value) || typeof value !== 'object' || value === null || types.isProxy(value)
            || Object.getPrototypeOf(value) !== UINT8_ARRAY_PROTOTYPE
            || Object.getOwnPropertyDescriptor(value, 'byteLength')
            || Object.getOwnPropertyDescriptor(value, 'constructor')
            || !UINT8_ARRAY_BYTE_LENGTH || UINT8_ARRAY_BYTE_LENGTH.call(value) !== 16) return null;
        const copy = new Uint8Array(16);
        UINT8_ARRAY_SET.call(copy, value as Uint8Array);
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
    return freezeRecord(handle
        ? { status: 'issued' as const, code: null, documentHandle: handle }
        : { status: 'denied' as const, code: 'entropy_unavailable' as const, documentHandle: null });
}

function denied(code: DocumentSynthesisAuthorityHandleDenialCode): DocumentSynthesisAuthorityHandleResult {
    return freezeRecord({ status: 'denied' as const, code, metadata: null, ...COMMON });
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
    let state: AuthorityState = 'unissued';

    return Object.freeze({
        issue(): DocumentSynthesisAuthorityHandleIssueResult {
            if (state === 'issuing' || state === 'consuming') {
                state = 'poisoned';
                return issue(null);
            }
            if (state === 'poisoned') return issue(null);
            if (handle) return issue(handle);
            state = 'issuing';
            const issuedHandle = readEntropy(sources.entropy, authority);
            if (state !== 'issuing') return issue(null);
            if (!issuedHandle) {
                state = 'unissued';
                return issue(null);
            }
            handle = issuedHandle;
            state = 'issued';
            return issue(handle);
        },
        consume(value: unknown): DocumentSynthesisAuthorityHandleResult {
            if (state === 'issuing' || state === 'consuming') {
                state = 'poisoned';
                return denied('handle_consumed');
            }
            const presentedHandle = parseConsumeInput(value);
            if (!presentedHandle) return denied('input_invalid');
            if (!handle || presentedHandle !== handle) return denied('handle_invalid');
            if (state === 'poisoned' || state === 'consumed') return denied('handle_consumed');
            if (state === 'expired') return denied('handle_expired');
            state = 'consuming';

            let result: DocumentSynthesisHostBoundaryResult;
            try {
                const boundary = createDocumentSynthesisHostBoundary({
                    document: { handle, revision: authority.document.revision, freshness: authority.document.freshness },
                    disposition: authority.disposition, provenanceRef: authority.provenanceRef, receiptRef: authority.receiptRef, now: sources.clock,
                });
                result = boundary.present({ documentHandle: handle, revision: authority.document.revision, freshness: authority.document.freshness });
            } catch {
                state = 'poisoned';
                return denied('handle_expired');
            }
            if (state !== 'consuming') return denied('handle_consumed');
            state = result.status === 'available' ? 'consumed' : result.code === 'handle_expired' ? 'expired' : 'issued';
            return result;
        },
    });
}
