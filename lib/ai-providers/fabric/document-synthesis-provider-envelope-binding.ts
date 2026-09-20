import 'server-only';

/* @Codex */
import { createHash } from 'node:crypto';
import { types } from 'node:util';

import { bindDocumentSynthesisClaimsToCitations, type DocumentSynthesisClaimCitationsResult } from './document-synthesis-claim-citations';
import { resolveDocumentSynthesisProviderEnvelope } from './document-synthesis-provider-envelope';
import { composeDocumentSynthesisProviderProjection } from './document-synthesis-source-set-contract';

const OBJECT = Object.prototype;
const ARRAY = Array.prototype;
const ObjectCreate = Object.create;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectHasOwn = Object.hasOwn;
const ReflectOwnKeys = Reflect.ownKeys;
const ReflectApply = Reflect.apply;
const IsProxy = types.isProxy;
const StructuredClone = structuredClone;
const ArrayIsArray = Array.isArray;
const NumberIsSafeInteger = Number.isSafeInteger;
const StringCharCodeAt = String.prototype.charCodeAt;
const TextEncoderConstructor = TextEncoder;
const TextEncoderEncode = TextEncoder.prototype.encode;
const Uint8ArrayConstructor = Uint8Array;
const Uint32ArrayConstructor = Uint32Array;
const encoder = new TextEncoderConstructor();
const hashMethods = (() => {
    const probe = createHash('sha256');
    const prototype = ObjectGetPrototypeOf(probe);
    const update = ObjectGetOwnPropertyDescriptor(prototype, 'update')?.value;
    const digest = ObjectGetOwnPropertyDescriptor(prototype, 'digest')?.value;
    if (typeof update !== 'function' || typeof digest !== 'function') throw new TypeError('sha256_hash_methods_unavailable');
    return ObjectFreeze({ prototype, update, digest });
})();
const HashPrototype = hashMethods.prototype;
const HashUpdate = hashMethods.update;
const HashDigest = hashMethods.digest;

type Input = Readonly<{ sourceSet: object; envelopeToken: object }>;
type Citation = Readonly<{ label: string; quote: string; startByte: number; endByte: number; quoteSha256: string }>;

function sealed<T extends object>(value: T): Readonly<T> {
    const output = ObjectCreate(null) as T;
    const keys = ReflectOwnKeys(value);
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        if (typeof key === 'string') (output as Record<string, unknown>)[key] = (value as Record<string, unknown>)[key];
    }
    return ObjectFreeze(output);
}

const DENIED = sealed({
    status: 'denied' as const,
    code: 'input_invalid' as const,
    output: null,
    outputSha256: null,
    citations: null,
    claims: null,
    reviewOnly: true as const,
    writesPerformed: 0 as const,
    applyPolicy: 'none' as const,
}) as DocumentSynthesisClaimCitationsResult;

function input(value: unknown): Input | null {
    try {
        if (!value || typeof value !== 'object' || IsProxy(value) || ObjectGetPrototypeOf(value) !== OBJECT) return null;
        const keys = ReflectOwnKeys(value);
        if (keys.length !== 2 || !((keys[0] === 'sourceSet' && keys[1] === 'envelopeToken') || (keys[0] === 'envelopeToken' && keys[1] === 'sourceSet'))) return null;
        const sourceSet = ObjectGetOwnPropertyDescriptor(value, 'sourceSet');
        const envelopeToken = ObjectGetOwnPropertyDescriptor(value, 'envelopeToken');
        if (!sourceSet || !envelopeToken || !sourceSet.enumerable || !envelopeToken.enumerable || !ObjectHasOwn(sourceSet, 'value') || !ObjectHasOwn(envelopeToken, 'value')
            || !sourceSet.value || typeof sourceSet.value !== 'object' || IsProxy(sourceSet.value)
            || !envelopeToken.value || typeof envelopeToken.value !== 'object' || IsProxy(envelopeToken.value)) return null;
        return sealed({ sourceSet: sourceSet.value, envelopeToken: envelopeToken.value }) as Input;
    } catch { return null; }
}

function declaredQuote(value: unknown, label: string, maximum: number): string | null {
    if (!value || typeof value !== 'object' || IsProxy(value) || ObjectGetPrototypeOf(value) !== OBJECT) return null;
    const keys = ReflectOwnKeys(value);
    if (keys.length !== 2 || !((keys[0] === 'label' && keys[1] === 'quote') || (keys[0] === 'quote' && keys[1] === 'label'))) return null;
    const declaredLabel = ObjectGetOwnPropertyDescriptor(value, 'label');
    const quote = ObjectGetOwnPropertyDescriptor(value, 'quote');
    if (!declaredLabel || !quote || !declaredLabel.enumerable || !quote.enumerable || !ObjectHasOwn(declaredLabel, 'value') || !ObjectHasOwn(quote, 'value')
        || declaredLabel.value !== label || typeof quote.value !== 'string' || quote.value.length === 0 || quote.value.length > maximum) return null;
    const text = quote.value;
    for (let index = 0; index < text.length; index += 1) {
        const code = ReflectApply(StringCharCodeAt, text, [index]) as number;
        if (code >= 0xd800 && code <= 0xdbff) {
            if (index + 1 >= text.length) return null;
            const next = ReflectApply(StringCharCodeAt, text, [index + 1]) as number;
            if (next < 0xdc00 || next > 0xdfff) return null;
            index += 1;
        } else if (code >= 0xdc00 && code <= 0xdfff) return null;
    }
    return text;
}

/** Linear byte matching counts overlapping occurrences without choosing among repeated quotes. */
function uniqueOffset(quote: Uint8Array, source: Uint8Array): number | null {
    if (quote.length === 0 || quote.length > source.length) return null;
    const prefix = new Uint32ArrayConstructor(quote.length);
    for (let index = 1, matched = 0; index < quote.length; index += 1) {
        while (matched > 0 && quote[index] !== quote[matched]) matched = prefix[matched - 1]!;
        if (quote[index] === quote[matched]) matched += 1;
        prefix[index] = matched;
    }
    let first: number | null = null;
    for (let index = 0, matched = 0; index < source.length; index += 1) {
        while (matched > 0 && source[index] !== quote[matched]) matched = prefix[matched - 1]!;
        if (source[index] === quote[matched]) matched += 1;
        if (matched === quote.length) {
            if (first !== null) return null;
            first = index + 1 - quote.length;
            matched = prefix[matched - 1]!;
        }
    }
    return first;
}

function quoteDigest(source: Uint8Array, start: number, length: number): string | null {
    const bytes = new Uint8ArrayConstructor(length);
    for (let index = 0; index < length; index += 1) bytes[index] = source[start + index]!;
    const hash = createHash('sha256');
    if (IsProxy(hash) || ObjectGetPrototypeOf(hash) !== HashPrototype || ReflectApply(HashUpdate, hash, [bytes]) !== hash) return null;
    const digest = ReflectApply(HashDigest, hash, ['hex']);
    if (typeof digest !== 'string' || digest.length !== 64) return null;
    for (let index = 0; index < digest.length; index += 1) {
        const code = ReflectApply(StringCharCodeAt, digest, [index]) as number;
        if (!((code >= 48 && code <= 57) || (code >= 97 && code <= 102))) return null;
    }
    return digest;
}

function canonicalCitations(sourceSet: object, value: unknown): readonly Citation[] | null {
    const projection = composeDocumentSynthesisProviderProjection(sourceSet);
    if (!projection || !ArrayIsArray(value) || IsProxy(value) || ObjectGetPrototypeOf(value) !== ARRAY) return null;
    const length = ObjectGetOwnPropertyDescriptor(value, 'length');
    if (!length || !ObjectHasOwn(length, 'value') || typeof length.value !== 'number' || !NumberIsSafeInteger(length.value)
        || length.value < 1 || length.value > 32 || length.value !== projection.sources.length || ReflectOwnKeys(value).length !== length.value + 1) return null;
    const citations: Citation[] = [];
    for (let index = 0; index < length.value; index += 1) {
        const descriptor = ObjectGetOwnPropertyDescriptor(value, `${index}`);
        const source = projection.sources[index];
        const label = `S${index + 1}`;
        if (!descriptor || !descriptor.enumerable || !ObjectHasOwn(descriptor, 'value') || !source || source.label !== label) return null;
        const quote = declaredQuote(descriptor.value, label, source.sourceText.length);
        if (quote === null) return null;
        const quoteBytes = ReflectApply(TextEncoderEncode, encoder, [quote]) as Uint8Array;
        const sourceBytes = ReflectApply(TextEncoderEncode, encoder, [source.sourceText]) as Uint8Array;
        const startByte = uniqueOffset(quoteBytes, sourceBytes);
        if (startByte === null) return null;
        const quoteSha256 = quoteDigest(sourceBytes, startByte, quoteBytes.length);
        if (quoteSha256 === null) return null;
        citations[index] = ObjectFreeze({ label, quote, startByte, endByte: startByte + quoteBytes.length, quoteSha256 });
    }
    return ObjectFreeze(citations);
}

/** C3d2b only: binds one authentic C3d2a envelope token to one authentic C3c2 source-set. */
export function bindDocumentSynthesisProviderEnvelope(value: unknown): DocumentSynthesisClaimCitationsResult {
    const descriptor = input(value);
    if (!descriptor) return DENIED;
    const envelope = resolveDocumentSynthesisProviderEnvelope(descriptor.envelopeToken);
    if (!envelope || envelope.schemaVersion !== 'mediflow.document-synthesis.provider-envelope.v2') return DENIED;
    try {
        const cloned = ReflectApply(StructuredClone, undefined, [envelope]) as Readonly<{ output: unknown; citations: unknown; claims: unknown }>;
        const citations = canonicalCitations(descriptor.sourceSet, cloned.citations);
        if (!citations) return DENIED;
        const result = bindDocumentSynthesisClaimsToCitations({ sourceSet: descriptor.sourceSet, output: cloned.output, citations, claims: cloned.claims });
        return result.status === 'available' ? result : DENIED;
    } catch { return DENIED; }
}
