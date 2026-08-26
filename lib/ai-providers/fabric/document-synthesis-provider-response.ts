import 'server-only';

/* @Codex */
import { types } from 'node:util';

import {
    normalizeDocumentSynthesisOutput,
    type DocumentSynthesisOutput,
    type DocumentSynthesisOutputContractResult,
} from './document-synthesis-output-contract';

const MAX_CONTENT_CHARS = 262_144;
const OBJECT = Object.prototype;
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
const StringSlice = String.prototype.slice;
const StringTrim = String.prototype.trim;
const RegExpTest = RegExp.prototype.test;
const Whitespace = /\s/u;
const JSON_OBJECT = JSON;
const JSONParse = JSON.parse;
const SetConstructor = Set;
const SetAdd = Set.prototype.add;
const SetHas = Set.prototype.has;

function frozenRecord(entries: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
    const record = ObjectCreate(null) as Record<string, unknown>;
    const keys = ReflectOwnKeys(entries);
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        if (typeof key !== 'string') continue;
        const descriptor = ObjectGetOwnPropertyDescriptor(entries, key);
        if (descriptor && ObjectHasOwn(descriptor, 'value')) record[key] = descriptor.value;
    }
    return ObjectFreeze(record);
}

function contentFrom(value: unknown): string | null {
    try {
        if (IsProxy(value) || typeof value !== 'object' || value === null || ArrayIsArray(value) || ObjectGetPrototypeOf(value) !== OBJECT) return null;
        const keys = ReflectOwnKeys(value);
        if (keys.length !== 1 || keys[0] !== 'content') return null;
        const descriptor = ObjectGetOwnPropertyDescriptor(value, 'content');
        return descriptor && descriptor.enumerable && ObjectHasOwn(descriptor, 'value') && typeof descriptor.value === 'string' ? descriptor.value : null;
    } catch { return null; }
}

function duplicateJsonKeys(content: string): boolean {
    const containers: Array<{ object: boolean; keys: Set<string> }> = [];
    for (let index = 0; index < content.length; index += 1) {
        const character = content[index];
        if (character === '"') {
            const start = index; let escaped = false;
            for (index += 1; index < content.length; index += 1) {
                const current = content[index];
                if (escaped) { escaped = false; continue; }
                if (current === '\\') { escaped = true; continue; }
                if (current === '"') break;
            }
            if (index >= content.length) return true;
            let next = index + 1; while (ReflectApply(RegExpTest, Whitespace, [content[next] ?? '']) as boolean) next += 1;
            if (content[next] !== ':') continue;
            const container = containers.length === 0 ? undefined : containers[containers.length - 1];
            if (!container?.object) return true;
            let key: string;
            try { key = ReflectApply(JSONParse, JSON_OBJECT, [ReflectApply(StringSlice, content, [start, index + 1])]) as string; } catch { return true; }
            if (ReflectApply(SetHas, container.keys, [key]) as boolean) return true;
            ReflectApply(SetAdd, container.keys, [key]);
        } else if (character === '{') {
            containers[containers.length] = { object: true, keys: new SetConstructor<string>() };
        } else if (character === '[') {
            containers[containers.length] = { object: false, keys: new SetConstructor<string>() };
        } else if (character === '}' || character === ']') {
            if (containers.length === 0) return true;
            containers.length -= 1;
        }
    }
    return false;
}

function parseOneJsonObject(content: string): unknown | null {
    if (content.length > MAX_CONTENT_CHARS) return null;
    const trimmed = ReflectApply(StringTrim, content, []) as string;
    if (!trimmed || trimmed.length > MAX_CONTENT_CHARS || duplicateJsonKeys(trimmed)) return null;
    try {
        const parsed: unknown = ReflectApply(JSONParse, JSON_OBJECT, [trimmed]);
        return parsed && typeof parsed === 'object' && !ArrayIsArray(parsed) ? parsed : null;
    } catch { return null; }
}

function isolate(value: unknown): unknown {
    if (ArrayIsArray(value)) {
        const output: unknown[] = [];
        for (let index = 0; index < value.length; index += 1) output[index] = isolate(value[index]);
        ObjectDefineProperty(output, 'toJSON', { value: null, enumerable: false, configurable: false, writable: false });
        return ObjectFreeze(output);
    }
    if (value && typeof value === 'object') {
        const copy = ObjectCreate(null) as Record<string, unknown>;
        const keys = ReflectOwnKeys(value);
        for (let index = 0; index < keys.length; index += 1) {
            const key = keys[index];
            if (typeof key !== 'string') continue;
            const descriptor = ObjectGetOwnPropertyDescriptor(value, key);
            if (descriptor && ObjectHasOwn(descriptor, 'value')) copy[key] = isolate(descriptor.value);
        }
        return ObjectFreeze(copy);
    }
    return value;
}

function seal(result: DocumentSynthesisOutputContractResult): DocumentSynthesisOutputContractResult {
    if (result.status === 'denied') return frozenRecord({ status: 'denied', code: result.code, value: null, reviewOnly: result.reviewOnly, writesPerformed: result.writesPerformed, applyPolicy: result.applyPolicy }) as DocumentSynthesisOutputContractResult;
    return frozenRecord({ status: 'available', code: null, value: isolate(result.value) as DocumentSynthesisOutput, reviewOnly: result.reviewOnly, writesPerformed: result.writesPerformed, applyPolicy: result.applyPolicy }) as DocumentSynthesisOutputContractResult;
}

/** Pure C3b0 boundary: exact provider content framing followed by canonical output normalization. */
export function normalizeDocumentSynthesisProviderResponse(value: unknown): DocumentSynthesisOutputContractResult {
    const content = contentFrom(value);
    const parsed = content === null ? null : parseOneJsonObject(content);
    return seal(parsed === null ? normalizeDocumentSynthesisOutput(null) : normalizeDocumentSynthesisOutput(parsed));
}
