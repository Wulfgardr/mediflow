/* @Codex */
import 'server-only';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { dbServer } from '../../db-server';
import { durableReviewRecords } from '../../schema';

export const DURABLE_REVIEW_PRESENTATION_VERSION = 'mediflow.ai.durable-review.presentation.v1' as const;
export type DurableReviewRecord = Readonly<{
    recordId: string; reviewId: string; reviewRevision: 1; receiptRef: string; provenanceRef: string;
    receiptBinding: string; provenanceBinding: string; presentationVersion: typeof DURABLE_REVIEW_PRESENTATION_VERSION;
    sealedCiphertext: string; sealedDigest: string;
}>;
type DurableReviewInput = Omit<DurableReviewRecord, 'recordId'>;
export type DurableReviewRecordStoreErrorCode = 'invalid_record' | 'duplicate' | 'missing' | 'corrupt';
export class DurableReviewRecordStoreError extends Error {
    constructor(public readonly code: DurableReviewRecordStoreErrorCode) { super(`Durable review record rejected: ${code}`); }
}
const REVIEW = /^review_[0-9a-f]{32}$/;
const RECEIPT = /^receipt_[0-9a-f]{32}$/;
const PROVENANCE = /^provenance_[0-9a-f]{32}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SEALED = /^ENC:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/;
const INPUT_KEYS = ['reviewId', 'reviewRevision', 'receiptRef', 'provenanceRef', 'receiptBinding', 'provenanceBinding', 'presentationVersion', 'sealedCiphertext', 'sealedDigest'] as const;

function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function exact(value: object, keys: readonly string[]): boolean {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Reflect.ownKeys(value).length === keys.length && keys.every((key) => (
        Object.hasOwn(descriptors, key) && 'value' in descriptors[key]! && descriptors[key]!.enumerable
    ));
}
function snapshot(value: unknown): DurableReviewInput {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || !exact(value, INPUT_KEYS)) {
        throw new DurableReviewRecordStoreError('invalid_record');
    }
    const input = value as Record<string, unknown>;
    const reviewId = input.reviewId; const receiptRef = input.receiptRef; const provenanceRef = input.provenanceRef;
    const receiptBinding = input.receiptBinding; const provenanceBinding = input.provenanceBinding;
    const ciphertext = input.sealedCiphertext; const sealedDigest = input.sealedDigest;
    if (
        typeof reviewId !== 'string' || !REVIEW.test(reviewId) || input.reviewRevision !== 1
        || typeof receiptRef !== 'string' || !RECEIPT.test(receiptRef) || typeof provenanceRef !== 'string' || !PROVENANCE.test(provenanceRef)
        || typeof receiptBinding !== 'string' || !SHA256.test(receiptBinding) || receiptBinding !== digest(`${reviewId}\0${receiptRef}`)
        || typeof provenanceBinding !== 'string' || !SHA256.test(provenanceBinding) || provenanceBinding !== digest(`${reviewId}\0${provenanceRef}`)
        || input.presentationVersion !== DURABLE_REVIEW_PRESENTATION_VERSION || typeof ciphertext !== 'string' || !SEALED.test(ciphertext)
        || typeof sealedDigest !== 'string' || !SHA256.test(sealedDigest) || sealedDigest !== digest(ciphertext)
    ) throw new DurableReviewRecordStoreError('invalid_record');
    return Object.freeze({ reviewId, reviewRevision: 1, receiptRef, provenanceRef, receiptBinding, provenanceBinding,
        presentationVersion: DURABLE_REVIEW_PRESENTATION_VERSION, sealedCiphertext: ciphertext, sealedDigest });
}
function publicRecord(value: DurableReviewInput, recordId = value.reviewId): DurableReviewRecord {
    if (recordId !== value.reviewId) throw new DurableReviewRecordStoreError('corrupt');
    return Object.freeze({ recordId, ...value });
}

/** Stores only a client-sealed review envelope. It owns neither keys nor plaintext. */
export function createDurableReviewRecordStore() {
    function create(value: unknown): DurableReviewRecord {
        const record = snapshot(value);
        try {
            dbServer.insert(durableReviewRecords).values({ id: record.reviewId, ...record }).run();
        } catch { throw new DurableReviewRecordStoreError('duplicate'); }
        return publicRecord(record);
    }
    function read(reviewId: unknown): DurableReviewRecord {
        if (typeof reviewId !== 'string' || !REVIEW.test(reviewId)) throw new DurableReviewRecordStoreError('missing');
        const row = dbServer.select().from(durableReviewRecords).where(eq(durableReviewRecords.id, reviewId)).get();
        if (!row) throw new DurableReviewRecordStoreError('missing');
        const { id, createdAt: _createdAt, ...stored } = row;
        try { return publicRecord(snapshot(stored), id); }
        catch { throw new DurableReviewRecordStoreError('corrupt'); }
    }
    return Object.freeze({ create, read });
}
