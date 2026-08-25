/* @Codex */
import 'server-only';

import { randomBytes } from 'node:crypto';
import { types } from 'node:util';
import { sql } from 'drizzle-orm';

import { dbServer, runDbServerImmediateTransaction } from './db-server';

const REF = /^[0-9a-f]{64}$/u;
const MAX = Number.MAX_SAFE_INTEGER;
const KEYS = ['sourceRef', 'revision', 'freshnessEpoch'] as const;
let operationActive = false;

export type AttachmentCurrentness = Readonly<{ sourceRef: string; revision: number; freshnessEpoch: number }>;
export type HostAttachmentContentMutation = Readonly<{ replaceData(value: unknown): void }>;
export type HostAttachmentContentOperation = (mutation: HostAttachmentContentMutation) => void;
export type AttachmentCurrentnessHostErrorCode = 'input_invalid' | 'attachment_missing' | 'currentness_conflict' | 'currentness_overflow' | 'operation_invalid' | 'operation_failed' | 'reentry' | 'stored_state_invalid' | 'storage_unavailable';
export class AttachmentCurrentnessHostError extends Error {
    constructor(readonly code: AttachmentCurrentnessHostErrorCode) { super(`Attachment currentness host rejected: ${code}`); this.name = 'AttachmentCurrentnessHostError'; }
}

function fail(code: AttachmentCurrentnessHostErrorCode): never { throw new AttachmentCurrentnessHostError(code); }
function currentness(value: unknown): AttachmentCurrentness {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('input_invalid');
        const fields = Object.getOwnPropertyDescriptors(value);
        if (Reflect.ownKeys(value).length !== KEYS.length || !KEYS.every((key) => Object.hasOwn(fields, key) && 'value' in fields[key]! && fields[key]!.enumerable)) fail('input_invalid');
        const { sourceRef, revision, freshnessEpoch } = fields as Record<string, PropertyDescriptor>;
        if (typeof sourceRef.value !== 'string' || !REF.test(sourceRef.value) || typeof revision.value !== 'number' || !Number.isSafeInteger(revision.value) || revision.value < 1 || typeof freshnessEpoch.value !== 'number' || !Number.isSafeInteger(freshnessEpoch.value) || freshnessEpoch.value < 1) fail('input_invalid');
        return Object.freeze({ sourceRef: sourceRef.value, revision: revision.value, freshnessEpoch: freshnessEpoch.value });
    } catch (error) { if (error instanceof AttachmentCurrentnessHostError) throw error; return fail('input_invalid'); }
}
function attachmentId(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > 256 || value !== value.trim()) fail('input_invalid');
    return value;
}
class ContentMutation implements HostAttachmentContentMutation {
    #data: string | null | undefined; #open = true;
    replaceData(value: unknown): void {
        if (!this.#open || this.#data !== undefined || (value !== null && typeof value !== 'string')) fail('operation_invalid');
        this.#data = value;
    }
    close(): string | null {
        this.#open = false;
        if (this.#data === undefined) fail('operation_invalid');
        return this.#data;
    }
    seal(): void { this.#open = false; }
}
function stored(row: unknown, id: string): AttachmentCurrentness & { patientId: string } {
    try {
        const value = row as { id?: unknown; patientId?: unknown; sourceRef?: unknown; revision?: unknown; freshnessEpoch?: unknown };
        if (value.id !== id || typeof value.patientId !== 'string' || value.patientId.length === 0 || value.patientId !== value.patientId.trim()) fail('stored_state_invalid');
        return Object.freeze({ patientId: value.patientId, ...currentness({ sourceRef: value.sourceRef, revision: value.revision, freshnessEpoch: value.freshnessEpoch }) });
    } catch { return fail('stored_state_invalid'); }
}
function storage(error: unknown): never {
    if (error instanceof AttachmentCurrentnessHostError) throw error;
    throw new AttachmentCurrentnessHostError('storage_unavailable');
}

/** Returns the only host-generated initial tuple; creation writers remain separate. */
export function createHostAttachmentCurrentness(): AttachmentCurrentness {
    const sourceRef = randomBytes(32).toString('hex');
    if (!REF.test(sourceRef)) fail('storage_unavailable');
    return Object.freeze({ sourceRef, revision: 1, freshnessEpoch: 1 });
}

/** Runs one synchronous, data-only host mutation and its exact currentness CAS under one SQLite writer lock. */
export function transitionAttachmentContentCurrentness(idValue: unknown, expectedValue: unknown, operation: HostAttachmentContentOperation): AttachmentCurrentness;
export function transitionAttachmentContentCurrentness(idValue: unknown, expectedValue: unknown, operation: unknown): AttachmentCurrentness;
export function transitionAttachmentContentCurrentness(idValue: unknown, expectedValue: unknown, operation: unknown): AttachmentCurrentness {
    const id = attachmentId(idValue); const expected = currentness(expectedValue);
    if (typeof operation !== 'function' || types.isProxy(operation) || operationActive) fail(operationActive ? 'reentry' : 'input_invalid');
    try { return runDbServerImmediateTransaction(() => {
        const row = dbServer.get<{ id: unknown; patientId: unknown; sourceRef: unknown; revision: unknown; freshnessEpoch: unknown }>(sql`
            SELECT id, patient_id AS patientId, document_source_ref AS sourceRef, document_revision AS revision, document_freshness_epoch AS freshnessEpoch FROM attachments WHERE id = ${id}`);
        if (!row) fail('attachment_missing');
        const storedValue = stored(row, id);
        if (storedValue.sourceRef !== expected.sourceRef || storedValue.revision !== expected.revision || storedValue.freshnessEpoch !== expected.freshnessEpoch) fail('currentness_conflict');
        if (storedValue.revision >= MAX || storedValue.freshnessEpoch >= MAX) fail('currentness_overflow');
        const mutation = new ContentMutation(); let data: string | null; operationActive = true;
        try {
            if ((operation as (value: HostAttachmentContentMutation) => unknown)(mutation) !== undefined) fail('operation_invalid');
            data = mutation.close();
        }
        catch (error) { if (error instanceof AttachmentCurrentnessHostError) throw error; fail('operation_failed'); }
        finally { operationActive = false; mutation.seal(); }
        const result = dbServer.run(sql`UPDATE attachments SET data = ${data}, document_revision = document_revision + 1, document_freshness_epoch = document_freshness_epoch + 1
            WHERE id = ${id} AND patient_id = ${storedValue.patientId} AND document_source_ref = ${expected.sourceRef} AND document_revision = ${expected.revision} AND document_freshness_epoch = ${expected.freshnessEpoch}`);
        if (result.changes !== 1) fail('currentness_conflict');
        return Object.freeze({ sourceRef: expected.sourceRef, revision: expected.revision + 1, freshnessEpoch: expected.freshnessEpoch + 1 });
    }); } catch (error) { return storage(error); }
}
