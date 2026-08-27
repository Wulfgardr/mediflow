/* @Codex */
import 'server-only';

import { types } from 'node:util';

declare const documentSynthesisAuthenticSourceSetTokenRef: unique symbol;

/** Opaque, process-local evidence identity; it deliberately exposes no data or consumer operation. */
export type DocumentSynthesisAuthenticSourceSetToken = Readonly<{ readonly [documentSynthesisAuthenticSourceSetTokenRef]: never }>;

type AuthenticSourceSetRecord = Readonly<{
    providerProjection: Readonly<{ label: 'S1'; sourceText: string }>;
    sourceSetDigestSha256: readonly number[];
}>;

const ARRAY_PROTOTYPE = Array.prototype;
const ObjectCreate = Object.create;
const ObjectFreeze = Object.freeze;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectIsFrozen = Object.isFrozen;
const ReflectOwnKeys = Reflect.ownKeys;
const ReflectApply = Reflect.apply;
const ArrayIsArray = Array.isArray;
const ArrayConstructor = Array;
const NumberIsSafeInteger = Number.isSafeInteger;
const StringConstructor = String;
const RegExpTest = Function.call.bind(RegExp.prototype.test) as (expression: RegExp, value: string) => boolean;
const ArrayIncludes = Function.call.bind(Array.prototype.includes) as (values: readonly string[], value: string) => boolean;
const IsProxy = types.isProxy;
const WeakMapConstructor = WeakMap;
const WeakSetConstructor = WeakSet;
const weakMapSet = WeakMap.prototype.set;
const weakSetHas = WeakSet.prototype.has;
const weakSetAdd = WeakSet.prototype.add;

const EVIDENCE_KEYS = ['providerProjection', 'sourceSetDigestSha256'] as const;
const PROJECTION_KEYS = ['label', 'sourceText'] as const;
const authenticSourceSets = new WeakMapConstructor<object, AuthenticSourceSetRecord>();
const burnedEvidence = new WeakSetConstructor<object>();
let active = false;
let reentryPoisoned = false;

function exactRecord(value: unknown, keys: readonly string[], prototype: object | null): Record<string, unknown> | null {
    try {
        if (typeof value !== 'object' || value === null || IsProxy(value) || ObjectGetPrototypeOf(value) !== prototype || !ObjectIsFrozen(value)) return null;
        const ownKeys = ReflectOwnKeys(value);
        if (ownKeys.length !== keys.length) return null;
        const output = ObjectCreate(null) as Record<string, unknown>;
        for (let index = 0; index < keys.length; index += 1) {
            const key = keys[index]!;
            const descriptor = ObjectGetOwnPropertyDescriptor(value, key);
            if (!descriptor || descriptor.enumerable !== true || descriptor.configurable !== false || descriptor.writable !== false || !('value' in descriptor)) return null;
            output[key] = descriptor.value;
        }
        for (let index = 0; index < ownKeys.length; index += 1) {
            const key = ownKeys[index]; if (typeof key !== 'string' || !ArrayIncludes(keys, key)) return null;
        }
        return output;
    } catch { return null; }
}

function copyEvidence(value: object): AuthenticSourceSetRecord | null {
    const input = exactRecord(value, EVIDENCE_KEYS, null);
    if (!input) return null;
    const projection = exactRecord(input.providerProjection, PROJECTION_KEYS, null);
    if (!projection || projection.label !== 'S1' || typeof projection.sourceText !== 'string') return null;
    const suppliedDigest = input.sourceSetDigestSha256;
    try {
        if (!ArrayIsArray(suppliedDigest) || IsProxy(suppliedDigest) || ObjectGetPrototypeOf(suppliedDigest) !== ARRAY_PROTOTYPE || !ObjectIsFrozen(suppliedDigest) || suppliedDigest.length !== 32) return null;
        const ownKeys = ReflectOwnKeys(suppliedDigest); if (ownKeys.length !== 33) return null;
        const copiedDigest = new ArrayConstructor(32) as number[];
        for (let index = 0; index < 32; index += 1) {
            const descriptor = ObjectGetOwnPropertyDescriptor(suppliedDigest, StringConstructor(index));
            if (!descriptor || descriptor.enumerable !== true || descriptor.configurable !== false || descriptor.writable !== false || !('value' in descriptor)
                || typeof descriptor.value !== 'number' || !NumberIsSafeInteger(descriptor.value) || descriptor.value < 0 || descriptor.value > 255) return null;
            copiedDigest[index] = descriptor.value;
        }
        const length = ObjectGetOwnPropertyDescriptor(suppliedDigest, 'length');
        if (!length || length.enumerable !== false || length.configurable !== false || length.writable !== false || length.value !== 32) return null;
        for (let index = 0; index < ownKeys.length; index += 1) {
            const key = ownKeys[index]; if (key !== 'length' && (typeof key !== 'string' || !RegExpTest(/^(?:[0-9]|[12][0-9]|3[01])$/u, key))) return null;
        }
        return ObjectFreeze(ObjectCreate(null, {
            providerProjection: { enumerable: true, value: ObjectFreeze(ObjectCreate(null, { label: { enumerable: true, value: 'S1' }, sourceText: { enumerable: true, value: projection.sourceText } })) },
            sourceSetDigestSha256: { enumerable: true, value: ObjectFreeze(copiedDigest) },
        })) as AuthenticSourceSetRecord;
    } catch { return null; }
}

/** A3a2-only deep sink: one exact sealed evidence identity becomes one opaque local token, or a generic denial. */
export function intakeDocumentSynthesisA3a2SealedEvidence(evidence: unknown): DocumentSynthesisAuthenticSourceSetToken | null {
    if (typeof evidence !== 'object' || evidence === null) return null;
    if (ReflectApply(weakSetHas, burnedEvidence, [evidence])) return null;
    ReflectApply(weakSetAdd, burnedEvidence, [evidence]);
    if (reentryPoisoned) return null;
    if (active) { reentryPoisoned = true; return null; }
    active = true;
    try {
        const record = copyEvidence(evidence);
        if (!record) { active = false; return null; }
        const token = ObjectFreeze(ObjectCreate(null)) as DocumentSynthesisAuthenticSourceSetToken;
        active = false;
        ReflectApply(weakMapSet, authenticSourceSets, [token, record]);
        return token;
    } catch { active = false; return null; }
}
