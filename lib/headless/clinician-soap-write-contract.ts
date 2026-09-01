/* @Codex */
import { createHash } from 'node:crypto';
import { types } from 'node:util';

export const CLINICIAN_SOAP_DRAFT_SCHEMA = 'mediflow.soap-draft.v1';
export const CLINICIAN_SOAP_OPERATION_ID = 'mediflow.clinical_diary.append_soap.v1';
export const CLINICIAN_SOAP_DIGEST_CODEC = 'mediflow.headless.soap-draft-digest.v1';
export const CLINICIAN_SOAP_DRAFT_KEYS = Object.freeze([
    'schema', 'operationId', 'subjective', 'objective', 'assessment', 'plan',
] as const);
export type ClinicianSoapDraftV1 = Readonly<{
    schema: typeof CLINICIAN_SOAP_DRAFT_SCHEMA;
    operationId: typeof CLINICIAN_SOAP_OPERATION_ID;
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
}>;
export type ClinicianSoapWriteDenial = Readonly<{ status: 'denied'; code: 'invalid_input' | 'invalid_content' | 'content_limit' | 'empty_content' }>;
export type ClinicianSoapWriteAccepted = Readonly<{ status: 'accepted'; schema: typeof CLINICIAN_SOAP_DRAFT_SCHEMA; operationId: typeof CLINICIAN_SOAP_OPERATION_ID; subjective: string; objective: string; assessment: string; plan: string; digest: Readonly<{ codec: typeof CLINICIAN_SOAP_DIGEST_CODEC; sha256: Readonly<{ bytes: readonly number[]; hex: string }> }> }>;
export type ClinicianSoapWriteContract = ClinicianSoapWriteAccepted | ClinicianSoapWriteDenial;

const KEYS = CLINICIAN_SOAP_DRAFT_KEYS;
const SECTIONS = ['subjective', 'objective', 'assessment', 'plan'] as const;
const encoder = new TextEncoder(); const apply = Reflect.apply; const isProxy = types.isProxy;
const ownKeys = Reflect.ownKeys; const descriptorsOf = Object.getOwnPropertyDescriptors; const descriptorOf = Object.getOwnPropertyDescriptor; const prototypeOf = Object.getPrototypeOf;
const hasOwn = Object.hasOwn; const freeze = Object.freeze; const create = Object.create; const u8 = Uint8Array;
const charCodeAt = String.prototype.charCodeAt; const normalize = String.prototype.normalize; const trim = String.prototype.trim;
const encode = TextEncoder.prototype.encode; const newHash = createHash;
const hashPrototype = apply(prototypeOf, Object, [apply(newHash, undefined, ['sha256'])]) as { update: (value: Uint8Array) => unknown; digest: () => Uint8Array };
const hashUpdate = hashPrototype.update; const hashDigest = hashPrototype.digest; const HEX = '0123456789abcdef';
const byteLengthDescriptor = apply(descriptorOf, Object, [apply(prototypeOf, Object, [u8.prototype]), 'byteLength']);
if (!byteLengthDescriptor || typeof byteLengthDescriptor.get !== 'function') throw new TypeError('TypedArray byteLength getter unavailable');
const byteLength = byteLengthDescriptor.get;
const MAX_SECTION_BYTES = 16_384; const MAX_TOTAL_BYTES = 49_152;
type Input = Record<(typeof KEYS)[number], string>; type Section = (typeof SECTIONS)[number];

function record<T extends object>(value: T): Readonly<T> {
    const output = create(null) as Record<PropertyKey, unknown>; const keys = apply(ownKeys, Reflect, [value]);
    for (let index = 0; index < keys.length; index += 1) { const key = keys[index]!; output[key] = (value as Record<PropertyKey, unknown>)[key]; }
    return apply(freeze, Object, [output]) as Readonly<T>;
}
function deny(code: ClinicianSoapWriteDenial['code']): ClinicianSoapWriteDenial { return record({ status: 'denied' as const, code }); }
function input(value: unknown): Input | null {
    try {
        if (value === null || typeof value !== 'object' || apply(isProxy, types, [value]) || apply(prototypeOf, Object, [value]) !== null) return null;
        const actual = apply(ownKeys, Reflect, [value]); if (actual.length !== KEYS.length) return null;
        for (let index = 0; index < KEYS.length; index += 1) if (actual[index] !== KEYS[index]) return null;
        const descriptors = apply(descriptorsOf, Object, [value]); const copy = create(null) as Input;
        for (let index = 0; index < KEYS.length; index += 1) { const key = KEYS[index]!; const descriptor = descriptors[key]; if (!descriptor || !apply(hasOwn, Object, [descriptor, 'value']) || descriptor.enumerable !== true || typeof descriptor.value !== 'string') return null; copy[key] = descriptor.value; }
        return copy;
    } catch { return null; }
}
function normalized(value: string): string | null {
    let lines = '';
    for (let index = 0; index < value.length; index += 1) { const code = apply(charCodeAt, value, [index]); if (code === 13) { lines += '\n'; if (apply(charCodeAt, value, [index + 1]) === 10) index += 1; } else lines += value[index]!; }
    for (let index = 0; index < lines.length; index += 1) { const code = apply(charCodeAt, lines, [index]); if (code >= 0xd800 && code <= 0xdbff) { const next = apply(charCodeAt, lines, [index + 1]); if (!(next >= 0xdc00 && next <= 0xdfff)) return null; index += 1; continue; } if ((code >= 0xdc00 && code <= 0xdfff) || (code < 0x20 && code !== 9 && code !== 10)) return null; }
    return apply(normalize, lines, ['NFC']);
}
function bytes(value: string): Uint8Array { return apply(encode, encoder, [value]) as Uint8Array; }
function u32(value: number): Uint8Array { const output = new u8(4); output[0] = value >>> 24; output[1] = value >>> 16; output[2] = value >>> 8; output[3] = value; return output; }
function digest(fields: readonly string[]): Readonly<{ bytes: readonly number[]; hex: string }> {
    const hash = apply(newHash, undefined, ['sha256']) as typeof hashPrototype; for (let index = 0; index < fields.length; index += 1) { const field = bytes(fields[index]!); apply(hashUpdate, hash, [u32(apply(byteLength, field, []) as number)]); apply(hashUpdate, hash, [field]); }
    const source = apply(hashDigest, hash, []) as Uint8Array; const raw: number[] = []; let hex = '';
    for (let index = 0; index < (apply(byteLength, source, []) as number); index += 1) { const value = source[index]!; raw[index] = value; hex += HEX[value >>> 4]! + HEX[value & 15]!; }
    return record({ bytes: apply(freeze, Object, [raw]) as readonly number[], hex });
}

/** Validates one authority-free SOAP draft. This function does not perform a clinical write. */
export function validateClinicianSoapWriteDraft(value: unknown): ClinicianSoapWriteContract {
    try {
        const raw = input(value); if (!raw || raw.schema !== CLINICIAN_SOAP_DRAFT_SCHEMA || raw.operationId !== CLINICIAN_SOAP_OPERATION_ID) return deny('invalid_input');
        const sections = create(null) as Record<Section, string>; let total = 0; let meaningful = false;
        for (let index = 0; index < SECTIONS.length; index += 1) { const section = SECTIONS[index]!; const sectionValue = normalized(raw[section]); if (sectionValue === null) return deny('invalid_content'); const size = apply(byteLength, bytes(sectionValue), []) as number; if (size > MAX_SECTION_BYTES) return deny('content_limit'); total += size; if (apply(trim, sectionValue, []).length > 0) meaningful = true; sections[section] = sectionValue; }
        if (total > MAX_TOTAL_BYTES) return deny('content_limit'); if (!meaningful) return deny('empty_content');
        return record({ status: 'accepted' as const, schema: CLINICIAN_SOAP_DRAFT_SCHEMA as typeof CLINICIAN_SOAP_DRAFT_SCHEMA, operationId: CLINICIAN_SOAP_OPERATION_ID as typeof CLINICIAN_SOAP_OPERATION_ID, subjective: sections.subjective, objective: sections.objective, assessment: sections.assessment, plan: sections.plan, digest: record({ codec: CLINICIAN_SOAP_DIGEST_CODEC as typeof CLINICIAN_SOAP_DIGEST_CODEC, sha256: digest([CLINICIAN_SOAP_DRAFT_SCHEMA, CLINICIAN_SOAP_OPERATION_ID, sections.subjective, sections.objective, sections.assessment, sections.plan]) }) });
    } catch { return deny('invalid_input'); }
}
