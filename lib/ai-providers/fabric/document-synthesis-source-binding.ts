import 'server-only';

/* @Codex */
import { types } from 'node:util';

export const DOCUMENT_SYNTHESIS_SOURCE_BINDING_SCHEMA_VERSION = 'mediflow.document-synthesis.source-binding.v1' as const;

declare const sourceBindingTokenBrand: unique symbol;
export type DocumentSynthesisSourceBindingToken = Readonly<{ readonly [sourceBindingTokenBrand]: true }>;

type DocumentVersion = Readonly<{ handle: string; revision: number; freshness: string }>;
type Source = Readonly<{ sourceId: string; sourceRef: string; digestSha256: string }>;
type Binding = Readonly<{
    schemaVersion: typeof DOCUMENT_SYNTHESIS_SOURCE_BINDING_SCHEMA_VERSION;
    document: DocumentVersion;
    sources: readonly Source[];
}>;
type Common = Readonly<{ reviewOnly: true; writesPerformed: 0; applyPolicy: 'none' }>;
type Available = Readonly<{ status: 'available'; code: null; binding: Binding }> & Common;
type DenialCode = 'binding_invalid' | 'binding_disposed' | 'input_invalid' | 'document_mismatch' | 'revision_mismatch' | 'freshness_mismatch' | 'source_unknown';
type Denied = Readonly<{ status: 'denied'; code: DenialCode; binding: null }> & Common;
export type DocumentSynthesisSourceBindingResult = Available | Denied;

const ownKeys = Reflect.ownKeys;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const hasOwn = Object.hasOwn;
const isArray = Array.isArray;
const objectPrototype = Object.prototype;
const arrayPrototype = Array.prototype;
const freeze = Object.freeze;
const create = Object.create;
const COMMON = freeze({ reviewOnly: true as const, writesPerformed: 0 as const, applyPolicy: 'none' as const });
const DOCUMENT_HANDLE = /^dsh_[a-f0-9]{32}$/u;
const SOURCE_ID = /^source\.[a-z0-9][a-z0-9._:-]{2,127}$/u;
const SOURCE_REF = /^document_source_[A-Za-z0-9._:-]{16,128}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;

export class DocumentSynthesisSourceBindingConfigurationError extends Error {
    constructor() { super('Document synthesis source binding configuration rejected'); this.name = 'DocumentSynthesisSourceBindingConfigurationError'; }
}

function nullRecord<T extends object>(value: Record<string, unknown>): T {
    return freeze(Object.assign(create(null), value)) as T;
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (types.isProxy(value) || typeof value !== 'object' || value === null || isArray(value) || getPrototypeOf(value) !== objectPrototype) return null;
        const found = ownKeys(value);
        if (found.length !== keys.length || found.some((key) => typeof key !== 'string' || !keys.includes(key)) || keys.some((key) => !found.includes(key))) return null;
        const output: Record<string, unknown> = create(null) as Record<string, unknown>;
        for (const key of keys) {
            const descriptor = getOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) return null;
            output[key] = descriptor.value;
        }
        return output;
    } catch { return null; }
}

function array(value: unknown, maximum: number): readonly unknown[] | null {
    try {
        if (types.isProxy(value) || !isArray(value) || getPrototypeOf(value) !== arrayPrototype || value.length < 1 || value.length > maximum) return null;
        const found = ownKeys(value);
        if (found.length !== value.length + 1 || !found.includes('length')) return null;
        const output: unknown[] = [];
        for (let index = 0; index < value.length; index += 1) {
            const descriptor = getOwnPropertyDescriptor(value, String(index));
            if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) return null;
            output.push(descriptor.value);
        }
        return output;
    } catch { return null; }
}

function timestamp(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function documentVersion(value: unknown): DocumentVersion | null {
    const item = record(value, ['handle', 'revision', 'freshness']);
    if (!item || typeof item.handle !== 'string' || !DOCUMENT_HANDLE.test(item.handle)
        || typeof item.revision !== 'number' || !Number.isSafeInteger(item.revision) || item.revision < 0
        || !timestamp(item.freshness)) return null;
    return nullRecord<DocumentVersion>({ handle: item.handle, revision: item.revision, freshness: item.freshness });
}

function source(value: unknown): Source | null {
    const item = record(value, ['sourceId', 'sourceRef', 'digestSha256']);
    if (!item || typeof item.sourceId !== 'string' || !SOURCE_ID.test(item.sourceId)
        || typeof item.sourceRef !== 'string' || !SOURCE_REF.test(item.sourceRef)
        || typeof item.digestSha256 !== 'string' || !DIGEST.test(item.digestSha256)) return null;
    return nullRecord<Source>({ sourceId: item.sourceId, sourceRef: item.sourceRef, digestSha256: item.digestSha256 });
}

function denied(code: DenialCode): Denied { return nullRecord<Denied>({ status: 'denied', code, binding: null, ...COMMON }); }

export function createDocumentSynthesisSourceBindingOwner(configuration: unknown): Readonly<{
    token: DocumentSynthesisSourceBindingToken;
    resolve(token: unknown, request: unknown): DocumentSynthesisSourceBindingResult;
    dispose(): void;
}> {
    const input = record(configuration, ['document', 'sources']);
    const document = input && documentVersion(input.document);
    const sourceItems = input && array(input.sources, 32);
    const sources = sourceItems?.map(source) ?? null;
    if (!input || !document || !sourceItems || !sources || sources.some((item) => item === null)) throw new DocumentSynthesisSourceBindingConfigurationError();
    const acceptedSources = sources as Source[];
    if (new Set(acceptedSources.map((item) => item.sourceId)).size !== acceptedSources.length
        || new Set(acceptedSources.map((item) => item.sourceRef)).size !== acceptedSources.length) throw new DocumentSynthesisSourceBindingConfigurationError();
    const byId = new Map(acceptedSources.map((item) => [item.sourceId, item] as const));
    const token = nullRecord<DocumentSynthesisSourceBindingToken>({});
    let disposed = false;
    const resolve = (candidate: unknown, request: unknown): DocumentSynthesisSourceBindingResult => {
        if (types.isProxy(candidate) || candidate !== token) return denied('binding_invalid');
        if (disposed) return denied('binding_disposed');
        const value = record(request, ['documentHandle', 'revision', 'freshness', 'sourceIds']);
        const ids = value && array(value.sourceIds, 32);
        if (!value || !ids || ids.some((id) => typeof id !== 'string' || !SOURCE_ID.test(id)) || new Set(ids).size !== ids.length) return denied('input_invalid');
        if (value.documentHandle !== document.handle) return denied('document_mismatch');
        if (value.revision !== document.revision) return denied('revision_mismatch');
        if (value.freshness !== document.freshness) return denied('freshness_mismatch');
        const selected = ids.map((id) => byId.get(id as string));
        if (selected.some((item) => item === undefined)) return denied('source_unknown');
        const binding = nullRecord<Binding>({ schemaVersion: DOCUMENT_SYNTHESIS_SOURCE_BINDING_SCHEMA_VERSION, document, sources: freeze(selected as Source[]) });
        return nullRecord<Available>({ status: 'available', code: null, binding, ...COMMON });
    };
    return nullRecord({ token, resolve, dispose() { disposed = true; } });
}
