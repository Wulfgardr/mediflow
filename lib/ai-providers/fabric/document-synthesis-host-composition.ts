/* @Codex */
import 'server-only';

import { types } from 'node:util';

import { createDocumentSynthesisAuthenticatedSourceMap, type DocumentSynthesisAuthenticatedSourceMapResult } from './document-synthesis-authenticated-source-map';
import { createDocumentSynthesisAuthorityHandle, type DocumentSynthesisAuthorityHandleResult, type DocumentSynthesisDisposition } from './document-synthesis-authority-handle';

type Authority = Readonly<{ patientRef: string; document: Readonly<{ revision: number; freshness: string }>; disposition: DocumentSynthesisDisposition; provenanceRef: string; receiptRef: string }>;
type Source = Readonly<{ sourceId: string; sourceRef: string; digestSha256: string }>;
type SourceMap = Extract<DocumentSynthesisAuthenticatedSourceMapResult, { status: 'available' }>['sourceMap'];
type Binding = Extract<DocumentSynthesisAuthenticatedSourceMapResult, { status: 'available' }>['binding'];
type Metadata = Extract<DocumentSynthesisAuthorityHandleResult, { status: 'available' }>['metadata'];
type DenialCode = 'input_invalid' | 'operation_unavailable' | 'handle_consumed' | 'currentness_unavailable' | 'currentness_mismatch' | Extract<DocumentSynthesisAuthenticatedSourceMapResult, { status: 'denied' }>['code'] | Extract<DocumentSynthesisAuthorityHandleResult, { status: 'denied' }>['code'];
type Available = Readonly<{ status: 'available'; code: null; metadata: Metadata; sourceMap: SourceMap; binding: Binding; reviewOnly: true; writesPerformed: 0; applyPolicy: 'none' }>;
type Denied = Readonly<{ status: 'denied'; code: DenialCode; metadata: null; sourceMap: null; binding: null; reviewOnly: true; writesPerformed: 0; applyPolicy: 'none' }>;
export type DocumentSynthesisHostCompositionResult = Available | Denied;

const OBJECT = Object.prototype; const ARRAY = Array.prototype; const ASYNC = Object.getPrototypeOf(async () => undefined);
const PATIENT = /^[A-Za-z][A-Za-z0-9._:-]{15,159}$/u; const REFERENCE = /^(?:provenance|receipt)_[A-Za-z0-9._:-]{16,128}$/u;
const SOURCE_ID = /^source\.[a-z0-9][a-z0-9._:-]{2,127}$/u; const SOURCE_REF = /^document_source_[A-Za-z0-9._:-]{16,128}$/u; const DIGEST = /^[a-f0-9]{64}$/u;
const CANDIDATE_KEYS = ['output', 'outputSha256', 'citations'] as const;
const NATIVE_PROMISE_THEN = Promise.prototype.then;

export class DocumentSynthesisHostCompositionConfigurationError extends Error {
    constructor() { super('Document synthesis host composition configuration rejected'); this.name = 'DocumentSynthesisHostCompositionConfigurationError'; }
}

function frozen<T extends object>(value: T): Readonly<T> { return Object.freeze(Object.assign(Object.create(null), value)); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (types.isProxy(value) || typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== OBJECT) return null;
        const found = Reflect.ownKeys(value); if (found.length !== keys.length || !keys.every((key) => found.includes(key))) return null;
        const copy: Record<string, unknown> = Object.create(null);
        for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null; copy[key] = descriptor.value; }
        return copy;
    } catch { return null; }
}
function list(value: unknown): readonly unknown[] | null {
    try {
        if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== ARRAY || value.length < 1 || value.length > 32 || Reflect.ownKeys(value).length !== value.length + 1) return null;
        const copy: unknown[] = []; for (let index = 0; index < value.length; index += 1) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null; copy.push(descriptor.value); } return copy;
    } catch { return null; }
}
function timestamp(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function authority(value: unknown): Authority | null {
    const input = record(value, ['patientRef', 'document', 'disposition', 'provenanceRef', 'receiptRef']); const document = input && record(input.document, ['revision', 'freshness']);
    if (!input || !document || typeof input.patientRef !== 'string' || !PATIENT.test(input.patientRef) || typeof document.revision !== 'number' || !Number.isSafeInteger(document.revision) || document.revision < 0 || !timestamp(document.freshness) || (input.disposition !== 'deterministic' && input.disposition !== 'generative') || typeof input.provenanceRef !== 'string' || !REFERENCE.test(input.provenanceRef) || typeof input.receiptRef !== 'string' || !REFERENCE.test(input.receiptRef)) return null;
    return frozen({ patientRef: input.patientRef, document: frozen({ revision: document.revision, freshness: document.freshness }), disposition: input.disposition, provenanceRef: input.provenanceRef, receiptRef: input.receiptRef });
}
function sources(value: unknown): readonly Source[] | null {
    const items = list(value)?.map((item) => record(item, ['sourceId', 'sourceRef', 'digestSha256']));
    if (!items || items.some((item) => !item) || items.some((item) => typeof item?.sourceId !== 'string' || !SOURCE_ID.test(item.sourceId) || typeof item.sourceRef !== 'string' || !SOURCE_REF.test(item.sourceRef) || typeof item.digestSha256 !== 'string' || !DIGEST.test(item.digestSha256))) return null;
    const copied = items as Record<string, unknown>[]; if (new Set(copied.map((item) => item.sourceId)).size !== copied.length || new Set(copied.map((item) => item.sourceRef)).size !== copied.length) return null;
    return Object.freeze(copied.map((item) => frozen({ sourceId: item.sourceId as string, sourceRef: item.sourceRef as string, digestSha256: item.digestSha256 as string })));
}
function callback(value: unknown): (() => unknown) | null { return typeof value === 'function' && !types.isProxy(value) && Object.getPrototypeOf(value) !== ASYNC ? value as () => unknown : null; }
function denied(code: DenialCode): Denied { return frozen({ status: 'denied' as const, code, metadata: null, sourceMap: null, binding: null, reviewOnly: true as const, writesPerformed: 0 as const, applyPolicy: 'none' as const }); }
function candidate(value: unknown): Record<string, unknown> | null { return record(value, CANDIDATE_KEYS); }
function current(value: unknown, expected: Authority): 'match' | 'mismatch' | 'unavailable' {
    if (types.isPromise(value)) { try { void NATIVE_PROMISE_THEN.call(value, undefined, () => undefined); } catch { /* fail closed */ } return 'unavailable'; }
    const input = record(value, ['revision', 'freshness', 'disposition']);
    if (!input || typeof input.revision !== 'number' || !Number.isSafeInteger(input.revision) || !timestamp(input.freshness) || (input.disposition !== 'deterministic' && input.disposition !== 'generative')) return 'unavailable';
    return input.revision === expected.document.revision && input.freshness === expected.document.freshness && input.disposition === expected.disposition ? 'match' : 'mismatch';
}

/** Server-only composition: C1 maps host-injected document identity, then the accepted authority primitive consumes the same opaque handle. */
export function createDocumentSynthesisHostComposition(configuration: unknown): Readonly<{
    issue(): Readonly<{ status: 'issued' | 'denied'; code: 'entropy_unavailable' | null }>;
    consumeAndMap(value: unknown): DocumentSynthesisHostCompositionResult;
    dispose(): void;
}> {
    const input = record(configuration, ['authority', 'currentness', 'sources', 'clock', 'entropy']); const captured = input && authority(input.authority); const capturedSources = input && sources(input.sources); const currentness = input && callback(input.currentness); const clock = input && callback(input.clock); const entropy = input && callback(input.entropy);
    if (!input || !captured || !capturedSources || !currentness || !clock || !entropy) throw new DocumentSynthesisHostCompositionConfigurationError();
    const handleOwner = createDocumentSynthesisAuthorityHandle({ patientRef: captured.patientRef, document: { revision: captured.document.revision, freshness: captured.document.freshness }, disposition: captured.disposition, provenanceRef: captured.provenanceRef, receiptRef: captured.receiptRef }, { clock, entropy }); let mapper: ReturnType<typeof createDocumentSynthesisAuthenticatedSourceMap> | null = null; let handle: string | null = null; let state: 'unissued' | 'issuing' | 'issued' | 'consuming' | 'consumed' | 'disposed' | 'poisoned' = 'unissued';
    return frozen({
        issue() {
            if (state === 'issuing' || state === 'consuming') { state = 'poisoned'; return frozen({ status: 'denied' as const, code: 'entropy_unavailable' as const }); }
            if (state === 'issued') return frozen({ status: 'issued' as const, code: null });
            if (state !== 'unissued') return frozen({ status: 'denied' as const, code: 'entropy_unavailable' as const });
            state = 'issuing'; const issued = handleOwner.issue(); if (state !== 'issuing') return frozen({ status: 'denied' as const, code: 'entropy_unavailable' as const });
            if (issued.status !== 'issued' || !issued.documentHandle) { state = 'unissued'; return frozen({ status: 'denied' as const, code: 'entropy_unavailable' as const }); }
            try { const staged = createDocumentSynthesisAuthenticatedSourceMap({ document: { handle: issued.documentHandle, revision: captured.document.revision, freshness: captured.document.freshness }, sources: capturedSources.map((source) => ({ sourceId: source.sourceId, sourceRef: source.sourceRef, digestSha256: source.digestSha256 })) }); if (state !== 'issuing') { staged.dispose(); return frozen({ status: 'denied' as const, code: 'entropy_unavailable' as const }); } mapper = staged; handle = issued.documentHandle; state = 'issued'; return frozen({ status: 'issued' as const, code: null }); } catch { if (state === 'issuing') state = 'poisoned'; return frozen({ status: 'denied' as const, code: 'entropy_unavailable' as const }); }
        },
        consumeAndMap(value) {
            if (state === 'issuing' || state === 'consuming') { state = 'poisoned'; return denied('handle_consumed'); }
            if (state !== 'issued' || !mapper || !handle) return denied(state === 'unissued' ? 'operation_unavailable' : 'handle_consumed');
            const inputValue = candidate(value); if (!inputValue) return denied('input_invalid');
            const mapped = mapper.map({ documentHandle: handle, revision: captured.document.revision, freshness: captured.document.freshness, ...inputValue }); if (mapped.status !== 'available') return denied(mapped.code);
            state = 'consuming'; let status: 'match' | 'mismatch' | 'unavailable'; try { status = current(currentness(), captured); } catch { status = 'unavailable'; }
            if (state !== 'consuming') return denied('handle_consumed'); if (status !== 'match') { state = 'consumed'; return denied(status === 'mismatch' ? 'currentness_mismatch' : 'currentness_unavailable'); }
            const consumed = handleOwner.consume({ documentHandle: handle }); if (state !== 'consuming') return denied('handle_consumed'); state = 'consumed';
            if (consumed.status !== 'available') return denied(consumed.code);
            return frozen<Available>({ status: 'available', code: null, metadata: consumed.metadata, sourceMap: mapped.sourceMap, binding: mapped.binding, reviewOnly: true, writesPerformed: 0, applyPolicy: 'none' });
        },
        dispose() { if (state === 'disposed') return; state = 'disposed'; mapper?.dispose(); mapper = null; handle = null; },
    });
}
