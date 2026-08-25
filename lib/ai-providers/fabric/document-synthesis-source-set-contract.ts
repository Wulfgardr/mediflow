/* @Codex */
import 'server-only';

import { createHash } from 'node:crypto';
import { types } from 'node:util';

const OBJECT = Object.prototype;
const ARRAY = Array.prototype;
const DOMAIN = 'mediflow.document-synthesis.source-set-digest.v1';
const MAX_UNITS = 12_000;
const MAX_SOURCE_BYTES = 36_000;
const MAX_SET_BYTES = 1_152_000;
const ZERO = BigInt(0);
const BYTE = BigInt(255);
const SHIFT = BigInt(8);
const MAX_U64 = BigInt('18446744073709551615');
const encoder = new TextEncoder();
const WeakSetConstructor = WeakSet;
const WeakMapConstructor = WeakMap;
const weakSetAdd = WeakSet.prototype.add;
const weakSetHas = WeakSet.prototype.has;
const weakMapGet = WeakMap.prototype.get;
const weakMapSet = WeakMap.prototype.set;
const apply = Reflect.apply;
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

function sealed<T extends object>(value: T): Readonly<T> { return Object.freeze(Object.assign(Object.create(null) as T, value)); }
function bytes(value: Uint8Array | readonly number[]): Bytes { return Object.freeze(Array.from(value)); }
function deniedProjection(): DocumentSynthesisProjectionResult { return sealed({ status: 'denied' as const, code: 'input_invalid' as const, projection: null }); }
function deniedSourceSet(): DocumentSynthesisSourceSetResult { return sealed({ status: 'denied' as const, code: 'input_invalid' as const, sourceSet: null }); }

function addSourceSetIdentity(value: object): void { apply(weakSetAdd, authenticSourceSets, [value]); }
function hasSourceSetIdentity(value: object): boolean { return apply(weakSetHas, authenticSourceSets, [value]); }
function setProviderSources(value: object, sources: readonly ProviderSource[]): void { apply(weakMapSet, providerSources, [value, sources]); }
function getProviderSources(value: object): readonly ProviderSource[] | undefined { return apply(weakMapGet, providerSources, [value]) as readonly ProviderSource[] | undefined; }

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (typeof value !== 'object' || value === null || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== OBJECT) return null;
        const found = Reflect.ownKeys(value);
        if (found.length !== keys.length || found.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const copy: Record<string, unknown> = Object.create(null);
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
            copy[key] = descriptor.value;
        }
        return copy;
    } catch { return null; }
}

function array(value: unknown): readonly unknown[] | null {
    try {
        if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== ARRAY || value.length < 1 || value.length > 32) return null;
        const found = Reflect.ownKeys(value);
        if (found.length !== value.length + 1 || !found.includes('length')) return null;
        const copy: unknown[] = [];
        for (let index = 0; index < value.length; index += 1) {
            const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
            if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
            copy.push(descriptor.value);
        }
        return copy;
    } catch { return null; }
}

function unicode(value: unknown, normalizeLineEndings: boolean, trim: boolean, limit: number): string | null {
    if (typeof value !== 'string' || value.length > limit) return null;
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) { if (index + 1 >= value.length || value.charCodeAt(index + 1) < 0xdc00 || value.charCodeAt(index + 1) > 0xdfff) return null; index += 1; continue; }
        if (code >= 0xdc00 && code <= 0xdfff) return null;
        if ((code <= 0x08) || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f) || code === 0x7f) return null;
    }
    const normalized = (normalizeLineEndings ? value.replace(/\r\n?/gu, '\n') : value).normalize('NFC');
    const output = trim ? normalized.trim() : normalized;
    return output.length > 0 && output.length <= limit ? output : null;
}

function integer(value: unknown): value is bigint { return typeof value === 'bigint' && value >= ZERO && value <= MAX_U64; }
function digest(value: Uint8Array | readonly number[]): Bytes { return bytes(createHash('sha256').update(Uint8Array.from(value)).digest()); }
function u32(value: number): number[] { return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]; }
function u64(value: bigint): number[] { const output = Array<number>(8); for (let index = 7; index >= 0; index -= 1) { output[index] = Number(value & BYTE); value >>= SHIFT; } return output; }
function compare(a: ParsedProjection, b: ParsedProjection): number {
    const left = encoder.encode(a.documentSourceRef); const right = encoder.encode(b.documentSourceRef);
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) if (left[index] !== right[index]) return left[index] - right[index];
    if (left.length !== right.length) return left.length - right.length;
    return a.documentRevision < b.documentRevision ? -1 : a.documentRevision > b.documentRevision ? 1 : a.documentFreshnessEpoch < b.documentFreshnessEpoch ? -1 : a.documentFreshnessEpoch > b.documentFreshnessEpoch ? 1 : 0;
}

function parse(value: unknown): ParsedProjection | null {
    const input = record(value, ['documentSourceRef', 'documentRevision', 'documentFreshnessEpoch', 'sourceText']);
    if (!input || !integer(input.documentRevision) || !integer(input.documentFreshnessEpoch)) return null;
    const documentSourceRef = unicode(input.documentSourceRef, false, false, MAX_UNITS);
    const sourceText = unicode(input.sourceText, true, true, MAX_UNITS);
    if (!documentSourceRef || !sourceText) return null;
    const sourceBytes = encoder.encode(sourceText);
    const refBytes = encoder.encode(documentSourceRef);
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
        const parsed = sourceValues.map(parse);
        if (parsed.some((item) => item === null)) return deniedSourceSet();
        const ordered = parsed as ParsedProjection[];
        if (ordered.reduce((total, item) => total + item.sourceBytes.length, 0) > MAX_SET_BYTES || new Set(ordered.map((item) => item.documentSourceRef)).size !== ordered.length) return deniedSourceSet();
        ordered.sort(compare);
        const sources = ordered.map((item, index) => sealed({ label: `S${index + 1}`, ...projection(item) }) as Source);
        const payload: number[] = [...u32(encoder.encode(DOMAIN).length), ...encoder.encode(DOMAIN), 0, 1, sources.length, ...u64(input.sourceSetEpoch), ...u64(input.revocationGeneration)];
        for (const item of sources) payload.push(...u32(encoder.encode(item.label).length), ...encoder.encode(item.label), ...u32(encoder.encode(item.documentSourceRef).length), ...encoder.encode(item.documentSourceRef), ...u64(item.documentRevision), ...u64(item.documentFreshnessEpoch), ...item.projectionDigestSha256);
        const digestPayloadBytes = bytes(payload);
        const sourceSet = sealed({ sourceSetEpoch: input.sourceSetEpoch, revocationGeneration: input.revocationGeneration, sources: Object.freeze(sources), digestPayloadBytes, sourceSetDigestSha256: digest(digestPayloadBytes) });
        const snapshot = Object.freeze(sources.map((item) => sealed({ label: item.label, sourceText: item.sourceText }) as ProviderSource));
        addSourceSetIdentity(sourceSet);
        setProviderSources(sourceSet, snapshot);
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
