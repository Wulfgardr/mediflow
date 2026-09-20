import 'server-only';

/* @Codex */
import { types } from 'node:util';
import { scanJsonObject } from '../../ai-json-lexical';

const MAX_CONTENT_CHARS = 262_144;
const OBJECT = Object.prototype;
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
const WeakMapGet = WeakMap.prototype.get;
const WeakMapSet = WeakMap.prototype.set;
const SCHEMA_VERSION = 'mediflow.document-synthesis.provider-envelope.v2' as const;
const ROOT_KEYS = ObjectFreeze(['schemaVersion', 'output', 'citations', 'claims'] as const);
const privateSnapshots = new WeakMap<object, DocumentSynthesisProviderEnvelopeSnapshot>();

type Root = Readonly<{ schemaVersion: typeof SCHEMA_VERSION; output: unknown; citations: unknown; claims: unknown }>;
export type DocumentSynthesisProviderEnvelopeSnapshot = Root;
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


function rootFrom(text: string): Root | null {
    if (text.length > MAX_CONTENT_CHARS || scanJsonObject(text) === null) return null;
    try {
        const value: unknown = JSONParse(text);
        if (!value || typeof value !== 'object' || ArrayIsArray(value) || ObjectGetPrototypeOf(value) !== OBJECT) return null;
        const keys = ReflectOwnKeys(value);
        if (keys.length !== 4) return null;
        const root = ObjectCreate(null) as Record<string, unknown>;
        for (let index = 0; index < ROOT_KEYS.length; index += 1) {
            const key = ROOT_KEYS[index]!;
            const descriptor = ObjectGetOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !ObjectHasOwn(descriptor, 'value')) return null;
            root[key] = descriptor.value;
        }
        for (let index = 0; index < keys.length; index += 1) if (typeof keys[index] !== 'string' || (keys[index] !== 'schemaVersion' && keys[index] !== 'output' && keys[index] !== 'citations' && keys[index] !== 'claims')) return null;
        if (root.schemaVersion !== SCHEMA_VERSION) return null;
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
        const isolated = sealed({ schemaVersion: root.schemaVersion, output: snapshot(root.output), citations: snapshot(root.citations), claims: snapshot(root.claims) }) as DocumentSynthesisProviderEnvelopeSnapshot;
        const token = ObjectFreeze(ObjectCreate(null)); ReflectApply(WeakMapSet, privateSnapshots, [token, isolated]);
        return sealed({ status: 'available' as const, code: null, token, reviewOnly: true as const, writesPerformed: 0 as const, applyPolicy: 'none' as const }) as DocumentSynthesisProviderEnvelopeResult;
    } catch { return denied(); }
}

/** C3d2b handoff: only a same-module opaque token resolves to the inert parsed snapshot. */
export function resolveDocumentSynthesisProviderEnvelope(token: unknown): DocumentSynthesisProviderEnvelopeSnapshot | null {
    try { return IsProxy(token) || !token || typeof token !== 'object' ? null : (ReflectApply(WeakMapGet, privateSnapshots, [token]) as DocumentSynthesisProviderEnvelopeSnapshot | undefined) ?? null; } catch { return null; }
}
