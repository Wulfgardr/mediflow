/* @Codex */
import 'server-only';

import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { dbServer, hasCanonicalDurableReviewPatientLinkSchema } from '../../db-server';
import { durableReviewCommandStates, durableReviewPatientLinks, durableReviewRecords, patients } from '../../schema';

export type DurableCurrentReviewIdentity = Readonly<{ reviewId: string; reviewRevision: number }>;
export type DurableCurrentReviewLocatorErrorCode = 'input_invalid' | 'current_missing' | 'current_ambiguous' | 'terminal' | 'corrupt' | 'schema_incompatible' | 'storage_unavailable';

export class DurableCurrentReviewLocatorError extends Error {
    constructor(readonly code: DurableCurrentReviewLocatorErrorCode) {
        super(`Durable current review locator rejected: ${code}`);
        this.name = 'DurableCurrentReviewLocatorError';
    }
}

const REVIEW = /^review_[0-9a-f]{32}$/u;
const PATIENT_REF = /^ptr_[0-9a-f]{32}$/u;
const RECEIPT = /^receipt_[0-9a-f]{32}$/u;
const PROVENANCE = /^provenance_[0-9a-f]{32}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SEALED = /^ENC:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/u;
const PRESENTATION_VERSION = 'mediflow.ai.durable-review.presentation.v1';

function fail(code: DurableCurrentReviewLocatorErrorCode): never {
    throw new DurableCurrentReviewLocatorError(code);
}

function canonicalPatientId(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > 256 || value !== value.trim() || PATIENT_REF.test(value)) fail('input_invalid');
    return value;
}

function digest(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function validateRecord(row: Record<string, unknown>, patientId: string): DurableCurrentReviewIdentity {
    const { linkReviewId, linkPatientId, canonicalPatientId: storedPatientId, recordId, patientRef, reviewId, reviewRevision, receiptRef, provenanceRef, receiptBinding, provenanceBinding, presentationVersion, sealedCiphertext, sealedDigest } = row;
    if (linkPatientId !== patientId || storedPatientId !== patientId || typeof linkReviewId !== 'string' || !REVIEW.test(linkReviewId)
        || recordId !== linkReviewId || typeof reviewId !== 'string' || reviewId !== linkReviewId || typeof patientRef !== 'string' || !PATIENT_REF.test(patientRef)
        || typeof reviewRevision !== 'number' || !Number.isSafeInteger(reviewRevision) || reviewRevision < 1
        || typeof receiptRef !== 'string' || !RECEIPT.test(receiptRef) || typeof provenanceRef !== 'string' || !PROVENANCE.test(provenanceRef)
        || typeof receiptBinding !== 'string' || !SHA256.test(receiptBinding) || receiptBinding !== digest(`${patientRef}\0${reviewId}\0${receiptRef}`)
        || typeof provenanceBinding !== 'string' || !SHA256.test(provenanceBinding) || provenanceBinding !== digest(`${patientRef}\0${reviewId}\0${provenanceRef}`)
        || presentationVersion !== PRESENTATION_VERSION || typeof sealedCiphertext !== 'string' || !SEALED.test(sealedCiphertext)
        || typeof sealedDigest !== 'string' || !SHA256.test(sealedDigest) || sealedDigest !== digest(sealedCiphertext)) fail('corrupt');
    return Object.freeze({ reviewId, reviewRevision });
}

function classifyCurrent(row: Record<string, unknown>, patientId: string): DurableCurrentReviewIdentity | null {
    const current = validateRecord(row, patientId);
    const { commandReviewId, reviewState, commandRevision, action } = row;
    if (commandReviewId === null && reviewState === null && commandRevision === null && action === null) return current;
    if (commandReviewId !== current.reviewId || (reviewState !== 'accepted' && reviewState !== 'rejected')
        || (action !== 'accept' && action !== 'reject') || (reviewState === 'accepted' ? action !== 'accept' : action !== 'reject')
        || typeof commandRevision !== 'number' || !Number.isSafeInteger(commandRevision) || commandRevision !== current.reviewRevision + 1) fail('corrupt');
    return null;
}

function storage(error: unknown): never {
    if (error instanceof DurableCurrentReviewLocatorError) throw error;
    fail('storage_unavailable');
}

/** Server-only, read-only lookup through canonical patient links; it never resolves rotating patientRef values. */
export function createDurableCurrentReviewLocator() {
    return Object.freeze({
        locate(value: unknown): DurableCurrentReviewIdentity {
            const patientId = canonicalPatientId(value);
            try {
                if (!hasCanonicalDurableReviewPatientLinkSchema()) fail('schema_incompatible');
                const rows = dbServer.select({
                    linkReviewId: durableReviewPatientLinks.reviewId, linkPatientId: durableReviewPatientLinks.patientId,
                    canonicalPatientId: patients.id, recordId: durableReviewRecords.id, patientRef: durableReviewRecords.patientRef,
                    reviewId: durableReviewRecords.reviewId, reviewRevision: durableReviewRecords.reviewRevision,
                    receiptRef: durableReviewRecords.receiptRef, provenanceRef: durableReviewRecords.provenanceRef,
                    receiptBinding: durableReviewRecords.receiptBinding, provenanceBinding: durableReviewRecords.provenanceBinding,
                    presentationVersion: durableReviewRecords.presentationVersion, sealedCiphertext: durableReviewRecords.sealedCiphertext,
                    sealedDigest: durableReviewRecords.sealedDigest, commandReviewId: durableReviewCommandStates.reviewId,
                    reviewState: durableReviewCommandStates.reviewState, commandRevision: durableReviewCommandStates.revision,
                    action: durableReviewCommandStates.action,
                }).from(durableReviewPatientLinks)
                    .leftJoin(patients, eq(durableReviewPatientLinks.patientId, patients.id))
                    .leftJoin(durableReviewRecords, eq(durableReviewPatientLinks.reviewId, durableReviewRecords.reviewId))
                    .leftJoin(durableReviewCommandStates, eq(durableReviewPatientLinks.reviewId, durableReviewCommandStates.reviewId))
                    .where(eq(durableReviewPatientLinks.patientId, patientId)).all();
                if (rows.length === 0) fail('current_missing');
                const current = rows.map((row) => classifyCurrent(row as Record<string, unknown>, patientId)).filter((row): row is DurableCurrentReviewIdentity => row !== null);
                if (current.length === 0) fail('terminal');
                if (current.length !== 1) fail('current_ambiguous');
                return current[0];
            } catch (error) {
                return storage(error);
            }
        },
    });
}
