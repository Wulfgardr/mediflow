/* @Codex */
import 'server-only';

import { createHash } from 'node:crypto';
import { types } from 'node:util';

const DOMAIN = 'mediflow.document-synthesis.claim-citations-digest.v1';
const OBJECT = Object.prototype; const ARRAY = Array.prototype;
const ObjectCreate = Object.create; const ObjectDefineProperty = Object.defineProperty; const ObjectFreeze = Object.freeze; const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor; const ObjectGetPrototypeOf = Object.getPrototypeOf; const ObjectHasOwn = Object.hasOwn; const ObjectIsFrozen = Object.isFrozen;
const ReflectApply = Reflect.apply; const ReflectOwnKeys = Reflect.ownKeys; const ArrayIsArray = Array.isArray; const NumberIsSafeInteger = Number.isSafeInteger; const StringCharCodeAt = String.prototype.charCodeAt; const StringConstructor = String; const TextEncoderEncode = TextEncoder.prototype.encode; const Uint8ArrayConstructor = Uint8Array; const ArrayConstructor = Array; const BigIntConstructor = BigInt; const NumberConstructor = Number; const IsProxy = types.isProxy;
const encoder = new TextEncoder(); const hashProbe = createHash('sha256'); const HashPrototype = ObjectGetPrototypeOf(hashProbe); const HashUpdate = ObjectGetOwnPropertyDescriptor(HashPrototype, 'update')?.value; const HashDigest = ObjectGetOwnPropertyDescriptor(HashPrototype, 'digest')?.value;
const U0_KEYS = ['status', 'code', 'schemaVersion', 'output', 'outputSha256', 'citations', 'claims', 'reviewOnly', 'writesPerformed', 'applyPolicy', 'sourceSetDigestSha256'];
const PAIR_KEYS = ['citations', 'claims']; const CITATION_KEYS = ['label', 'quote', 'startByte', 'endByte', 'quoteSha256']; const CLAIM_KEYS = ['claimPath', 'labels'];
const MAX_U32 = 0xffff_ffff; const BYTE = BigIntConstructor(255); const SHIFT = BigIntConstructor(8);
export const DOCUMENT_SYNTHESIS_CLAIM_CITATIONS_DIGEST_DOMAIN = DOMAIN;
export type DocumentSynthesisClaimCitationsDigest = readonly number[];

function inert<T>(value: readonly T[]): readonly T[] { const copy: T[] = []; for (let index = 0; index < value.length; index += 1) copy[index] = value[index]!; ObjectDefineProperty(copy, 'toJSON', { value: null, enumerable: false, configurable: false, writable: false }); return ObjectFreeze(copy); }
function record(value: unknown, keys: readonly string[], prototype: object | null): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || IsProxy(value) || ObjectGetPrototypeOf(value) !== prototype || !ObjectIsFrozen(value)) return null;
        const found = ReflectOwnKeys(value); if (found.length !== keys.length) return null;
        for (let index = 0; index < keys.length; index += 1) if (found[index] !== keys[index]) return null;
        const copy = ObjectCreate(null) as Record<string, unknown>;
        for (let index = 0; index < keys.length; index += 1) { const key = keys[index]!; const descriptor = ObjectGetOwnPropertyDescriptor(value, key); if (!descriptor || !descriptor.enumerable || !ObjectHasOwn(descriptor, 'value') || descriptor.configurable || descriptor.writable) return null; copy[key] = descriptor.value; }
        return copy;
    } catch { return null; }
}
function list(value: unknown, minimum: number, maximum: number): readonly unknown[] | null {
    try {
        if (typeof value !== 'object' || value === null || IsProxy(value) || !ArrayIsArray(value) || ObjectGetPrototypeOf(value) !== ARRAY || !ObjectIsFrozen(value)) return null;
        const length = ObjectGetOwnPropertyDescriptor(value, 'length'); if (!length || !ObjectHasOwn(length, 'value') || typeof length.value !== 'number' || !NumberIsSafeInteger(length.value) || length.value < minimum || length.value > maximum) return null;
        const found = ReflectOwnKeys(value); if (found.length !== length.value + 2 || found[length.value] !== 'length' || found[length.value + 1] !== 'toJSON') return null;
        const toJSON = ObjectGetOwnPropertyDescriptor(value, 'toJSON'); if (!toJSON || toJSON.value !== null || toJSON.enumerable || toJSON.configurable || toJSON.writable) return null;
        const copy: unknown[] = []; for (let index = 0; index < length.value; index += 1) { const key = ReflectApply(StringConstructor, undefined, [index]) as string; const descriptor = ObjectGetOwnPropertyDescriptor(value, key); if (!descriptor || !descriptor.enumerable || !ObjectHasOwn(descriptor, 'value') || descriptor.configurable || descriptor.writable) return null; copy[index] = descriptor.value; }
        return inert(copy);
    } catch { return null; }
}
function unicode(value: unknown): Uint8Array | null {
    if (typeof value !== 'string' || value.length === 0) return null;
    for (let index = 0; index < value.length; index += 1) { const code = ReflectApply(StringCharCodeAt, value, [index]) as number; if (code >= 0xd800 && code <= 0xdbff) { const next = index + 1 < value.length ? ReflectApply(StringCharCodeAt, value, [index + 1]) as number : -1; if (next < 0xdc00 || next > 0xdfff) return null; index += 1; } else if (code >= 0xdc00 && code <= 0xdfff) return null; }
    const bytes = ReflectApply(TextEncoderEncode, encoder, [value]) as Uint8Array; return bytes.length > 0 && bytes.length <= MAX_U32 ? bytes : null;
}
function raw32(value: unknown): Uint8Array | null {
    if (typeof value !== 'string' || value.length !== 64) return null; const output = new Uint8ArrayConstructor(32);
    for (let index = 0; index < 32; index += 1) { const high = ReflectApply(StringCharCodeAt, value, [index * 2]) as number; const low = ReflectApply(StringCharCodeAt, value, [index * 2 + 1]) as number; const digit = (code: number) => code >= 48 && code <= 57 ? code - 48 : code >= 97 && code <= 102 ? code - 87 : -1; const a = digit(high); const b = digit(low); if (a < 0 || b < 0) return null; output[index] = a * 16 + b; }
    return output;
}
function append(target: number[], value: ArrayLike<number>): void { for (let index = 0; index < value.length; index += 1) target[target.length] = value[index]!; }
function u32(value: number): number[] { return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]; }
function u64(value: number): number[] { const output = new ArrayConstructor<number>(8); let current = BigIntConstructor(value); for (let index = 7; index >= 0; index -= 1) { output[index] = NumberConstructor(current & BYTE); current >>= SHIFT; } return output; }
function digest(payload: number[]): DocumentSynthesisClaimCitationsDigest | null {
    try { if (typeof HashUpdate !== 'function' || typeof HashDigest !== 'function') return null; const hash = createHash('sha256'); if (IsProxy(hash) || ObjectGetPrototypeOf(hash) !== HashPrototype || ReflectApply(HashUpdate, hash, [new Uint8ArrayConstructor(payload)]) !== hash) return null; const raw = ReflectApply(HashDigest, hash, []); if (!raw || typeof raw !== 'object' || (raw as ArrayLike<unknown>).length !== 32) return null; const output: number[] = []; for (let index = 0; index < 32; index += 1) { const byte = (raw as ArrayLike<unknown>)[index]; if (typeof byte !== 'number' || byte < 0 || byte > 255 || !NumberIsSafeInteger(byte)) return null; output[index] = byte; } return inert(output);
    } catch { return null; }
}
function pair(value: unknown): { citations: readonly unknown[]; claims: readonly unknown[] } | null {
    const item = record(value, PAIR_KEYS, OBJECT); if (!item) return null; const citations = list(item.citations, 1, 32); const claims = list(item.claims, 1, 194); return citations && claims ? { citations, claims } : null;
}
function u0(value: unknown): { citations: readonly unknown[]; claims: readonly unknown[] } | null {
    const item = record(value, U0_KEYS, null); const sourceDigest = item && list(item.sourceSetDigestSha256, 32, 32); if (!item || item.status !== 'available' || item.code !== null || item.schemaVersion !== 'mediflow.document-synthesis.claim-citations.v1' || !item.output || typeof item.output !== 'object' || ObjectGetPrototypeOf(item.output) !== null || !ObjectIsFrozen(item.output) || typeof item.outputSha256 !== 'string' || !raw32(item.outputSha256) || item.reviewOnly !== true || item.writesPerformed !== 0 || item.applyPolicy !== 'none' || !sourceDigest) return null;
    for (let index = 0; index < sourceDigest.length; index += 1) { const byte = sourceDigest[index]; if (typeof byte !== 'number' || !NumberIsSafeInteger(byte) || byte < 0 || byte > 255) return null; }
    const citations = list(item.citations, 1, 32); const claims = list(item.claims, 1, 194); return citations && claims ? { citations, claims } : null;
}

/** Hashes an already host-validated U0 citation/claim set; this proves only ordered retained evidence, not clinical entailment or authority. */
export function digestDocumentSynthesisClaimCitations(value: unknown): DocumentSynthesisClaimCitationsDigest | null {
    try {
        const input = u0(value) ?? pair(value); if (!input) return null; const payload: number[] = []; const domain = unicode(DOMAIN); if (!domain) return null;
        append(payload, u32(domain.length)); append(payload, domain); payload[payload.length] = 0; payload[payload.length] = 1; append(payload, [(input.citations.length >>> 8) & 255, input.citations.length & 255]); const labels: string[] = [];
        for (let index = 0; index < input.citations.length; index += 1) { const citation = record(input.citations[index], CITATION_KEYS, null); if (!citation || typeof citation.label !== 'string' || typeof citation.quote !== 'string' || typeof citation.startByte !== 'number' || typeof citation.endByte !== 'number' || !NumberIsSafeInteger(citation.startByte) || !NumberIsSafeInteger(citation.endByte) || citation.startByte < 0 || citation.endByte < citation.startByte) return null; const labelValue = citation.label; const label = unicode(labelValue); const quote = unicode(citation.quote); const quoted = raw32(citation.quoteSha256); if (!label || !quote || !quoted) return null; for (let prior = 0; prior < labels.length; prior += 1) if (labels[prior] === labelValue) return null; labels[index] = labelValue; append(payload, u32(label.length)); append(payload, label); append(payload, u32(quote.length)); append(payload, quote); append(payload, u64(citation.startByte)); append(payload, u64(citation.endByte)); append(payload, quoted); }
        append(payload, [(input.claims.length >>> 8) & 255, input.claims.length & 255]); const paths: string[] = [];
        for (let index = 0; index < input.claims.length; index += 1) { const claim = record(input.claims[index], CLAIM_KEYS, null); if (!claim || typeof claim.claimPath !== 'string') return null; const claimPathValue = claim.claimPath; const claimPath = unicode(claimPathValue); const claimLabels = list(claim.labels, 1, input.citations.length); if (!claimPath || !claimLabels) return null; for (let prior = 0; prior < paths.length; prior += 1) if (paths[prior] === claimPathValue) return null; paths[index] = claimPathValue; append(payload, u32(claimPath.length)); append(payload, claimPath); append(payload, [(claimLabels.length >>> 8) & 255, claimLabels.length & 255]); let previous = -1;
            for (let labelIndex = 0; labelIndex < claimLabels.length; labelIndex += 1) { const label = claimLabels[labelIndex]; if (typeof label !== 'string') return null; let found = -1; for (let candidate = 0; candidate < labels.length; candidate += 1) if (labels[candidate] === label) found = candidate; if (found <= previous) return null; previous = found; const bytes = unicode(label); if (!bytes) return null; append(payload, u32(bytes.length)); append(payload, bytes); }
        }
        return digest(payload);
    } catch { return null; }
}
