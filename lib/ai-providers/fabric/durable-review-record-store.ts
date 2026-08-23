/* @Codex */
import 'server-only';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { dbServer, runDbServerImmediateTransaction } from '../../db-server';
import { durableReviewOperations, durableReviewRecords } from '../../schema';

export const DURABLE_REVIEW_PRESENTATION_VERSION = 'mediflow.ai.durable-review.presentation.v1' as const;
export type DurableReviewRecord = Readonly<{ recordId: string; patientRef: string; reviewId: string; reviewRevision: number; receiptRef: string; provenanceRef: string; receiptBinding: string; provenanceBinding: string; presentationVersion: typeof DURABLE_REVIEW_PRESENTATION_VERSION; sealedCiphertext: string; sealedDigest: string }>;
type DurableReviewInput = Omit<DurableReviewRecord, 'recordId'>;
type Mutation = Readonly<{ record: DurableReviewInput; expectedReviewRevision: number; idempotencyKey: string }>;
export type DurableReviewRecordStoreErrorCode = 'invalid_record' | 'idempotency_conflict' | 'revision_conflict' | 'missing' | 'corrupt' | 'storage_unavailable';
export class DurableReviewRecordStoreError extends Error { constructor(public readonly code: DurableReviewRecordStoreErrorCode) { super(`Durable review record rejected: ${code}`); } }
const REVIEW = /^review_[0-9a-f]{32}$/; const PATIENT = /^ptr_[0-9a-f]{32}$/; const RECEIPT = /^receipt_[0-9a-f]{32}$/; const PROVENANCE = /^provenance_[0-9a-f]{32}$/;
const SHA256 = /^[0-9a-f]{64}$/; const SEALED = /^ENC:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/; const KEY = /^idem_[a-z0-9]{16,160}$/;
const RECORD_KEYS = ['patientRef', 'reviewId', 'reviewRevision', 'receiptRef', 'provenanceRef', 'receiptBinding', 'provenanceBinding', 'presentationVersion', 'sealedCiphertext', 'sealedDigest'] as const;
const MUTATION_KEYS = ['record', 'expectedReviewRevision', 'idempotencyKey'] as const;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function exact(value: object, keys: readonly string[]) { const descriptors = Object.getOwnPropertyDescriptors(value); return Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.hasOwn(descriptors, key) && 'value' in descriptors[key]! && descriptors[key]!.enumerable); }
function normalizeRecord(value: unknown): DurableReviewInput {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || !exact(value, RECORD_KEYS)) throw new DurableReviewRecordStoreError('invalid_record');
    const input = value as Record<string, unknown>; const patientRef = input.patientRef; const reviewId = input.reviewId; const receiptRef = input.receiptRef; const provenanceRef = input.provenanceRef; const receiptBinding = input.receiptBinding; const provenanceBinding = input.provenanceBinding; const sealedCiphertext = input.sealedCiphertext; const sealedDigest = input.sealedDigest;
    if (typeof patientRef !== 'string' || !PATIENT.test(patientRef) || typeof reviewId !== 'string' || !REVIEW.test(reviewId) || typeof input.reviewRevision !== 'number' || !Number.isSafeInteger(input.reviewRevision) || input.reviewRevision < 1 || typeof receiptRef !== 'string' || !RECEIPT.test(receiptRef) || typeof provenanceRef !== 'string' || !PROVENANCE.test(provenanceRef) || typeof receiptBinding !== 'string' || !SHA256.test(receiptBinding) || receiptBinding !== digest(`${patientRef}\0${reviewId}\0${receiptRef}`) || typeof provenanceBinding !== 'string' || !SHA256.test(provenanceBinding) || provenanceBinding !== digest(`${patientRef}\0${reviewId}\0${provenanceRef}`) || input.presentationVersion !== DURABLE_REVIEW_PRESENTATION_VERSION || typeof sealedCiphertext !== 'string' || !SEALED.test(sealedCiphertext) || typeof sealedDigest !== 'string' || !SHA256.test(sealedDigest) || sealedDigest !== digest(sealedCiphertext)) throw new DurableReviewRecordStoreError('invalid_record');
    return Object.freeze({ patientRef, reviewId, reviewRevision: input.reviewRevision, receiptRef, provenanceRef, receiptBinding, provenanceBinding, presentationVersion: DURABLE_REVIEW_PRESENTATION_VERSION, sealedCiphertext, sealedDigest });
}
function mutation(value: unknown): Mutation {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || !exact(value, MUTATION_KEYS)) throw new Error();
        const input = value as Record<string, unknown>; const record = normalizeRecord(input.record); const expectedReviewRevision = input.expectedReviewRevision; const idempotencyKey = input.idempotencyKey;
        if (typeof expectedReviewRevision !== 'number' || !Number.isSafeInteger(expectedReviewRevision) || expectedReviewRevision < 0 || typeof idempotencyKey !== 'string' || !KEY.test(idempotencyKey) || record.reviewRevision !== expectedReviewRevision + 1) throw new Error();
        return Object.freeze({ record, expectedReviewRevision, idempotencyKey });
    } catch { throw new DurableReviewRecordStoreError('invalid_record'); }
}
const publicRecord = (record: DurableReviewInput): DurableReviewRecord => Object.freeze({ recordId: record.reviewId, ...record });
const commandDigest = (operation: 'create' | 'replace', value: Mutation) => digest(JSON.stringify([operation, value.expectedReviewRevision, value.record]));
function replay(snapshot: string, reviewId: string): DurableReviewRecord { try { const record = normalizeRecord(JSON.parse(snapshot) as unknown); if (record.reviewId !== reviewId) throw new Error(); return publicRecord(record); } catch { throw new DurableReviewRecordStoreError('corrupt'); } }
function current(row: unknown): DurableReviewInput { try { const { id, createdAt: _createdAt, ...record } = row as DurableReviewRecord & { id: string; createdAt: unknown }; if (id !== record.reviewId) throw new Error(); return normalizeRecord(record); } catch { throw new DurableReviewRecordStoreError('corrupt'); } }
function failStorage(error: unknown): never { if (error instanceof DurableReviewRecordStoreError) throw error; throw new DurableReviewRecordStoreError('storage_unavailable'); }

/** Stores only client-sealed review envelopes and durable replay receipts. It owns neither keys nor plaintext. */
export function createDurableReviewRecordStore() {
    const mutate = (operation: 'create' | 'replace', value: unknown): DurableReviewRecord => {
        const input = mutation(value); const operationDigest = commandDigest(operation, input);
        try { return runDbServerImmediateTransaction(() => {
            const existing = dbServer.select().from(durableReviewOperations).where(and(eq(durableReviewOperations.reviewId, input.record.reviewId), eq(durableReviewOperations.idempotencyKey, input.idempotencyKey))).get();
            const row = dbServer.select().from(durableReviewRecords).where(eq(durableReviewRecords.id, input.record.reviewId)).get();
            if (existing) { if (existing.operation !== operation || existing.expectedReviewRevision !== input.expectedReviewRevision || existing.operationDigest !== operationDigest) throw new DurableReviewRecordStoreError('idempotency_conflict'); if (!row) throw new DurableReviewRecordStoreError('missing'); current(row); return replay(existing.recordSnapshot, input.record.reviewId); }
            const stored = row ? current(row) : null;
            if (operation === 'create' ? stored !== null || input.expectedReviewRevision !== 0 : !stored || stored.reviewRevision !== input.expectedReviewRevision || stored.patientRef !== input.record.patientRef) throw new DurableReviewRecordStoreError('revision_conflict');
            if (stored) dbServer.update(durableReviewRecords).set(input.record).where(eq(durableReviewRecords.id, input.record.reviewId)).run(); else dbServer.insert(durableReviewRecords).values({ id: input.record.reviewId, ...input.record }).run();
            const result = publicRecord(input.record); dbServer.insert(durableReviewOperations).values({ id: digest(`${input.record.reviewId}\0${input.idempotencyKey}`), reviewId: input.record.reviewId, idempotencyKey: input.idempotencyKey, operation, expectedReviewRevision: input.expectedReviewRevision, operationDigest, recordSnapshot: JSON.stringify(input.record) }).run();
            return result;
        }); } catch (error) { return failStorage(error); }
    };
    return Object.freeze({ create: (value: unknown) => mutate('create', value), replace: (value: unknown) => mutate('replace', value), read(reviewId: unknown): DurableReviewRecord {
        if (typeof reviewId !== 'string' || !REVIEW.test(reviewId)) throw new DurableReviewRecordStoreError('missing');
        try { const row = dbServer.select().from(durableReviewRecords).where(eq(durableReviewRecords.id, reviewId)).get(); if (!row) throw new DurableReviewRecordStoreError('missing'); return publicRecord(current(row)); } catch (error) { return failStorage(error); }
    } });
}
