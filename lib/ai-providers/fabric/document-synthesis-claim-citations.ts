/* @Codex */
import 'server-only';

import { createHash } from 'node:crypto';
import { types } from 'node:util';

import { normalizeDocumentSynthesisOutput, type DocumentSynthesisOutput } from './document-synthesis-output-contract';
import { validateDocumentSynthesisProviderCitations } from './document-synthesis-provider-citations';

export const DOCUMENT_SYNTHESIS_CLAIM_CITATIONS_SCHEMA_VERSION = 'mediflow.document-synthesis.claim-citations.v1' as const;
type Citation = Readonly<{ label: string; quote: string; startByte: number; endByte: number; quoteSha256: string }>;
type Claim = Readonly<{ claimPath: string; labels: readonly string[] }>;
type Common = Readonly<{ reviewOnly: true; writesPerformed: 0; applyPolicy: 'none' }>;
export type DocumentSynthesisClaimCitationsResult =
    | (Readonly<{ status: 'available'; code: null; schemaVersion: typeof DOCUMENT_SYNTHESIS_CLAIM_CITATIONS_SCHEMA_VERSION; output: DocumentSynthesisOutput; outputSha256: string; citations: readonly Citation[]; claims: readonly Claim[] }> & Common)
    | (Readonly<{ status: 'denied'; code: 'input_invalid' | 'output_invalid'; output: null; outputSha256: null; citations: null; claims: null }> & Common);

const OBJECT = Object.prototype; const ARRAY = Array.prototype;
const ObjectCreate = Object.create; const ObjectFreeze = Object.freeze; const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor; const ObjectGetPrototypeOf = Object.getPrototypeOf; const ObjectHasOwn = Object.hasOwn;
const ReflectOwnKeys = Reflect.ownKeys; const ReflectApply = Reflect.apply; const ArrayIsArray = Array.isArray; const NumberIsSafeInteger = Number.isSafeInteger; const StringConstructor = String; const IsProxy = types.isProxy; const JSON_OBJECT = JSON; const JSONStringify = JSON.stringify;
const hashMethods = (() => { const probe = createHash('sha256'); const prototype = ObjectGetPrototypeOf(probe); const update = ObjectGetOwnPropertyDescriptor(prototype, 'update')?.value; const digest = ObjectGetOwnPropertyDescriptor(prototype, 'digest')?.value; if (typeof update !== 'function' || typeof digest !== 'function') throw new TypeError('sha256_hash_methods_unavailable'); return ObjectFreeze({ prototype, update, digest }); })();
const HashPrototype = hashMethods.prototype; const HashUpdate = hashMethods.update; const HashDigest = hashMethods.digest;
const COMMON = { reviewOnly: true as const, writesPerformed: 0 as const, applyPolicy: 'none' as const };

function sealed<T extends object>(value: T): Readonly<T> { const output = ObjectCreate(null) as T; const keys = ReflectOwnKeys(value); for (let index = 0; index < keys.length; index += 1) { const key = keys[index]; if (typeof key === 'string') (output as Record<string, unknown>)[key] = (value as Record<string, unknown>)[key]; } return ObjectFreeze(output); }
function sealedList<T>(value: readonly T[]): readonly T[] { const output: T[] = []; for (let index = 0; index < value.length; index += 1) output[index] = value[index]!; return ObjectFreeze(output); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || ArrayIsArray(value) || IsProxy(value) || ObjectGetPrototypeOf(value) !== OBJECT) return null;
        const found = ReflectOwnKeys(value); if (found.length !== keys.length) return null;
        for (let index = 0; index < keys.length; index += 1) { const key = keys[index]!; let present = false; for (let candidate = 0; candidate < found.length; candidate += 1) if (found[candidate] === key) present = true; if (!present) return null; }
        const copy = ObjectCreate(null) as Record<string, unknown>;
        for (let index = 0; index < keys.length; index += 1) { const key = keys[index]!; const descriptor = ObjectGetOwnPropertyDescriptor(value, key); if (!descriptor || !descriptor.enumerable || !ObjectHasOwn(descriptor, 'value')) return null; copy[key] = descriptor.value; }
        return copy;
    } catch { return null; }
}
function array(value: unknown, minimum = 1, maximum = 194): readonly unknown[] | null {
    try {
        if (!ArrayIsArray(value) || IsProxy(value) || ObjectGetPrototypeOf(value) !== ARRAY) return null;
        const length = ObjectGetOwnPropertyDescriptor(value, 'length');
        if (!length || !ObjectHasOwn(length, 'value') || typeof length.value !== 'number' || !NumberIsSafeInteger(length.value) || length.value < minimum || length.value > maximum || ReflectOwnKeys(value).length !== length.value + 1) return null;
        const copy: unknown[] = [];
        for (let index = 0; index < length.value; index += 1) { const key = ReflectApply(StringConstructor, undefined, [index]) as string; const descriptor = ObjectGetOwnPropertyDescriptor(value, key); if (!descriptor || !descriptor.enumerable || !ObjectHasOwn(descriptor, 'value')) return null; copy[index] = descriptor.value; }
        return sealedList(copy);
    } catch { return null; }
}
function paths(output: DocumentSynthesisOutput): readonly string[] {
    const result = ['summary', 'data.qualityLevel']; if (output.data.qualityReason !== undefined) result[result.length] = 'data.qualityReason';
    const append = (name: string, values: readonly unknown[]) => { for (let index = 0; index < values.length; index += 1) result[result.length] = `data.${name}[${index}]`; };
    append('medications', output.data.medications); append('diagnoses', output.data.diagnoses); append('problemStatements', output.data.problemStatements); append('therapyCandidates', output.data.therapyCandidates);
    for (let index = 0; index < output.data.servicePrescriptions.length; index += 1) { const path = `data.servicePrescriptions[${index}]`; result[result.length] = path; const items = output.data.servicePrescriptions[index]?.items ?? []; for (let item = 0; item < items.length; item += 1) result[result.length] = `${path}.items[${item}]`; }
    return sealedList(result);
}
function sourceIdentity(output: DocumentSynthesisOutput): boolean {
    const check = (values: readonly object[]) => { for (let index = 0; index < values.length; index += 1) if (ObjectHasOwn(values[index]!, 'sourceId')) return true; return false; };
    if (check(output.data.problemStatements) || check(output.data.therapyCandidates) || check(output.data.servicePrescriptions)) return true;
    for (let index = 0; index < output.data.servicePrescriptions.length; index += 1) if (check(output.data.servicePrescriptions[index]?.items ?? [])) return true;
    return false;
}
function outputDigest(output: DocumentSynthesisOutput): string | null {
    try {
        const serialized = ReflectApply(JSONStringify, JSON_OBJECT, [output]); const hash = createHash('sha256');
        if (typeof serialized !== 'string' || IsProxy(hash) || ObjectGetPrototypeOf(hash) !== HashPrototype || ReflectApply(HashUpdate, hash, [serialized, 'utf8']) !== hash) return null;
        const digest = ReflectApply(HashDigest, hash, ['hex']);
        return typeof digest === 'string' && digest.length === 64 ? digest : null;
    } catch { return null; }
}
function claim(value: unknown, expected: string, citations: readonly Citation[]): Claim | null {
    const item = record(value, ['claimPath', 'labels']); const labels = item && array(item.labels, 1, citations.length);
    if (!item || item.claimPath !== expected || !labels) return null;
    const copied: string[] = []; let previous = -1;
    for (let index = 0; index < labels.length; index += 1) { const label = labels[index]; if (typeof label !== 'string') return null; let found = -1; for (let candidate = 0; candidate < citations.length; candidate += 1) if (citations[candidate]?.label === label) found = candidate; if (found < 0 || found <= previous) return null; previous = found; copied[index] = label; }
    return sealed({ claimPath: expected, labels: sealedList(copied) }) as Claim;
}
function denied(code: 'input_invalid' | 'output_invalid'): DocumentSynthesisClaimCitationsResult { return sealed({ status: 'denied' as const, code, output: null, outputSha256: null, citations: null, claims: null, ...COMMON }) as DocumentSynthesisClaimCitationsResult; }

/** Binds every canonical output claim to C3c4-validated locator labels without asserting source truth. */
export function bindDocumentSynthesisClaimsToCitations(value: unknown): DocumentSynthesisClaimCitationsResult {
    try {
        const input = record(value, ['sourceSet', 'output', 'citations', 'claims']); const validated = input && validateDocumentSynthesisProviderCitations({ sourceSet: input.sourceSet, citations: input.citations });
        if (!input || !validated || validated.status !== 'available') return denied('input_invalid');
        const normalized = normalizeDocumentSynthesisOutput(input.output); if (normalized.status !== 'available' || sourceIdentity(normalized.value)) return denied('output_invalid');
        const expected = paths(normalized.value); const values = array(input.claims, expected.length, expected.length); if (!values) return denied('input_invalid');
        const claims: Claim[] = []; for (let index = 0; index < expected.length; index += 1) { const mapped = claim(values[index], expected[index]!, validated.citations); if (!mapped) return denied('input_invalid'); claims[index] = mapped; }
        const outputSha256 = outputDigest(normalized.value); if (!outputSha256) return denied('output_invalid');
        return sealed({ status: 'available' as const, code: null, schemaVersion: DOCUMENT_SYNTHESIS_CLAIM_CITATIONS_SCHEMA_VERSION, output: normalized.value, outputSha256, citations: validated.citations, claims: sealedList(claims), ...COMMON }) as DocumentSynthesisClaimCitationsResult;
    } catch { return denied('input_invalid'); }
}
