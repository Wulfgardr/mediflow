/* @Codex */
import 'server-only';

import { createHash } from 'node:crypto';
import { types } from 'node:util';

import { digestDocumentSynthesisSourceSet } from '../../security/document-synthesis-source-set-digest';

const OBJECT = Object.prototype;
const ARRAY = Array.prototype;
const MAX_UNITS = 12_000;
const MAX_SOURCE_BYTES = 36_000;
const MAX_SET_BYTES = 1_152_000;
const ZERO = BigInt(0);
const MAX_U64 = BigInt('18446744073709551615');
const encoder = new TextEncoder();
const ObjectCreate = Object.create;
const ObjectDefineProperty = Object.defineProperty;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectHasOwn = Object.hasOwn;
const ReflectOwnKeys = Reflect.ownKeys;
const ReflectApply = Reflect.apply;
const ArrayIsArray = Array.isArray;
const IsProxy = types.isProxy;
const StringCharCodeAt = String.prototype.charCodeAt;
const StringConstructor = String;
const StringReplace = String.prototype.replace;
const StringNormalize = String.prototype.normalize;
const StringTrim = String.prototype.trim;
const Uint8ArrayConstructor = Uint8Array;
const NumberIsSafeInteger = Number.isSafeInteger;
const TextEncoderEncode = TextEncoder.prototype.encode;
const WeakSetConstructor = WeakSet;
const WeakMapConstructor = WeakMap;
const weakSetAdd = WeakSet.prototype.add;
const weakSetHas = WeakSet.prototype.has;
const weakMapGet = WeakMap.prototype.get;
const weakMapSet = WeakMap.prototype.set;
const authenticSourceSets = new WeakSetConstructor<object>();

type Bytes = readonly number[];
type Projection = Readonly<{ documentSourceRef: string; documentRevision: bigint; documentFreshnessEpoch: bigint; sourceText: string; sourceByteLength: number; projectionDigestSha256: Bytes }>;
type Source = Readonly<Projection & { label: string }>;
type SourceSet = Readonly<{ sourceSetEpoch: bigint; revocationGeneration: bigint; sources: readonly Source[]; digestPayloadBytes: Bytes; sourceSetDigestSha256: Bytes }>;
type ProviderSource = Readonly<{ label: string; sourceText: string }>;
export type DocumentSynthesisProviderProjection = Readonly<{
    schemaVersion: 'mediflow.document-synthesis.provider-projection.v1';
    sources: readonly ProviderSource[];
}>;
export type DocumentSynthesisProjectionResult = Readonly<{ status: 'available'; code: null; projection: Projection }> | Readonly<{ status: 'denied'; code: 'input_invalid'; projection: null }>;
export type DocumentSynthesisSourceSetResult = Readonly<{ status: 'available'; code: null; sourceSet: SourceSet }> | Readonly<{ status: 'denied'; code: 'input_invalid'; sourceSet: null }>;
type ParsedProjection = Readonly<{ documentSourceRef: string; documentRevision: bigint; documentFreshnessEpoch: bigint; sourceText: string; sourceBytes: Uint8Array }>;
const providerSources = new WeakMapConstructor<object, readonly ProviderSource[]>();

function sealed<T extends object>(value: T): Readonly<T> {
    const output = ObjectCreate(null) as T;
    const keys = ReflectOwnKeys(value);
    for (let index = 0; index < keys.length; index += 1) { const key = keys[index]; if (typeof key === 'string') (output as Record<string, unknown>)[key] = (value as Record<string, unknown>)[key]; }
    return ObjectFreeze(output);
}
function sealedList<T>(value: readonly T[]): readonly T[] { const output: T[] = []; for (let index = 0; index < value.length; index += 1) output[index] = value[index]!; ObjectDefineProperty(output, 'toJSON', { value: null, enumerable: false, configurable: false, writable: false }); return ObjectFreeze(output); }
function bytes(value: Uint8Array | readonly number[]): Bytes { const output: number[] = []; for (let index = 0; index < value.length; index += 1) output[index] = value[index]!; return sealedList(output); }
function encode(value: string): Uint8Array { return ReflectApply(TextEncoderEncode, encoder, [value]) as Uint8Array; }
function deniedProjection(): DocumentSynthesisProjectionResult { return sealed({ status: 'denied' as const, code: 'input_invalid' as const, projection: null }); }
function deniedSourceSet(): DocumentSynthesisSourceSetResult { return sealed({ status: 'denied' as const, code: 'input_invalid' as const, sourceSet: null }); }

function addSourceSetIdentity(value: object): void { ReflectApply(weakSetAdd, authenticSourceSets, [value]); }
function hasSourceSetIdentity(value: object): boolean { return ReflectApply(weakSetHas, authenticSourceSets, [value]); }
function setProviderSources(value: object, sources: readonly ProviderSource[]): void { ReflectApply(weakMapSet, providerSources, [value, sources]); }
function getProviderSources(value: object): readonly ProviderSource[] | undefined { return ReflectApply(weakMapGet, providerSources, [value]) as readonly ProviderSource[] | undefined; }

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (typeof value !== 'object' || value === null || ArrayIsArray(value) || IsProxy(value) || ObjectGetPrototypeOf(value) !== OBJECT) return null;
        const found = ReflectOwnKeys(value);
        if (found.length !== keys.length) return null;
        for (let index = 0; index < found.length; index += 1) { const key = found[index]; let expected = false; for (let candidate = 0; candidate < keys.length; candidate += 1) if (key === keys[candidate]) expected = true; if (typeof key !== 'string' || !expected) return null; }
        const copy: Record<string, unknown> = ObjectCreate(null);
        for (let index = 0; index < keys.length; index += 1) { const key = keys[index]!;
            const descriptor = ObjectGetOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !ObjectHasOwn(descriptor, 'value')) return null;
            copy[key] = descriptor.value;
        }
        return copy;
    } catch { return null; }
}

function array(value: unknown): readonly unknown[] | null {
    try {
        if (!ArrayIsArray(value) || IsProxy(value) || ObjectGetPrototypeOf(value) !== ARRAY) return null;
        const length = ObjectGetOwnPropertyDescriptor(value, 'length');
        if (!length || !ObjectHasOwn(length, 'value') || typeof length.value !== 'number' || !NumberIsSafeInteger(length.value) || length.value < 1 || length.value > 32) return null;
        const found = ReflectOwnKeys(value);
        if (found.length !== length.value + 1) return null;
        const copy: unknown[] = [];
        for (let index = 0; index < length.value; index += 1) {
            const key = ReflectApply(StringConstructor, undefined, [index]) as string;
            const descriptor = ObjectGetOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !ObjectHasOwn(descriptor, 'value')) return null;
            copy[index] = descriptor.value;
        }
        return sealedList(copy);
    } catch { return null; }
}

function unicode(value: unknown, normalizeLineEndings: boolean, trim: boolean, limit: number): string | null {
    if (typeof value !== 'string' || value.length > limit) return null;
    for (let index = 0; index < value.length; index += 1) {
        const code = ReflectApply(StringCharCodeAt, value, [index]) as number;
        if (code >= 0xd800 && code <= 0xdbff) { const next = index + 1 < value.length ? ReflectApply(StringCharCodeAt, value, [index + 1]) as number : -1; if (next < 0xdc00 || next > 0xdfff) return null; index += 1; continue; }
        if (code >= 0xdc00 && code <= 0xdfff) return null;
        if ((code <= 0x08) || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f) || code === 0x7f) return null;
    }
    const normalized = ReflectApply(StringNormalize, normalizeLineEndings ? ReflectApply(StringReplace, value, [/\r\n?/gu, '\n']) as string : value, ['NFC']) as string;
    const output = trim ? ReflectApply(StringTrim, normalized, []) as string : normalized;
    return output.length > 0 && output.length <= limit ? output : null;
}

function integer(value: unknown): value is bigint { return typeof value === 'bigint' && value >= ZERO && value <= MAX_U64; }
function digest(value: Uint8Array | readonly number[]): Bytes { const copy = new Uint8ArrayConstructor(value.length); for (let index = 0; index < value.length; index += 1) copy[index] = value[index]!; return bytes(createHash('sha256').update(copy).digest()); }
function compare(a: ParsedProjection, b: ParsedProjection): number {
    const left = encode(a.documentSourceRef); const right = encode(b.documentSourceRef); const length = left.length < right.length ? left.length : right.length;
    for (let index = 0; index < length; index += 1) if (left[index] !== right[index]) return left[index] - right[index];
    if (left.length !== right.length) return left.length - right.length;
    return a.documentRevision < b.documentRevision ? -1 : a.documentRevision > b.documentRevision ? 1 : a.documentFreshnessEpoch < b.documentFreshnessEpoch ? -1 : a.documentFreshnessEpoch > b.documentFreshnessEpoch ? 1 : 0;
}

function parse(value: unknown): ParsedProjection | null {
    const input = record(value, ['documentSourceRef', 'documentRevision', 'documentFreshnessEpoch', 'sourceText']);
    if (!input || !integer(input.documentRevision) || !integer(input.documentFreshnessEpoch)) return null;
    const documentSourceRef = unicode(input.documentSourceRef, false, false, MAX_UNITS);
    const sourceText = unicode(input.sourceText, true, true, MAX_UNITS);
    if (!documentSourceRef || !sourceText) return null;
    const sourceBytes = encode(sourceText);
    const refBytes = encode(documentSourceRef);
    if (sourceBytes.length > MAX_SOURCE_BYTES || refBytes.length === 0 || refBytes.length > 0xffff_ffff) return null;
    return { documentSourceRef, documentRevision: input.documentRevision, documentFreshnessEpoch: input.documentFreshnessEpoch, sourceText, sourceBytes };
}

function projection(value: ParsedProjection): Projection { return sealed({ documentSourceRef: value.documentSourceRef, documentRevision: value.documentRevision, documentFreshnessEpoch: value.documentFreshnessEpoch, sourceText: value.sourceText, sourceByteLength: value.sourceBytes.length, projectionDigestSha256: digest(value.sourceBytes) }); }

/** Normalizes one pre-captured source projection; it has no authority or I/O. */
export function normalizeDocumentSynthesisProjection(value: unknown): DocumentSynthesisProjectionResult {
    try {
        const parsed = parse(value); if (!parsed) return deniedProjection();
        return sealed({ status: 'available' as const, code: null, projection: projection(parsed) });
    } catch { return deniedProjection(); }
}

/** Captures, labels, and digests a closed pre-captured source set without runtime work. */
export function captureDocumentSynthesisSourceSet(value: unknown): DocumentSynthesisSourceSetResult {
    try {
        const input = record(value, ['sources', 'sourceSetEpoch', 'revocationGeneration']);
        const sourceValues = input && array(input.sources);
        if (!input || !sourceValues || !integer(input.sourceSetEpoch) || !integer(input.revocationGeneration)) return deniedSourceSet();
        const ordered: ParsedProjection[] = []; let total = 0;
        for (let index = 0; index < sourceValues.length; index += 1) { const item = parse(sourceValues[index]); if (!item) return deniedSourceSet(); total += item.sourceBytes.length; for (let prior = 0; prior < ordered.length; prior += 1) if (ordered[prior]!.documentSourceRef === item.documentSourceRef) return deniedSourceSet(); let position = ordered.length; while (position > 0 && compare(item, ordered[position - 1]!) < 0) { ordered[position] = ordered[position - 1]!; position -= 1; } ordered[position] = item; }
        if (total > MAX_SET_BYTES) return deniedSourceSet();
        const sources: Source[] = []; for (let index = 0; index < ordered.length; index += 1) { const item = projection(ordered[index]!); sources[index] = sealed({ label: `S${index + 1}`, documentSourceRef: item.documentSourceRef, documentRevision: item.documentRevision, documentFreshnessEpoch: item.documentFreshnessEpoch, sourceText: item.sourceText, sourceByteLength: item.sourceByteLength, projectionDigestSha256: item.projectionDigestSha256 }) as Source; }
        const digestSources: unknown[] = [];
        for (let index = 0; index < sources.length; index += 1) { const item = sources[index]!; digestSources[index] = { label: item.label, documentSourceRef: item.documentSourceRef, documentRevision: item.documentRevision, documentFreshnessEpoch: item.documentFreshnessEpoch, sourceByteLength: item.sourceByteLength, projectionDigestSha256: item.projectionDigestSha256 }; }
        const coded = digestDocumentSynthesisSourceSet({ sources: digestSources, sourceSetEpoch: input.sourceSetEpoch, revocationGeneration: input.revocationGeneration });
        if (coded.status !== 'available') return deniedSourceSet();
        const sourceSet = sealed({ sourceSetEpoch: input.sourceSetEpoch, revocationGeneration: input.revocationGeneration, sources: sealedList(sources), digestPayloadBytes: coded.digestPayloadBytes, sourceSetDigestSha256: coded.sourceSetDigestSha256 });
        const snapshot: ProviderSource[] = []; for (let index = 0; index < sources.length; index += 1) { const item = sources[index]!; snapshot[index] = sealed({ label: item.label, sourceText: item.sourceText }) as ProviderSource; }
        addSourceSetIdentity(sourceSet);
        setProviderSources(sourceSet, sealedList(snapshot));
        return sealed({ status: 'available' as const, code: null, sourceSet });
    } catch { return deniedSourceSet(); }
}

/** Projects an authentic C3c2 source-set identity into the provider's minimal input only. */
export function composeDocumentSynthesisProviderProjection(sourceSet: unknown): DocumentSynthesisProviderProjection | null {
    if (typeof sourceSet !== 'object' || sourceSet === null || !hasSourceSetIdentity(sourceSet)) return null;
    const snapshot = getProviderSources(sourceSet);
    if (!snapshot) return null;
    return sealed({
        schemaVersion: 'mediflow.document-synthesis.provider-projection.v1' as const,
        sources: snapshot,
    });
}
