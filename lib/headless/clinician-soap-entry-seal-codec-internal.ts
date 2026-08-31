/* @Codex */
import type {
    ClinicianSoapEntryFieldSetV1,
    ClinicianSoapEntryMetadataV1,
    ClinicianSoapEntryPayloadDigestV1,
} from './clinician-soap-entry-field-set';

export const FIELD_SET_SCHEMA = 'mediflow.headless.soap-entry-field-set.v1';
export const PAYLOAD_DIGEST_CODEC = 'mediflow.headless.soap-entry-payload-digest.v1';
export const H1_DIGEST_CODEC = 'mediflow.headless.soap-draft-digest.v1';
export const ATTACHMENTS_ABSENT = 'mediflow.headless.attachments.absent.v1';
export const ENTRY_TYPE = 'visit';
export const ENTRY_TITLE = 'Voce clinica';
export const ENTRY_SETTING = 'ambulatory';
export const SEAL_SCHEMA = 'mediflow.headless.soap-entry-seal.v1';
export const SEAL_DIGEST_CODEC = 'mediflow.headless.soap-entry-seal-digest.v1';

const FIELD_KEYS = ['schema', 'type', 'title', 'date', 'content', 'setting', 'metadata', 'payloadDigest'] as const;
const SEAL_KEYS = ['schema', 'type', 'date', 'setting', 'title', 'content', 'metadata', 'payloadDigest', 'sealDigest'] as const;
const DIGEST_KEYS = ['codec', 'sha256'] as const, SHA_KEYS = ['bytes', 'hex'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/u, HEX = /^[0-9a-f]{64}$/u;
const encoder = new TextEncoder();

export type HashValue = Readonly<{ bytes: readonly number[]; hex: string }>;
export type ParsedFieldSet = Readonly<{ value: ClinicianSoapEntryFieldSetV1; metadataJSON: string }>;
export type ParsedSeal = Readonly<{
    schema: typeof SEAL_SCHEMA; type: typeof ENTRY_TYPE; date: string; setting: typeof ENTRY_SETTING;
    title: string; content: string; metadata: string; payloadDigest: ClinicianSoapEntryPayloadDigestV1;
    sealDigest: Readonly<{ codec: typeof SEAL_DIGEST_CODEC; sha256: HashValue }>;
}>;
export type EncryptedParts = Readonly<{
    iv: Uint8Array<ArrayBuffer>; ciphertextAndTag: Uint8Array<ArrayBuffer>;
}>;

export function record<T extends object>(source: T): Readonly<T> {
    const output = Object.create(null) as Record<PropertyKey, unknown>;
    for (const key of Reflect.ownKeys(source)) output[key] = (source as Record<PropertyKey, unknown>)[key];
    return Object.freeze(output) as Readonly<T>;
}

function exactRecord(value: unknown, expected: readonly PropertyKey[]): Record<PropertyKey, unknown> | null {
    if (typeof value !== 'object' || value === null) return null;
    const prototype = Object.getPrototypeOf(value), keys = Reflect.ownKeys(value);
    if ((prototype !== null && prototype !== Object.prototype) || keys.length !== expected.length) return null;
    const copy = Object.create(null) as Record<PropertyKey, unknown>;
    for (let index = 0; index < expected.length; index += 1) { const key = expected[index]!;
        if (keys[index] !== key) return null; const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return null; copy[key] = descriptor.value; }
    return copy;
}

function exactHash(value: unknown): HashValue | null {
    const source = exactRecord(value, SHA_KEYS); if (!source || typeof source.hex !== 'string' || !HEX.test(source.hex)
        || !Array.isArray(source.bytes) || source.bytes.length !== 32) return null;
    const keys = Reflect.ownKeys(source.bytes), descriptors = Object.getOwnPropertyDescriptors(source.bytes);
    if (keys.length !== 33 || keys[32] !== 'length') return null;
    const bytes: number[] = []; let hex = '';
    for (let index = 0; index < 32; index += 1) { const key = String(index), descriptor = descriptors[key];
        if (keys[index] !== key || !descriptor || !('value' in descriptor) || !descriptor.enumerable
            || !Number.isInteger(descriptor.value) || descriptor.value < 0 || descriptor.value > 255) return null;
        bytes.push(descriptor.value as number); hex += (descriptor.value as number).toString(16).padStart(2, '0'); }
    return hex === source.hex ? record({ bytes: Object.freeze(bytes), hex }) : null;
}

export function exactDigest(value: unknown, codec: string): Readonly<{ codec: string; sha256: HashValue }> | null {
    const source = exactRecord(value, DIGEST_KEYS), sha256 = source && exactHash(source.sha256);
    return source?.codec === codec && sha256 ? record({ codec, sha256 }) : null;
}

function escapeSection(value: string): string {
    let output = '';
    for (const character of value) { if (character === '&') output += '&amp;'; else if (character === '<') output += '&lt;';
        else if (character === '>') output += '&gt;'; else if (character === '"') output += '&quot;';
        else if (character === "'") output += '&#39;'; else if (character === '\n') output += '<br>'; else output += character; }
    return output;
}

function normalized(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) { const code = value.charCodeAt(index);
        if (code === 13 || (code < 0x20 && code !== 9 && code !== 10)) return false;
        if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++index);
            if (next < 0xdc00 || next > 0xdfff) return false; } else if (code >= 0xdc00 && code <= 0xdfff) return false; }
    return value.normalize('NFC') === value;
}

function decodeSection(value: string): string | null {
    const entities = [['&amp;', '&'], ['&lt;', '<'], ['&gt;', '>'], ['&quot;', '"'], ['&#39;', "'"], ['<br>', '\n']] as const;
    let output = '';
    for (let index = 0; index < value.length;) { const entity = entities.find(([encoded]) => value.startsWith(encoded, index));
        if (entity) { output += entity[1]; index += entity[0].length; continue; }
        const character = value[index]!; if ('&<>"\'\n'.includes(character)) return null; output += character; index += 1; }
    return normalized(output) && escapeSection(output) === value ? output : null;
}

function canonicalContent(value: string): boolean {
    const labels = ['S', 'O', 'A', 'P'] as const, sections: string[] = []; let cursor = 0;
    for (const label of labels) { const prefix = `<p>${label}:`; if (!value.startsWith(prefix, cursor)) return false;
        const start = cursor + prefix.length, end = value.indexOf('</p>', start); if (end < 0) return false;
        const body = value.slice(start, end); if (!body) sections.push(''); else { const decoded = body[0] === ' ' && decodeSection(body.slice(1));
            if (!decoded) return false; sections.push(decoded); } cursor = end + 4; }
    if (cursor !== value.length || !sections.some((section) => section.trim())) return false;
    return labels.map((label, index) => sections[index] ? `<p>${label}: ${escapeSection(sections[index]!)}</p>` : `<p>${label}:</p>`).join('') === value;
}

function canonicalDate(value: string): boolean {
    try { const epochMilliseconds = Date.parse(value);
        return DATE.test(value) && Number.isSafeInteger(epochMilliseconds) && epochMilliseconds >= 0
            && new Date(epochMilliseconds).toISOString() === value; } catch { return false; }
}

export function metadataJSON(metadata: ClinicianSoapEntryMetadataV1): string { return JSON.stringify(metadata); }

export function parseFieldSet(value: unknown): ParsedFieldSet | null {
    try { const source = exactRecord(value, FIELD_KEYS);
        if (!source || source.schema !== FIELD_SET_SCHEMA || source.type !== ENTRY_TYPE || source.title !== ENTRY_TITLE
            || typeof source.date !== 'string' || !canonicalDate(source.date) || typeof source.content !== 'string'
            || !canonicalContent(source.content) || source.setting !== ENTRY_SETTING) return null;
        const metadata = exactDigest(source.metadata, H1_DIGEST_CODEC), payload = exactDigest(source.payloadDigest, PAYLOAD_DIGEST_CODEC);
        if (!metadata || !payload) return null;
        const typedMetadata = metadata as ClinicianSoapEntryMetadataV1;
        return record({ value: record({ schema: FIELD_SET_SCHEMA, type: ENTRY_TYPE, title: ENTRY_TITLE, date: source.date,
            content: source.content, setting: ENTRY_SETTING, metadata: typedMetadata,
            payloadDigest: payload as ClinicianSoapEntryPayloadDigestV1 }) as ClinicianSoapEntryFieldSetV1,
        metadataJSON: metadataJSON(typedMetadata) });
    } catch { return null; }
}

export function frame(fields: readonly string[]): Uint8Array<ArrayBuffer> | null {
    const chunks: Uint8Array<ArrayBuffer>[] = []; let length = 0;
    for (const field of fields) { const bytes = encoder.encode(field);
        if (bytes.byteLength > 0xffff_ffff || length + 4 + bytes.byteLength > 0xffff_ffff) return null;
        const prefix = new Uint8Array(4); new DataView(prefix.buffer).setUint32(0, bytes.byteLength, false);
        chunks.push(prefix, bytes); length += 4 + bytes.byteLength; }
    const output = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; } return output;
}

export function hashFromBuffer(source: ArrayBuffer): HashValue | null {
    const view = new Uint8Array(source); if (view.byteLength !== 32) return null; const bytes = [...view];
    return record({ bytes: Object.freeze(bytes), hex: bytes.map((value) => value.toString(16).padStart(2, '0')).join('') });
}
export function sameHash(left: HashValue, right: HashValue): boolean {
    if (left.hex !== right.hex || left.bytes.length !== right.bytes.length) return false; let difference = 0;
    for (let index = 0; index < left.bytes.length; index += 1) difference |= left.bytes[index]! ^ right.bytes[index]!; return difference === 0;
}

function toBase64(bytes: Uint8Array): string {
    let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary);
}
function fromBase64(value: string): Uint8Array<ArrayBuffer> | null {
    try { const binary = atob(value), bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        return value && toBase64(bytes) === value ? bytes : null; } catch { return null; }
}
export function encodeEncrypted(iv: Uint8Array<ArrayBuffer>, ciphertextAndTag: ArrayBuffer): string {
    return `ENC:${toBase64(iv)}:${toBase64(new Uint8Array(ciphertextAndTag))}`;
}
export function decodeEncrypted(value: string): EncryptedParts | null {
    const parts = value.split(':'); if (parts.length !== 3 || parts[0] !== 'ENC') return null;
    const iv = fromBase64(parts[1]!), ciphertextAndTag = fromBase64(parts[2]!);
    return iv?.byteLength === 12 && ciphertextAndTag && ciphertextAndTag.byteLength >= 16 ? { iv, ciphertextAndTag } : null;
}

export function parseSeal(value: unknown): ParsedSeal | null {
    try { const source = exactRecord(value, SEAL_KEYS);
        if (!source || source.schema !== SEAL_SCHEMA || source.type !== ENTRY_TYPE || typeof source.date !== 'string'
            || !canonicalDate(source.date) || source.setting !== ENTRY_SETTING || typeof source.title !== 'string'
            || !decodeEncrypted(source.title) || typeof source.content !== 'string' || !decodeEncrypted(source.content)
            || typeof source.metadata !== 'string' || !decodeEncrypted(source.metadata)) return null;
        const payload = exactDigest(source.payloadDigest, PAYLOAD_DIGEST_CODEC), seal = exactDigest(source.sealDigest, SEAL_DIGEST_CODEC);
        return payload && seal ? record({ schema: SEAL_SCHEMA, type: ENTRY_TYPE, date: source.date, setting: ENTRY_SETTING,
            title: source.title, content: source.content, metadata: source.metadata,
            payloadDigest: payload as ClinicianSoapEntryPayloadDigestV1,
            sealDigest: seal as ParsedSeal['sealDigest'] }) : null;
    } catch { return null; }
}

export function distinctIVs(random: (target: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>): readonly [
    Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>,
] | null {
    const ivs: Uint8Array<ArrayBuffer>[] = [];
    for (let index = 0; index < 3; index += 1) { const iv = new Uint8Array(12), returned = random(iv);
        if (returned !== iv || ivs.some((other) => sameBytes(other, iv))) return null; ivs.push(iv); }
    return ivs as [Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>];
}
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
    if (left.byteLength !== right.byteLength) return false; let difference = 0;
    for (let index = 0; index < left.byteLength; index += 1) difference |= left[index]! ^ right[index]!; return difference === 0;
}
