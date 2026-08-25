/* @Codex */
import 'server-only';

import { randomBytes } from 'node:crypto';
import { types } from 'node:util';
import { sql } from 'drizzle-orm';

import { dbServer, runDbServerImmediateTransaction } from './db-server';

const REF = /^[0-9a-f]{64}$/u;
const MAX = Number.MAX_SAFE_INTEGER;
const KEYS = ['sourceRef', 'revision', 'freshnessEpoch'] as const;
const OBJECT_PROTOTYPE = Object.prototype;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectHasOwn = Object.hasOwn;
const objectDefineProperties = Object.defineProperties;
const objectFreeze = Object.freeze;
const reflectOwnKeys = Reflect.ownKeys;
const arrayIsArray = Array.isArray;
const numberIsSafeInteger = Number.isSafeInteger;
const stringTrim = Function.call.bind(String.prototype.trim) as (value: string) => string;
const regexpTest = Function.call.bind(RegExp.prototype.test) as (expression: RegExp, value: string) => boolean;
const weakSetAdd = Function.call.bind(WeakSet.prototype.add) as (set: WeakSet<object>, value: object) => WeakSet<object>;
const weakSetHas = Function.call.bind(WeakSet.prototype.has) as (set: WeakSet<object>, value: object) => boolean;
const isProxy = types.isProxy;
const cryptoRandomBytes = randomBytes;
const ErrorConstructor = Error;
const mintedHostErrors = new WeakSet<object>();

export type AttachmentCurrentness = Readonly<{ sourceRef: string; revision: number; freshnessEpoch: number }>;
export type AttachmentCurrentnessHostErrorCode = 'input_invalid' | 'attachment_missing' | 'currentness_conflict' | 'currentness_overflow' | 'stored_state_invalid' | 'storage_unavailable';

/** Identifies only errors minted by this host boundary. */
export function isAttachmentCurrentnessHostError(error: unknown): error is Error & Readonly<{ code: AttachmentCurrentnessHostErrorCode }> {
    return typeof error === 'object' && error !== null && !isProxy(error) && weakSetHas(mintedHostErrors, error);
}

function fail(code: AttachmentCurrentnessHostErrorCode): never {
    const error = new ErrorConstructor(`Attachment currentness host rejected: ${code}`) as Error & { code: AttachmentCurrentnessHostErrorCode };
    objectDefineProperties(error, { name: { value: 'AttachmentCurrentnessHostError' }, code: { value: code, enumerable: true } });
    weakSetAdd(mintedHostErrors, error);
    throw objectFreeze(error);
}

function currentness(value: unknown): AttachmentCurrentness {
    try {
        if (!value || typeof value !== 'object' || arrayIsArray(value) || isProxy(value) || objectGetPrototypeOf(value) !== OBJECT_PROTOTYPE) fail('input_invalid');
        const fields = objectGetOwnPropertyDescriptors(value);
        if (reflectOwnKeys(value).length !== KEYS.length) fail('input_invalid');
        for (let index = 0; index < KEYS.length; index += 1) {
            const descriptor = fields[KEYS[index]!];
            if (!objectHasOwn(fields, KEYS[index]!) || !descriptor || !('value' in descriptor) || !descriptor.enumerable) fail('input_invalid');
        }
        const { sourceRef, revision, freshnessEpoch } = fields as Record<string, PropertyDescriptor>;
        if (typeof sourceRef.value !== 'string' || !regexpTest(REF, sourceRef.value) || typeof revision.value !== 'number' || !numberIsSafeInteger(revision.value) || revision.value < 1 || typeof freshnessEpoch.value !== 'number' || !numberIsSafeInteger(freshnessEpoch.value) || freshnessEpoch.value < 1) fail('input_invalid');
        return objectFreeze({ sourceRef: sourceRef.value, revision: revision.value, freshnessEpoch: freshnessEpoch.value });
    } catch (error) { if (isAttachmentCurrentnessHostError(error)) throw error; return fail('input_invalid'); }
}

function attachmentId(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > 256 || value !== stringTrim(value)) fail('input_invalid');
    return value;
}

function replacement(value: unknown): string | null {
    if (value === null || typeof value === 'string') return value;
    return fail('input_invalid');
}

function stored(row: unknown, id: string): AttachmentCurrentness & { patientId: string } {
    try {
        const value = row as { id?: unknown; patientId?: unknown; sourceRef?: unknown; revision?: unknown; freshnessEpoch?: unknown };
        if (value.id !== id || typeof value.patientId !== 'string' || value.patientId.length === 0 || value.patientId !== stringTrim(value.patientId)) fail('stored_state_invalid');
        return objectFreeze({ patientId: value.patientId, ...currentness({ sourceRef: value.sourceRef, revision: value.revision, freshnessEpoch: value.freshnessEpoch }) });
    } catch { return fail('stored_state_invalid'); }
}

function storage(error: unknown): never {
    if (isAttachmentCurrentnessHostError(error)) throw error;
    return fail('storage_unavailable');
}

/** Returns the only host-generated initial tuple; creation writers remain separate. */
export function createHostAttachmentCurrentness(): AttachmentCurrentness {
    try {
        const bytes = cryptoRandomBytes(32);
        if (bytes.length !== 32) fail('storage_unavailable');
        let sourceRef = '';
        for (let index = 0; index < bytes.length; index += 1) {
            const byte = bytes[index]!;
            if (!numberIsSafeInteger(byte) || byte < 0 || byte > 255) fail('storage_unavailable');
            sourceRef += '0123456789abcdef'[byte >>> 4]! + '0123456789abcdef'[byte & 15]!;
        }
        if (!regexpTest(REF, sourceRef)) fail('storage_unavailable');
        return objectFreeze({ sourceRef, revision: 1, freshnessEpoch: 1 });
    } catch (error) { return storage(error); }
}

/** Atomically replaces data and advances one exact host-owned currentness tuple. */
export function transitionAttachmentContentCurrentness(idValue: unknown, expectedValue: unknown, replacementValue: unknown): AttachmentCurrentness {
    const id = attachmentId(idValue);
    const expected = currentness(expectedValue);
    const data = replacement(replacementValue);
    try {
        return runDbServerImmediateTransaction(() => {
            const row = dbServer.get<{ id: unknown; patientId: unknown; sourceRef: unknown; revision: unknown; freshnessEpoch: unknown }>(sql`
                SELECT id, patient_id AS patientId, document_source_ref AS sourceRef, document_revision AS revision, document_freshness_epoch AS freshnessEpoch FROM attachments WHERE id = ${id}`);
            if (!row) fail('attachment_missing');
            const storedValue = stored(row, id);
            if (storedValue.sourceRef !== expected.sourceRef || storedValue.revision !== expected.revision || storedValue.freshnessEpoch !== expected.freshnessEpoch) fail('currentness_conflict');
            if (storedValue.revision >= MAX || storedValue.freshnessEpoch >= MAX) fail('currentness_overflow');
            const result = dbServer.run(sql`UPDATE attachments SET data = ${data}, document_revision = document_revision + 1, document_freshness_epoch = document_freshness_epoch + 1
                WHERE id = ${id} AND patient_id = ${storedValue.patientId} AND document_source_ref = ${expected.sourceRef} AND document_revision = ${expected.revision} AND document_freshness_epoch = ${expected.freshnessEpoch}`);
            if (result.changes !== 1) fail('currentness_conflict');
            return objectFreeze({ sourceRef: expected.sourceRef, revision: expected.revision + 1, freshnessEpoch: expected.freshnessEpoch + 1 });
        });
    } catch (error) { return storage(error); }
}
