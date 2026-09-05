/* @Codex */
import 'server-only';

import { and, eq } from 'drizzle-orm';

import { dbServer, hasCanonicalDurableReviewPatientLinkSchema, runDbServerImmediateTransaction } from '../db-server';
import { activePatients } from '../patient-lifecycle';
import { durableReviewPatientLinks, durableReviewRecords, patients } from '../schema';

export type DurableReviewPatientLink = Readonly<{ reviewId: string; patientId: string }>;
export type DurableReviewPatientLinkStoreErrorCode =
    | 'input_invalid'
    | 'review_missing'
    | 'patient_missing'
    | 'link_missing'
    | 'link_conflict'
    | 'schema_incompatible'
    | 'stored_state_invalid'
    | 'storage_unavailable';

export class DurableReviewPatientLinkStoreError extends Error {
    constructor(readonly code: DurableReviewPatientLinkStoreErrorCode) {
        super(`Durable review patient link rejected: ${code}`);
        this.name = 'DurableReviewPatientLinkStoreError';
    }
}

const REVIEW_ID = /^review_[0-9a-f]{32}$/;
const LINK_KEYS = ['reviewId', 'patientId'] as const;

function fail(code: DurableReviewPatientLinkStoreErrorCode): never {
    throw new DurableReviewPatientLinkStoreError(code);
}

function linkInput(value: unknown): DurableReviewPatientLink {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('input_invalid');
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (Reflect.ownKeys(value).length !== LINK_KEYS.length || !LINK_KEYS.every((key) => Object.hasOwn(descriptors, key) && 'value' in descriptors[key]! && descriptors[key]!.enumerable)) fail('input_invalid');
        const reviewId = descriptors.reviewId!.value;
        const patientId = descriptors.patientId!.value;
        if (typeof reviewId !== 'string' || !REVIEW_ID.test(reviewId) || typeof patientId !== 'string' || patientId.length === 0 || patientId.length > 256 || patientId !== patientId.trim()) fail('input_invalid');
        return Object.freeze({ reviewId, patientId });
    } catch (error) {
        if (error instanceof DurableReviewPatientLinkStoreError) throw error;
        return fail('input_invalid');
    }
}

function reviewInput(value: unknown): string {
    if (typeof value !== 'string' || !REVIEW_ID.test(value)) fail('input_invalid');
    return value;
}

function schema(): void {
    try {
        if (!hasCanonicalDurableReviewPatientLinkSchema()) fail('schema_incompatible');
    } catch (error) {
        if (error instanceof DurableReviewPatientLinkStoreError) throw error;
        fail('storage_unavailable');
    }
}

function storage(error: unknown): never {
    if (error instanceof DurableReviewPatientLinkStoreError) throw error;
    throw new DurableReviewPatientLinkStoreError('storage_unavailable');
}

function storedLink(row: unknown): DurableReviewPatientLink {
    try {
        const value = row as { reviewId?: unknown; patientId?: unknown };
        return linkInput({ reviewId: value.reviewId, patientId: value.patientId });
    } catch { return fail('stored_state_invalid'); }
}

function verifyOperationalReferences(link: DurableReviewPatientLink): void {
    const review = dbServer.select({ reviewId: durableReviewRecords.reviewId }).from(durableReviewRecords)
        .where(eq(durableReviewRecords.reviewId, link.reviewId)).get();
    const patient = dbServer.select({ id: patients.id }).from(patients).where(and(eq(patients.id, link.patientId), activePatients())).get();
    if (!review) fail('stored_state_invalid');
    if (!patient) fail('patient_missing');
}

/** Persists an immutable association; never resolves patientRef or locates reviews.
 * ADR 0066: create/read require an operationally available (non-tombstoned) patient.
 * Historical links survive deletion; backup/restore/purge access their own tables.
 * patient_missing is an availability denial, not a claim that history is corrupt.
 */
export function createDurableReviewPatientLinkStore() {
    return Object.freeze({
        create(value: unknown): DurableReviewPatientLink {
            const input = linkInput(value);
            schema();
            try {
                return runDbServerImmediateTransaction(() => {
                    const existing = dbServer.select().from(durableReviewPatientLinks)
                        .where(eq(durableReviewPatientLinks.reviewId, input.reviewId)).get();
                    if (existing) {
                        const link = storedLink(existing);
                        verifyOperationalReferences(link);
                        if (link.patientId !== input.patientId) fail('link_conflict');
                        return link;
                    }
                    const review = dbServer.select({ reviewId: durableReviewRecords.reviewId }).from(durableReviewRecords)
                        .where(eq(durableReviewRecords.reviewId, input.reviewId)).get();
                    if (!review) fail('review_missing');
                    const patient = dbServer.select({ id: patients.id }).from(patients).where(and(eq(patients.id, input.patientId), activePatients())).get();
                    if (!patient) fail('patient_missing');
                    dbServer.insert(durableReviewPatientLinks).values(input).run();
                    return input;
                });
            } catch (error) { return storage(error); }
        },
        readByReviewId(value: unknown): DurableReviewPatientLink {
            const reviewId = reviewInput(value);
            schema();
            try {
                const row = dbServer.select().from(durableReviewPatientLinks).where(eq(durableReviewPatientLinks.reviewId, reviewId)).get();
                if (!row) fail('link_missing');
                const link = storedLink(row);
                verifyOperationalReferences(link);
                return link;
            } catch (error) { return storage(error); }
        },
    });
}
