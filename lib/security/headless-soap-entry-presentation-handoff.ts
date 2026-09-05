/* @Codex */
import 'server-only';

import { Buffer } from 'node:buffer';
import { types } from 'node:util';

import {
    CLINICIAN_SOAP_ENTRY_FIELD_SET_SCHEMA,
    CLINICIAN_SOAP_ENTRY_PAYLOAD_DIGEST_CODEC,
    CLINICIAN_SOAP_ENTRY_SETTING,
    CLINICIAN_SOAP_ENTRY_TITLE,
    CLINICIAN_SOAP_ENTRY_TYPE,
    createClinicianSoapEntryFieldSet,
    type ClinicianSoapEntryFieldSetV1,
} from '../headless/clinician-soap-entry-field-set';
import {
    CLINICIAN_SOAP_DIGEST_CODEC,
    CLINICIAN_SOAP_DRAFT_SCHEMA,
    CLINICIAN_SOAP_OPERATION_ID,
    validateClinicianSoapWriteDraft,
} from '../headless/clinician-soap-write-contract';

export const HEADLESS_SOAP_ENTRY_PRESENTATION_SCHEMA = 'mediflow.headless.soap-entry-presentation.v1';

export type HeadlessSoapEntryPresentationHandoffV1 = Readonly<{
    schema: typeof HEADLESS_SOAP_ENTRY_PRESENTATION_SCHEMA;
    correlationToken: string;
    fieldSet: ClinicianSoapEntryFieldSetV1;
}>;

const FIELD_KEYS = ['schema', 'type', 'title', 'date', 'content', 'setting', 'metadata', 'payloadDigest'] as const;
const DIGEST_KEYS = ['codec', 'sha256'] as const, SHA_KEYS = ['bytes', 'hex'] as const;
const LABELS = ['S', 'O', 'A', 'P'] as const;
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const HEX = '0123456789abcdef';
const objectCreate = Object.create, objectFreeze = Object.freeze, objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetPrototypeOf = Object.getPrototypeOf, objectHasOwn = Object.hasOwn, objectIsFrozen = Object.isFrozen;
const ownKeys = Reflect.ownKeys, apply = Reflect.apply, arrayIsArray = Array.isArray;
const arrayPrototype = Array.prototype, uint8ArrayPrototype = Uint8Array.prototype, Uint8ArrayConstructor = Uint8Array;
const isProxy = types.isProxy, bufferIsBuffer = Buffer.isBuffer, numberIsInteger = Number.isInteger;
const dateParse = Date.parse, stringStartsWith = String.prototype.startsWith;
const stringIndexOf = String.prototype.indexOf, stringSlice = String.prototype.slice;
const typedArrayPrototype = apply(objectGetPrototypeOf, Object, [uint8ArrayPrototype]) as object;
const byteLengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')?.get;

type CanonicalHash = Readonly<{ bytes: readonly number[]; hex: string }>;
type CanonicalDigest = Readonly<{ codec: string; sha256: CanonicalHash }>;

function record<T extends object>(source: T): Readonly<T> {
    const output = objectCreate(null) as Record<PropertyKey, unknown>, keys = ownKeys(source);
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index]!; output[key] = (source as Record<PropertyKey, unknown>)[key];
    }
    return objectFreeze(output) as Readonly<T>;
}

function exactData(value: unknown, expectedKeys: readonly PropertyKey[]): Record<PropertyKey, unknown> | null {
    if (typeof value !== 'object' || value === null || apply(isProxy, types, [value])
        || apply(objectGetPrototypeOf, Object, [value]) !== null || !apply(objectIsFrozen, Object, [value])) return null;
    const keys = apply(ownKeys, Reflect, [value]) as PropertyKey[];
    if (keys.length !== expectedKeys.length) return null;
    const descriptors = apply(objectGetOwnPropertyDescriptors, Object, [value]) as Record<PropertyKey, PropertyDescriptor>;
    const output = objectCreate(null) as Record<PropertyKey, unknown>;
    for (let index = 0; index < expectedKeys.length; index += 1) {
        const key = expectedKeys[index]!, descriptor = descriptors[key];
        if (keys[index] !== key || !descriptor || !apply(objectHasOwn, Object, [descriptor, 'value'])
            || descriptor.enumerable !== true) return null;
        output[key] = descriptor.value;
    }
    return output;
}

function exactHash(value: unknown): CanonicalHash | null {
    const source = exactData(value, SHA_KEYS);
    if (!source || typeof source.hex !== 'string' || source.hex.length !== 64) return null;
    const input = source.bytes;
    if (!arrayIsArray(input) || apply(isProxy, types, [input]) || apply(objectGetPrototypeOf, Object, [input]) !== arrayPrototype
        || !apply(objectIsFrozen, Object, [input])) return null;
    const keys = apply(ownKeys, Reflect, [input]) as PropertyKey[];
    const descriptors = apply(objectGetOwnPropertyDescriptors, Object, [input]) as unknown as Record<PropertyKey, PropertyDescriptor>;
    if (keys.length !== 33 || keys[32] !== 'length') return null;
    const length = descriptors.length;
    if (!length || !apply(objectHasOwn, Object, [length, 'value']) || length.value !== 32 || length.enumerable) return null;
    const bytes: number[] = []; let hex = '';
    for (let index = 0; index < 32; index += 1) {
        const key = String(index), descriptor = descriptors[key];
        if (keys[index] !== key || !descriptor || !apply(objectHasOwn, Object, [descriptor, 'value'])
            || descriptor.enumerable !== true || !numberIsInteger(descriptor.value)
            || descriptor.value < 0 || descriptor.value > 255) return null;
        const byte = descriptor.value as number; bytes[index] = byte;
        hex += HEX[byte >>> 4]! + HEX[byte & 15]!;
    }
    return source.hex === hex ? record({ bytes: objectFreeze(bytes), hex }) : null;
}

function exactDigest(value: unknown, codec: string): CanonicalDigest | null {
    const source = exactData(value, DIGEST_KEYS), sha256 = source && exactHash(source.sha256);
    return source?.codec === codec && sha256 ? record({ codec, sha256 }) : null;
}

function decodeSection(value: string): string | null {
    let output = '';
    for (let index = 0; index < value.length;) {
        if (apply(stringStartsWith, value, ['&amp;', index])) { output += '&'; index += 5; continue; }
        if (apply(stringStartsWith, value, ['&lt;', index])) { output += '<'; index += 4; continue; }
        if (apply(stringStartsWith, value, ['&gt;', index])) { output += '>'; index += 4; continue; }
        if (apply(stringStartsWith, value, ['&quot;', index])) { output += '"'; index += 6; continue; }
        if (apply(stringStartsWith, value, ['&#39;', index])) { output += "'"; index += 5; continue; }
        if (apply(stringStartsWith, value, ['<br>', index])) { output += '\n'; index += 4; continue; }
        const character = value[index]!;
        if (character === '&' || character === '<' || character === '>' || character === '"'
            || character === "'" || character === '\n') return null;
        output += character; index += 1;
    }
    return output;
}

function sectionsFromContent(value: string): readonly [string, string, string, string] | null {
    const sections: string[] = []; let cursor = 0;
    for (let index = 0; index < LABELS.length; index += 1) {
        const prefix = `<p>${LABELS[index]}:`;
        if (!apply(stringStartsWith, value, [prefix, cursor])) return null;
        const start = cursor + prefix.length, end = apply(stringIndexOf, value, ['</p>', start]) as number;
        if (end < 0) return null;
        const body = apply(stringSlice, value, [start, end]) as string;
        if (body.length === 0) sections[index] = '';
        else {
            if (body[0] !== ' ') return null;
            const decoded = decodeSection(apply(stringSlice, body, [1]) as string); if (decoded === null) return null;
            sections[index] = decoded;
        }
        cursor = end + 4;
    }
    return cursor === value.length ? sections as [string, string, string, string] : null;
}

function sameHash(left: CanonicalHash, right: CanonicalHash): boolean {
    if (left.hex !== right.hex || left.bytes.length !== right.bytes.length) return false;
    let difference = 0;
    for (let index = 0; index < left.bytes.length; index += 1) difference |= left.bytes[index]! ^ right.bytes[index]!;
    return difference === 0;
}

function canonicalFieldSet(value: unknown): ClinicianSoapEntryFieldSetV1 | null {
    const source = exactData(value, FIELD_KEYS);
    if (!source || source.schema !== CLINICIAN_SOAP_ENTRY_FIELD_SET_SCHEMA || source.type !== CLINICIAN_SOAP_ENTRY_TYPE
        || source.title !== CLINICIAN_SOAP_ENTRY_TITLE || source.setting !== CLINICIAN_SOAP_ENTRY_SETTING
        || typeof source.date !== 'string' || typeof source.content !== 'string') return null;
    const metadata = exactDigest(source.metadata, CLINICIAN_SOAP_DIGEST_CODEC);
    const payloadDigest = exactDigest(source.payloadDigest, CLINICIAN_SOAP_ENTRY_PAYLOAD_DIGEST_CODEC);
    const sections = sectionsFromContent(source.content);
    if (!metadata || !payloadDigest || !sections) return null;
    const draft = objectCreate(null) as Record<string, string>;
    draft.schema = CLINICIAN_SOAP_DRAFT_SCHEMA; draft.operationId = CLINICIAN_SOAP_OPERATION_ID;
    draft.subjective = sections[0]; draft.objective = sections[1]; draft.assessment = sections[2]; draft.plan = sections[3];
    const accepted = validateClinicianSoapWriteDraft(draft);
    if (accepted.status !== 'accepted' || metadata.codec !== accepted.digest.codec
        || !sameHash(metadata.sha256, accepted.digest.sha256)) return null;
    const rebuilt = createClinicianSoapEntryFieldSet(accepted, apply(dateParse, Date, [source.date]));
    if (!rebuilt || rebuilt.date !== source.date || rebuilt.content !== source.content
        || !sameHash(payloadDigest.sha256, rebuilt.payloadDigest.sha256)) return null;
    return rebuilt;
}

function entropyCopy(value: unknown): Uint8Array | null {
    if (!byteLengthGetter || typeof value !== 'object' || value === null || apply(isProxy, types, [value])) return null;
    const prototype = apply(objectGetPrototypeOf, Object, [value]);
    if (prototype !== uint8ArrayPrototype && !apply(bufferIsBuffer, Buffer, [value])) return null;
    let length: unknown;
    try { length = apply(byteLengthGetter, value, []); } catch { return null; }
    if (length !== 32) return null;
    const output = new Uint8ArrayConstructor(32), source = value as Uint8Array;
    for (let index = 0; index < 32; index += 1) output[index] = source[index]!;
    return output;
}

function base64url(source: Uint8Array): string {
    let output = '';
    for (let index = 0; index < 30; index += 3) {
        const bits = (source[index]! << 16) | (source[index + 1]! << 8) | source[index + 2]!;
        output += BASE64URL[(bits >>> 18) & 63]! + BASE64URL[(bits >>> 12) & 63]!
            + BASE64URL[(bits >>> 6) & 63]! + BASE64URL[bits & 63]!;
    }
    const tail = (source[30]! << 16) | (source[31]! << 8);
    return output + BASE64URL[(tail >>> 18) & 63]! + BASE64URL[(tail >>> 12) & 63]! + BASE64URL[(tail >>> 6) & 63]!;
}

/** Creates an authority-free H5a presentation handoff; invalid inputs return null. */
export function createHeadlessSoapEntryPresentationHandoff(
    fieldSet: unknown,
    entropy: unknown,
): HeadlessSoapEntryPresentationHandoffV1 | null {
    try {
        const bytes = entropyCopy(entropy); if (!bytes) return null;
        const copy = canonicalFieldSet(fieldSet); if (!copy) return null;
        return record({ schema: HEADLESS_SOAP_ENTRY_PRESENTATION_SCHEMA, correlationToken: base64url(bytes), fieldSet: copy });
    } catch { return null; }
}
