/* @Codex */
import { createHash } from 'node:crypto';
import { types } from 'node:util';

export const CLINICIAN_SOAP_DRAFT_SCHEMA = 'mediflow.soap-draft.v1';
export const CLINICIAN_SOAP_OPERATION_ID = 'mediflow.clinical_diary.append_soap.v1';
export const CLINICIAN_SOAP_DIGEST_CODEC = 'mediflow.headless.soap-draft-digest.v1';

export type ClinicianSoapWriteDenial = Readonly<{ status: 'denied'; code: 'invalid_input' | 'invalid_content' | 'content_limit' | 'empty_content' }>;
export type ClinicianSoapWriteAccepted = Readonly<{
    status: 'accepted'; schema: typeof CLINICIAN_SOAP_DRAFT_SCHEMA; operationId: typeof CLINICIAN_SOAP_OPERATION_ID;
    subjective: string; objective: string; assessment: string; plan: string;
    digest: Readonly<{ codec: typeof CLINICIAN_SOAP_DIGEST_CODEC; sha256: Readonly<{ bytes: readonly number[]; hex: string }> }>;
}>;
export type ClinicianSoapWriteContract = ClinicianSoapWriteAccepted | ClinicianSoapWriteDenial;

const KEYS = ['schema', 'operationId', 'subjective', 'objective', 'assessment', 'plan'] as const;
const SECTIONS = ['subjective', 'objective', 'assessment', 'plan'] as const;
const MAX_SECTION_BYTES = 16_384;
const MAX_TOTAL_BYTES = 49_152;
const encoder = new TextEncoder();
const ownKeys = Reflect.ownKeys;
const descriptorsOf = Object.getOwnPropertyDescriptors;
const prototypeOf = Object.getPrototypeOf;
const freeze = Object.freeze;
const create = Object.create;

type Input = Record<(typeof KEYS)[number], string>;
type Section = (typeof SECTIONS)[number];

function record<T extends object>(value: T): Readonly<T> { return freeze(Object.assign(create(null) as T, value)); }
function deny(code: ClinicianSoapWriteDenial['code']): ClinicianSoapWriteDenial { return record({ status: 'denied' as const, code }); }

function input(value: unknown): Input | null {
    if (value === null || typeof value !== 'object' || types.isProxy(value)) return null;
    try {
        if (prototypeOf(value) !== null) return null;
        const keys = ownKeys(value);
        if (keys.length !== KEYS.length || keys.some((key, index) => key !== KEYS[index])) return null;
        const descriptors = descriptorsOf(value);
        const copy = create(null) as Input;
        for (const key of KEYS) {
            const descriptor = descriptors[key];
            if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true || typeof descriptor.value !== 'string') return null;
            copy[key] = descriptor.value;
        }
        return copy;
    } catch { return null; }
}

function normalized(value: string): string | null {
    const lineNormalized = value.replace(/\r\n?/gu, '\n');
    for (let index = 0; index < lineNormalized.length; index += 1) {
        const code = lineNormalized.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) { const next = lineNormalized.charCodeAt(index + 1); if (!(next >= 0xdc00 && next <= 0xdfff)) return null; index += 1; continue; }
        if ((code >= 0xdc00 && code <= 0xdfff) || (code < 0x20 && code !== 0x09 && code !== 0x0a)) return null;
    }
    return lineNormalized.normalize('NFC');
}

function u32(value: number): Uint8Array { return Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value); }
function digest(fields: readonly string[]): Readonly<{ bytes: readonly number[]; hex: string }> {
    const bytes = fields.map((field) => encoder.encode(field));
    const hash = createHash('sha256');
    for (const field of bytes) { hash.update(u32(field.byteLength)); hash.update(field); }
    const raw = Array.from(hash.digest());
    return record({ bytes: freeze(raw), hex: Buffer.from(raw).toString('hex') });
}

/** Validates one authority-free SOAP draft. This function does not perform a clinical write. */
export function validateClinicianSoapWriteDraft(value: unknown): ClinicianSoapWriteContract {
    const raw = input(value);
    if (!raw || raw.schema !== CLINICIAN_SOAP_DRAFT_SCHEMA || raw.operationId !== CLINICIAN_SOAP_OPERATION_ID) return deny('invalid_input');
    const sections = create(null) as Record<Section, string>;
    let total = 0; let meaningful = false;
    for (const section of SECTIONS) {
        const value = normalized(raw[section]);
        if (value === null) return deny('invalid_content');
        const size = encoder.encode(value).byteLength;
        if (size > MAX_SECTION_BYTES) return deny('content_limit');
        total += size; if (/[^\s]/u.test(value)) meaningful = true;
        sections[section] = value;
    }
    if (total > MAX_TOTAL_BYTES) return deny('content_limit');
    if (!meaningful) return deny('empty_content');
    return record({
        status: 'accepted' as const, schema: CLINICIAN_SOAP_DRAFT_SCHEMA as typeof CLINICIAN_SOAP_DRAFT_SCHEMA, operationId: CLINICIAN_SOAP_OPERATION_ID as typeof CLINICIAN_SOAP_OPERATION_ID,
        subjective: sections.subjective, objective: sections.objective, assessment: sections.assessment, plan: sections.plan,
        digest: record({ codec: CLINICIAN_SOAP_DIGEST_CODEC as typeof CLINICIAN_SOAP_DIGEST_CODEC, sha256: digest([CLINICIAN_SOAP_DRAFT_SCHEMA, CLINICIAN_SOAP_OPERATION_ID, sections.subjective, sections.objective, sections.assessment, sections.plan]) }),
    });
}
