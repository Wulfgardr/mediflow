import 'server-only';

/* @Codex */
import { types } from 'node:util';

const MAX_CONTENT_CHARS = 262_144;
const MAX_DEPTH = 64;
const MAX_NODES = 16_384;
const OBJECT = Object.prototype;
const ARRAY = Array.prototype;
const ObjectCreate = Object.create;
const ObjectDefineProperty = Object.defineProperty;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectHasOwn = Object.hasOwn;
const ObjectSetPrototypeOf = Object.setPrototypeOf;
const ReflectApply = Reflect.apply;
const ReflectOwnKeys = Reflect.ownKeys;
const ArrayIsArray = Array.isArray;
const IsProxy = types.isProxy;
const JSONParse = JSON.parse;
const StringSlice = String.prototype.slice;
const SetConstructor = Set;
const SetAdd = Set.prototype.add;
const SetHas = Set.prototype.has;
const privateSnapshots = new WeakMap<object, DocumentSynthesisProviderEnvelopeSnapshot>();

type Root = Readonly<{ output: unknown; citations: unknown; claims: unknown }>;
export type DocumentSynthesisProviderEnvelopeSnapshot = Readonly<{ output: unknown; citations: unknown; claims: unknown }>;
export type DocumentSynthesisProviderEnvelopeResult =
    | Readonly<{ status: 'available'; code: null; token: object; reviewOnly: true; writesPerformed: 0; applyPolicy: 'none' }>
    | Readonly<{ status: 'denied'; code: 'response_invalid'; token: null; reviewOnly: true; writesPerformed: 0; applyPolicy: 'none' }>;

function sealed<T extends Record<string, unknown>>(value: T): Readonly<T> {
    const result = ObjectCreate(null) as T;
    const keys = ReflectOwnKeys(value);
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        if (typeof key === 'string') (result as Record<string, unknown>)[key] = (value as Record<string, unknown>)[key];
    }
    return ObjectFreeze(result);
}

function contentFrom(value: unknown): string | null {
    try {
        if (IsProxy(value) || !value || typeof value !== 'object' || ArrayIsArray(value) || ObjectGetPrototypeOf(value) !== OBJECT) return null;
        const keys = ReflectOwnKeys(value);
        if (keys.length !== 1 || keys[0] !== 'content') return null;
        const descriptor = ObjectGetOwnPropertyDescriptor(value, 'content');
        return descriptor && descriptor.enumerable && ObjectHasOwn(descriptor, 'value') && typeof descriptor.value === 'string' ? descriptor.value : null;
    } catch { return null; }
}

function scanOneObject(text: string): boolean {
    let cursor = 0; let nodes = 0;
    const white = () => { while (cursor < text.length && (text[cursor] === ' ' || text[cursor] === '\n' || text[cursor] === '\r' || text[cursor] === '\t')) cursor += 1; };
    const string = (): string | null => {
        if (text[cursor] !== '"') return null;
        const start = cursor; cursor += 1; let escaped = false;
        while (cursor < text.length) { const character = text[cursor]!; cursor += 1; if (escaped) { escaped = false; continue; } if (character === '\\') { escaped = true; continue; } if (character === '"') break; }
        if (text[cursor - 1] !== '"') return null;
        try { const value = JSONParse(ReflectApply(StringSlice, text, [start, cursor]) as string); return typeof value === 'string' ? value : null; } catch { return null; }
    };
    const primitive = (): boolean => {
        const start = cursor;
        while (cursor < text.length && text[cursor] !== ',' && text[cursor] !== ']' && text[cursor] !== '}' && text[cursor] !== ' ' && text[cursor] !== '\n' && text[cursor] !== '\r' && text[cursor] !== '\t') cursor += 1;
        if (start === cursor) return false;
        try { const value = JSONParse(ReflectApply(StringSlice, text, [start, cursor]) as string); return value === null || (typeof value !== 'object' && typeof value !== 'function'); } catch { return false; }
    };
    const value = (depth: number): boolean => {
        if (depth > MAX_DEPTH || (nodes += 1) > MAX_NODES) return false;
        white(); const character = text[cursor];
        if (character === '"') return string() !== null;
        if (character === '{') {
            cursor += 1; white(); const keys = new SetConstructor<string>();
            if (text[cursor] === '}') { cursor += 1; return true; }
            while (true) {
                const key = string(); if (key === null || ReflectApply(SetHas, keys, [key]) as boolean) return false;
                ReflectApply(SetAdd, keys, [key]); white(); if (text[cursor] !== ':') return false; cursor += 1;
                if (!value(depth + 1)) return false; white();
                if (text[cursor] === '}') { cursor += 1; return true; }
                if (text[cursor] !== ',') return false; cursor += 1; white();
            }
        }
        if (character === '[') {
            cursor += 1; white(); if (text[cursor] === ']') { cursor += 1; return true; }
            while (true) { if (!value(depth + 1)) return false; white(); if (text[cursor] === ']') { cursor += 1; return true; } if (text[cursor] !== ',') return false; cursor += 1; white(); }
        }
        return primitive();
    };
    white(); if (!value(0)) return false; white(); return cursor === text.length && text[0] !== '[';
}

function rootFrom(text: string): Root | null {
    if (text.length > MAX_CONTENT_CHARS || !scanOneObject(text)) return null;
    try {
        const value: unknown = JSONParse(text);
        if (!value || typeof value !== 'object' || ArrayIsArray(value) || ObjectGetPrototypeOf(value) !== OBJECT) return null;
        const keys = ReflectOwnKeys(value);
        if (keys.length !== 3) return null;
        const root = ObjectCreate(null) as Record<string, unknown>;
        for (const key of ['output', 'citations', 'claims'] as const) {
            const descriptor = ObjectGetOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !ObjectHasOwn(descriptor, 'value')) return null;
            root[key] = descriptor.value;
        }
        for (let index = 0; index < keys.length; index += 1) if (typeof keys[index] !== 'string' || (keys[index] !== 'output' && keys[index] !== 'citations' && keys[index] !== 'claims')) return null;
        return root as Root;
    } catch { return null; }
}

function snapshot(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value;
    if (ArrayIsArray(value)) {
        const result: unknown[] = [];
        for (let index = 0; index < value.length; index += 1) result[index] = snapshot(value[index]);
        ObjectSetPrototypeOf(result, null); ObjectDefineProperty(result, 'toJSON', { value: null, enumerable: false, configurable: false, writable: false });
        return ObjectFreeze(result);
    }
    const result = ObjectCreate(null) as Record<string, unknown>;
    const keys = ReflectOwnKeys(value);
    for (let index = 0; index < keys.length; index += 1) { const key = keys[index]; if (typeof key === 'string') result[key] = snapshot((ObjectGetOwnPropertyDescriptor(value, key) as PropertyDescriptor).value); }
    return ObjectFreeze(result);
}

function denied(): DocumentSynthesisProviderEnvelopeResult { return sealed({ status: 'denied' as const, code: 'response_invalid' as const, token: null, reviewOnly: true as const, writesPerformed: 0 as const, applyPolicy: 'none' as const }) as DocumentSynthesisProviderEnvelopeResult; }

/** C3d2a only: frames one raw provider object without interpreting output, citation, or claim semantics. */
export function parseDocumentSynthesisProviderEnvelope(value: unknown): DocumentSynthesisProviderEnvelopeResult {
    const content = contentFrom(value); const root = content === null ? null : rootFrom(content);
    if (!root) return denied();
    try {
        const isolated = sealed({ output: snapshot(root.output), citations: snapshot(root.citations), claims: snapshot(root.claims) }) as DocumentSynthesisProviderEnvelopeSnapshot;
        const token = ObjectFreeze(ObjectCreate(null)); privateSnapshots.set(token, isolated);
        return sealed({ status: 'available' as const, code: null, token, reviewOnly: true as const, writesPerformed: 0 as const, applyPolicy: 'none' as const }) as DocumentSynthesisProviderEnvelopeResult;
    } catch { return denied(); }
}

/** C3d2b handoff: only a same-module opaque token resolves to the inert parsed snapshot. */
export function resolveDocumentSynthesisProviderEnvelope(token: unknown): DocumentSynthesisProviderEnvelopeSnapshot | null {
    try { return IsProxy(token) || !token || typeof token !== 'object' ? null : privateSnapshots.get(token) ?? null; } catch { return null; }
}
