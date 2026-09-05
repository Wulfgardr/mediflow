/* @Codex */
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import {
    CLINICIAN_SOAP_DIGEST_CODEC, validateClinicianSoapWriteDraft, type ClinicianSoapWriteAccepted,
} from './clinician-soap-write-contract';

export const CLINICIAN_SOAP_ENTRY_FIELD_SET_SCHEMA = 'mediflow.headless.soap-entry-field-set.v1';
export const CLINICIAN_SOAP_ENTRY_PAYLOAD_DIGEST_CODEC = 'mediflow.headless.soap-entry-payload-digest.v1';
export const CLINICIAN_SOAP_ENTRY_ATTACHMENTS_ABSENT_SENTINEL = 'mediflow.headless.attachments.absent.v1';
export const CLINICIAN_SOAP_ENTRY_TYPE = 'visit';
export const CLINICIAN_SOAP_ENTRY_TITLE = 'Voce clinica';
export const CLINICIAN_SOAP_ENTRY_SETTING = 'ambulatory';

export type ClinicianSoapEntryMetadataV1 = Readonly<{
    codec: typeof CLINICIAN_SOAP_DIGEST_CODEC;
    sha256: Readonly<{ bytes: readonly number[]; hex: string }>;
}>;
export type ClinicianSoapEntryPayloadDigestV1 = Readonly<{
    codec: typeof CLINICIAN_SOAP_ENTRY_PAYLOAD_DIGEST_CODEC;
    sha256: Readonly<{ bytes: readonly number[]; hex: string }>;
}>;
export type ClinicianSoapEntryFieldSetV1 = Readonly<{
    schema: typeof CLINICIAN_SOAP_ENTRY_FIELD_SET_SCHEMA;
    type: typeof CLINICIAN_SOAP_ENTRY_TYPE;
    title: typeof CLINICIAN_SOAP_ENTRY_TITLE;
    date: string;
    content: string;
    setting: typeof CLINICIAN_SOAP_ENTRY_SETTING;
    metadata: ClinicianSoapEntryMetadataV1;
    payloadDigest: ClinicianSoapEntryPayloadDigestV1;
}>;

const objectCreate = Object.create, objectFreeze = Object.freeze, objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors, objectIsFrozen = Object.isFrozen;
const ownKeys = Reflect.ownKeys, apply = Reflect.apply, arrayIsArray = Array.isArray, arrayPrototype = Array.prototype;
const isProxy = types.isProxy, numberIsSafeInteger = Number.isSafeInteger, numberToString = Number.prototype.toString;
const dateToISOString = Date.prototype.toISOString, DateConstructor = Date, encoder = new TextEncoder(), encode = TextEncoder.prototype.encode;
const Uint8ArrayConstructor = Uint8Array, newHash = createHash;
const hashPrototype = apply(objectGetPrototypeOf, Object, [apply(newHash, undefined, ['sha256'])]) as {
    update(value: Uint8Array): unknown; digest(): Uint8Array;
};
const hashUpdate = hashPrototype.update, hashDigest = hashPrototype.digest;
const expectedSnapshotKeys = ['status', 'schema', 'operationId', 'subjective', 'objective', 'assessment', 'plan', 'digest'] as const;
const expectedDigestKeys = ['codec', 'sha256'] as const, expectedShaKeys = ['bytes', 'hex'] as const;
const datePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/u, HEX = '0123456789abcdef';

function record<T extends object>(value: T): Readonly<T> {
    const output = objectCreate(null) as Record<PropertyKey, unknown>, keys = ownKeys(value);
    for (let index = 0; index < keys.length; index += 1) { const key = keys[index]!;
        output[key] = (value as Record<PropertyKey, unknown>)[key]; }
    return objectFreeze(output) as Readonly<T>;
}
function exactData(value: unknown, keys: readonly PropertyKey[]): Record<PropertyKey, unknown> | null {
    if (typeof value !== 'object' || value === null || isProxy(value) || objectGetPrototypeOf(value) !== null || !objectIsFrozen(value)) return null;
    const actual = ownKeys(value); if (actual.length !== keys.length) return null;
    const descriptors = objectGetOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>;
    const output = objectCreate(null) as Record<PropertyKey, unknown>;
    for (let index = 0; index < keys.length; index += 1) { const key = keys[index]!; if (actual[index] !== key) return null;
        const descriptor = descriptors[key]; if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return null;
        output[key] = descriptor.value; }
    return output;
}
function exactDigestBytes(value: unknown, expected: readonly number[]): boolean {
    if (!arrayIsArray(value) || isProxy(value) || objectGetPrototypeOf(value) !== arrayPrototype || !objectIsFrozen(value)
        || value.length !== expected.length) return false;
    const keys = ownKeys(value), descriptors = objectGetOwnPropertyDescriptors(value);
    if (keys.length !== expected.length + 1 || keys[keys.length - 1] !== 'length') return false;
    for (let index = 0; index < expected.length; index += 1) { const descriptor = descriptors[index];
        if (keys[index] !== apply(numberToString, index, []) || !descriptor || !('value' in descriptor)
            || !descriptor.enumerable || descriptor.value !== expected[index]) return false; }
    return true;
}
function acceptedSnapshot(value: unknown): ClinicianSoapWriteAccepted | null {
    try {
        const candidate = exactData(value, expectedSnapshotKeys); if (!candidate || candidate.status !== 'accepted') return null;
        const digest = exactData(candidate.digest, expectedDigestKeys), sha256 = digest && exactData(digest.sha256, expectedShaKeys);
        if (!digest || !sha256 || typeof sha256.hex !== 'string') return null;
        const draft = objectCreate(null) as Record<string, string>;
        for (let index = 1; index < 7; index += 1) { const key = expectedSnapshotKeys[index]!;
            if (typeof candidate[key] !== 'string') return null; draft[key] = candidate[key] as string; }
        const checked = validateClinicianSoapWriteDraft(draft); if (checked.status !== 'accepted') return null;
        for (let index = 1; index < 7; index += 1) { const key = expectedSnapshotKeys[index]!;
            if (candidate[key] !== checked[key]) return null; }
        if (digest.codec !== checked.digest.codec || sha256.hex !== checked.digest.sha256.hex
            || !exactDigestBytes(sha256.bytes, checked.digest.sha256.bytes)) return null;
        return checked;
    } catch { return null; }
}
function digestCopy(source: ClinicianSoapWriteAccepted['digest']): ClinicianSoapEntryMetadataV1 {
    const bytes = objectFreeze([...source.sha256.bytes]); return record({
        codec: source.codec,
        sha256: record({ bytes, hex: source.sha256.hex }),
    });
}
function escapedSection(value: string): string {
    let output = '';
    for (let index = 0; index < value.length; index += 1) { const character = value[index]!;
        if (character === '&') output += '&amp;'; else if (character === '<') output += '&lt;'; else if (character === '>') output += '&gt;';
        else if (character === '"') output += '&quot;'; else if (character === "'") output += '&#39;'; else if (character === '\n') output += '<br>';
        else output += character; }
    return output;
}
function content(snapshot: ClinicianSoapWriteAccepted): string {
    const values = [snapshot.subjective, snapshot.objective, snapshot.assessment, snapshot.plan] as const;
    const labels = ['S', 'O', 'A', 'P'] as const; let output = '';
    for (let index = 0; index < labels.length; index += 1) { const value = values[index]!;
        output += value.length === 0 ? `<p>${labels[index]}:</p>` : `<p>${labels[index]}: ${escapedSection(value)}</p>`; }
    return output;
}
function canonicalMetadata(metadata: ClinicianSoapEntryMetadataV1): string {
    let bytes = '';
    for (let index = 0; index < metadata.sha256.bytes.length; index += 1) {
        if (index > 0) bytes += ','; bytes += apply(numberToString, metadata.sha256.bytes[index]!, []); }
    return `{"codec":"${metadata.codec}","sha256":{"bytes":[${bytes}],"hex":"${metadata.sha256.hex}"}}`;
}
function u32(value: number): Uint8Array { const output = new Uint8ArrayConstructor(4);
    output[0] = value >>> 24; output[1] = value >>> 16; output[2] = value >>> 8; output[3] = value; return output; }
function sha256(fields: readonly string[]): Readonly<{ bytes: readonly number[]; hex: string }> {
    const hash = apply(newHash, undefined, ['sha256']) as typeof hashPrototype;
    for (let index = 0; index < fields.length; index += 1) { const bytes = apply(encode, encoder, [fields[index]!]) as Uint8Array;
        apply(hashUpdate, hash, [u32(bytes.byteLength)]); apply(hashUpdate, hash, [bytes]); }
    const source = apply(hashDigest, hash, []) as Uint8Array, bytes: number[] = []; let hex = '';
    for (let index = 0; index < source.byteLength; index += 1) { const value = source[index]!; bytes[index] = value;
        hex += HEX[value >>> 4]! + HEX[value & 15]!; }
    return record({ bytes: objectFreeze(bytes), hex });
}

/** Builds one authority-free H4 field set; invalid or non-canonical inputs return null. */
export function createClinicianSoapEntryFieldSet(h1Snapshot: unknown, epochMilliseconds: unknown): ClinicianSoapEntryFieldSetV1 | null {
    try {
        const snapshot = acceptedSnapshot(h1Snapshot);
        if (!snapshot || !numberIsSafeInteger(epochMilliseconds) || (epochMilliseconds as number) < 0) return null;
        const truncated = (epochMilliseconds as number) - ((epochMilliseconds as number) % 1_000);
        const date = apply(dateToISOString, new DateConstructor(truncated), []) as string; if (!datePattern.test(date)) return null;
        const entryContent = content(snapshot), metadata = digestCopy(snapshot.digest), metadataJson = canonicalMetadata(metadata);
        const payloadDigest: ClinicianSoapEntryPayloadDigestV1 = record({
            codec: CLINICIAN_SOAP_ENTRY_PAYLOAD_DIGEST_CODEC,
            sha256: sha256([
                CLINICIAN_SOAP_ENTRY_PAYLOAD_DIGEST_CODEC, CLINICIAN_SOAP_ENTRY_FIELD_SET_SCHEMA,
                CLINICIAN_SOAP_DIGEST_CODEC, snapshot.digest.sha256.hex, CLINICIAN_SOAP_ENTRY_TYPE,
                CLINICIAN_SOAP_ENTRY_TITLE, date, entryContent, CLINICIAN_SOAP_ENTRY_SETTING,
                metadataJson, CLINICIAN_SOAP_ENTRY_ATTACHMENTS_ABSENT_SENTINEL,
            ]),
        });
        return record({
            schema: CLINICIAN_SOAP_ENTRY_FIELD_SET_SCHEMA, type: CLINICIAN_SOAP_ENTRY_TYPE,
            title: CLINICIAN_SOAP_ENTRY_TITLE, date, content: entryContent, setting: CLINICIAN_SOAP_ENTRY_SETTING,
            metadata, payloadDigest,
        });
    } catch { return null; }
}
