/* @Codex */
import 'server-only';

import { randomBytes } from 'node:crypto';
import { types } from 'node:util';
import { sql } from 'drizzle-orm';

import { dbServer, runDbServerImmediateTransaction } from './db-server';

const REF = /^[0-9a-f]{64}$/u;
const MAX = Number.MAX_SAFE_INTEGER;
const KEYS = ['sourceRef', 'revision', 'freshnessEpoch'] as const;
const STORED_KEYS = ['id', 'patientId', 'sourceRef', 'revision', 'freshnessEpoch'] as const;
const RUN_RESULT_KEYS = ['changes', 'lastInsertRowid'] as const;
const OBJECT_PROTOTYPE = Object.prototype;
const objectCreate = Object.create;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
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
const dbServerGet = dbServer.get.bind(dbServer) as typeof dbServer.get;
const dbServerRun = dbServer.run.bind(dbServer) as typeof dbServer.run;
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

function exactOwnDataFields(value: unknown, keys: readonly string[]): Record<string, PropertyDescriptor> | null {
    if (!value || typeof value !== 'object' || arrayIsArray(value) || isProxy(value) || objectGetPrototypeOf(value) !== OBJECT_PROTOTYPE) return null;
    const fields = objectGetOwnPropertyDescriptors(value);
    if (reflectOwnKeys(value).length !== keys.length) return null;
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index]!;
        if (!objectHasOwn(fields, key)) return null;
        const field = objectGetOwnPropertyDescriptor(fields, key);
        if (!field || !objectHasOwn(field, 'value')) return null;
        const descriptor = field.value;
        if (!descriptor || typeof descriptor !== 'object' || !objectHasOwn(descriptor, 'value') || !objectHasOwn(descriptor, 'enumerable') || descriptor.enumerable !== true) return null;
    }
    return fields;
}

function currentness(value: unknown): AttachmentCurrentness {
    try {
        const fields = exactOwnDataFields(value, KEYS);
        if (!fields) fail('input_invalid');
        const { sourceRef, revision, freshnessEpoch } = fields;
        if (typeof sourceRef.value !== 'string' || !regexpTest(REF, sourceRef.value) || typeof revision.value !== 'number' || !numberIsSafeInteger(revision.value) || revision.value < 1 || typeof freshnessEpoch.value !== 'number' || !numberIsSafeInteger(freshnessEpoch.value) || freshnessEpoch.value < 1) fail('input_invalid');
        return objectFreeze({ sourceRef: sourceRef.value, revision: revision.value, freshnessEpoch: freshnessEpoch.value });
    } catch (error) { if (isAttachmentCurrentnessHostError(error)) throw error; return fail('input_invalid'); }
}

function frozenNullCurrentness(sourceRef: string, revision: number, freshnessEpoch: number): AttachmentCurrentness {
    const tuple = objectCreate(null) as { sourceRef: string; revision: number; freshnessEpoch: number };
    objectDefineProperties(tuple, {
        sourceRef: { value: sourceRef, enumerable: true },
        revision: { value: revision, enumerable: true },
        freshnessEpoch: { value: freshnessEpoch, enumerable: true },
    });
    return objectFreeze(tuple);
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
        const fields = exactOwnDataFields(row, STORED_KEYS);
        if (!fields) fail('stored_state_invalid');
        const { id: storedId, patientId, sourceRef, revision, freshnessEpoch } = fields;
        if (storedId.value !== id || typeof patientId.value !== 'string' || patientId.value.length === 0 || patientId.value !== stringTrim(patientId.value)) fail('stored_state_invalid');
        return objectFreeze({ patientId: patientId.value, ...currentness({ sourceRef: sourceRef.value, revision: revision.value, freshnessEpoch: freshnessEpoch.value }) });
    } catch { return fail('stored_state_invalid'); }
}

function observed(row: unknown): AttachmentCurrentness {
    try {
        const value = currentness(row);
        return frozenNullCurrentness(value.sourceRef, value.revision, value.freshnessEpoch);
    } catch {
        return fail('stored_state_invalid');
    }
}

function runResult(value: unknown): Readonly<{ changes: number; lastInsertRowid: number | bigint }> {
    const fields = exactOwnDataFields(value, RUN_RESULT_KEYS);
    if (!fields) fail('storage_unavailable');
    const { changes, lastInsertRowid } = fields;
    if (typeof changes.value !== 'number' || !numberIsSafeInteger(changes.value) || changes.value < 0
        || (typeof lastInsertRowid.value !== 'number' && typeof lastInsertRowid.value !== 'bigint')
        || (typeof lastInsertRowid.value === 'number' && (!numberIsSafeInteger(lastInsertRowid.value) || lastInsertRowid.value < 0))) fail('storage_unavailable');
    return objectFreeze({ changes: changes.value, lastInsertRowid: lastInsertRowid.value });
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

/** Reads the exact host-owned currentness tuple for one existing attachment. */
export function observeHostAttachmentCurrentness(idValue: unknown): AttachmentCurrentness | null {
    const id = attachmentId(idValue);
    try {
        const row = dbServerGet<{ sourceRef: unknown; revision: unknown; freshnessEpoch: unknown }>(sql`
            SELECT document_source_ref AS sourceRef, document_revision AS revision, document_freshness_epoch AS freshnessEpoch FROM attachments WHERE id = ${id}`);
        if (row === null || row === undefined) return null;
        return observed(row);
    } catch (error) { return storage(error); }
}

/** Atomically replaces data and advances one exact host-owned currentness tuple. */
export function transitionAttachmentContentCurrentness(idValue: unknown, expectedValue: unknown, replacementValue: unknown): AttachmentCurrentness {
    const id = attachmentId(idValue);
    const expected = currentness(expectedValue);
    const data = replacement(replacementValue);
    try {
        return runDbServerImmediateTransaction(() => {
            const row = dbServerGet<{ id: unknown; patientId: unknown; sourceRef: unknown; revision: unknown; freshnessEpoch: unknown }>(sql`
                SELECT id, patient_id AS patientId, document_source_ref AS sourceRef, document_revision AS revision, document_freshness_epoch AS freshnessEpoch FROM attachments WHERE id = ${id}`);
            if (!row) fail('attachment_missing');
            const storedValue = stored(row, id);
            if (storedValue.sourceRef !== expected.sourceRef || storedValue.revision !== expected.revision || storedValue.freshnessEpoch !== expected.freshnessEpoch) fail('currentness_conflict');
            if (storedValue.revision >= MAX || storedValue.freshnessEpoch >= MAX) fail('currentness_overflow');
            const result = runResult(dbServerRun(sql`UPDATE attachments SET data = ${data}, document_revision = document_revision + 1, document_freshness_epoch = document_freshness_epoch + 1
                WHERE id = ${id} AND patient_id = ${storedValue.patientId} AND document_source_ref = ${expected.sourceRef} AND document_revision = ${expected.revision} AND document_freshness_epoch = ${expected.freshnessEpoch}`));
            if (result.changes !== 1) fail('currentness_conflict');
            return objectFreeze({ sourceRef: expected.sourceRef, revision: expected.revision + 1, freshnessEpoch: expected.freshnessEpoch + 1 });
        });
    } catch (error) { return storage(error); }
}
