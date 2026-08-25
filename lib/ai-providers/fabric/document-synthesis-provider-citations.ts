/* @Codex */
import 'server-only';

import { createHash } from 'node:crypto';
import { types } from 'node:util';

import { composeDocumentSynthesisProviderProjection } from './document-synthesis-source-set-contract';

export const DOCUMENT_SYNTHESIS_PROVIDER_CITATIONS_SCHEMA_VERSION = 'mediflow.document-synthesis.provider-citations.v1' as const;

type Citation = Readonly<{ label: string; quote: string; startByte: number; endByte: number; quoteSha256: string }>;
type Common = Readonly<{ reviewOnly: true; writesPerformed: 0; applyPolicy: 'none' }>;
export type DocumentSynthesisProviderCitationsResult =
    | (Readonly<{ status: 'available'; code: null; citations: readonly Citation[]; schemaVersion: typeof DOCUMENT_SYNTHESIS_PROVIDER_CITATIONS_SCHEMA_VERSION }> & Common)
    | (Readonly<{ status: 'denied'; code: 'input_invalid'; citations: null }> & Common);

const OBJECT = Object.prototype;
const ARRAY = Array.prototype;
const ObjectCreate = Object.create;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectHasOwn = Object.hasOwn;
const ReflectOwnKeys = Reflect.ownKeys;
const ReflectApply = Reflect.apply;
const ArrayIsArray = Array.isArray;
const ArrayIncludes = Array.prototype.includes;
const IsProxy = types.isProxy;
const NumberIsSafeInteger = Number.isSafeInteger;
const StringCharCodeAt = String.prototype.charCodeAt;
const encode = TextEncoder.prototype.encode;
const encoder = new TextEncoder();
const COMMON = { reviewOnly: true as const, writesPerformed: 0 as const, applyPolicy: 'none' as const };

function sealed<T extends object>(value: T): Readonly<T> {
    const output = ObjectCreate(null) as T;
    for (const key of ReflectOwnKeys(value)) if (typeof key === 'string') (output as Record<string, unknown>)[key] = (value as Record<string, unknown>)[key];
    return ObjectFreeze(output);
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || ArrayIsArray(value) || IsProxy(value) || ObjectGetPrototypeOf(value) !== OBJECT) return null;
        const found = ReflectOwnKeys(value); if (found.length !== keys.length) return null;
        for (const key of keys) if (!ReflectApply(ArrayIncludes, found, [key])) return null;
        const copy = ObjectCreate(null) as Record<string, unknown>;
        for (const key of keys) { const descriptor = ObjectGetOwnPropertyDescriptor(value, key); if (!descriptor || !descriptor.enumerable || !ObjectHasOwn(descriptor, 'value')) return null; copy[key] = descriptor.value; }
        return copy;
    } catch { return null; }
}
function array(value: unknown): readonly unknown[] | null {
    try {
        if (!ArrayIsArray(value) || IsProxy(value) || ObjectGetPrototypeOf(value) !== ARRAY || value.length < 1 || value.length > 32 || ReflectOwnKeys(value).length !== value.length + 1) return null;
        const copy: unknown[] = [];
        for (let index = 0; index < value.length; index += 1) { const descriptor = ObjectGetOwnPropertyDescriptor(value, String(index)); if (!descriptor || !descriptor.enumerable || !ObjectHasOwn(descriptor, 'value')) return null; copy[index] = descriptor.value; }
        return ObjectFreeze(copy);
    } catch { return null; }
}
function integer(value: unknown): value is number { return typeof value === 'number' && NumberIsSafeInteger(value); }
function scalar(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) {
        const code = ReflectApply(StringCharCodeAt, value, [index]) as number;
        if (code >= 0xd800 && code <= 0xdbff) { if (index + 1 >= value.length) return false; const next = ReflectApply(StringCharCodeAt, value, [index + 1]) as number; if (next < 0xdc00 || next > 0xdfff) return false; index += 1; }
        else if (code >= 0xdc00 && code <= 0xdfff) return false;
    }
    return true;
}
function hex(value: unknown): value is string {
    if (typeof value !== 'string' || value.length !== 64) return false;
    for (let index = 0; index < value.length; index += 1) { const code = ReflectApply(StringCharCodeAt, value, [index]) as number; if (!((code >= 48 && code <= 57) || (code >= 97 && code <= 102))) return false; }
    return true;
}
function utf8(value: string): Uint8Array { return ReflectApply(encode, encoder, [value]) as Uint8Array; }
function equal(left: Uint8Array, right: Uint8Array, start = 0): boolean { if (left.length + start > right.length) return false; for (let index = 0; index < left.length; index += 1) if (left[index] !== right[start + index]) return false; return true; }
function occurrences(quote: Uint8Array, source: Uint8Array): number { let count = 0; for (let index = 0; index + quote.length <= source.length; index += 1) if (equal(quote, source, index)) count += 1; return count; }
function citation(value: unknown, label: string, sourceText: string): Citation | null {
    const item = record(value, ['label', 'quote', 'startByte', 'endByte', 'quoteSha256']);
    if (!item || item.label !== label || typeof item.quote !== 'string' || !scalar(item.quote) || !integer(item.startByte) || !integer(item.endByte) || item.startByte < 0 || item.endByte <= item.startByte || !hex(item.quoteSha256)) return null;
    const quote = utf8(item.quote); const source = utf8(sourceText);
    if (!quote.length || item.endByte > source.length || item.endByte - item.startByte !== quote.length || !equal(quote, source, item.startByte) || occurrences(quote, source) !== 1 || createHash('sha256').update(quote).digest('hex') !== item.quoteSha256) return null;
    return sealed({ label, quote: item.quote, startByte: item.startByte, endByte: item.endByte, quoteSha256: item.quoteSha256 }) as Citation;
}
function denied(): DocumentSynthesisProviderCitationsResult { return sealed({ status: 'denied' as const, code: 'input_invalid' as const, citations: null, ...COMMON }) as DocumentSynthesisProviderCitationsResult; }

/** Validates provider-declared quote locators against one authentic, host-owned C3c2 source set. */
export function validateDocumentSynthesisProviderCitations(value: unknown): DocumentSynthesisProviderCitationsResult {
    try {
        const input = record(value, ['sourceSet', 'citations']); const projection = input && composeDocumentSynthesisProviderProjection(input.sourceSet); const items = input && array(input.citations);
        if (!input || !projection || !items || items.length !== projection.sources.length) return denied();
        const citations: Citation[] = [];
        for (let index = 0; index < items.length; index += 1) { const source = projection.sources[index]; const item = source && citation(items[index], `S${index + 1}`, source.sourceText); if (!item) return denied(); citations[index] = item; }
        return sealed({ status: 'available' as const, code: null, schemaVersion: DOCUMENT_SYNTHESIS_PROVIDER_CITATIONS_SCHEMA_VERSION, citations: ObjectFreeze(citations), ...COMMON }) as DocumentSynthesisProviderCitationsResult;
    } catch { return denied(); }
}
