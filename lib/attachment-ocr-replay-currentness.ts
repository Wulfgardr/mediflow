/* @Codex */
import 'server-only';
import { types } from 'node:util';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createAttachmentCurrentnessCas, type AttachmentCurrentnessCasCode } from './attachment-currentness-cas';
import { isDocumentSourceRef } from './attachment-currentness';
import {
    canTransitionDocumentOcrQueueState,
    isDocumentOcrQueueReason,
    isDocumentOcrQueueState,
    type DocumentOcrQueueState,
    type HostDocumentOcrQueueReason,
} from './domain/documents/document-ocr-queue';
import { attachments } from './schema';
type Host = Readonly<{ database: BetterSQLite3Database; runImmediateTransaction<T>(operation: () => T): T }>;
type Snapshot = Readonly<{
    id: string; documentSourceRef: string; documentRevision: number; documentFreshnessEpoch: number;
    ocrQueueState: DocumentOcrQueueState; ocrQueueReason: HostDocumentOcrQueueReason | null;
    ocrReplayArtifactSnapshot: string | null;
}>;
type Transition = Readonly<{
    outcome: 'applied' | 'duplicate'; nextState: 'ocr_done' | 'ocr_failed';
    artifactSnapshot: string; updatedAtMs: number;
}>;
export type AttachmentOcrReplayCurrentnessOutcome = Readonly<{ status: 'updated' | 'not_found' | 'conflict' | 'failed' }>;
const SNAPSHOT_KEYS = ['id', 'documentSourceRef', 'documentRevision', 'documentFreshnessEpoch', 'ocrQueueState', 'ocrQueueReason', 'ocrReplayArtifactSnapshot'] as const;
const TRANSITION_KEYS = ['outcome', 'nextState', 'artifactSnapshot', 'updatedAtMs'] as const;
const outcome = (status: AttachmentOcrReplayCurrentnessOutcome['status']): AttachmentOcrReplayCurrentnessOutcome => Object.freeze({ status });
function exactDataRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)
        || Object.getPrototypeOf(value) !== Object.prototype) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Reflect.ownKeys(descriptors).length === keys.length && keys.every((key) => {
        const descriptor = descriptors[key];
        return descriptor !== undefined && descriptor.enumerable && 'value' in descriptor;
    });
}
function parseSnapshot(value: unknown): Snapshot | null {
    if (!exactDataRecord(value, SNAPSHOT_KEYS) || typeof value.id !== 'string'
        || !isDocumentSourceRef(value.documentSourceRef)
        || !Number.isSafeInteger(value.documentRevision) || (value.documentRevision as number) < 1
        || !Number.isSafeInteger(value.documentFreshnessEpoch) || (value.documentFreshnessEpoch as number) < 1
        || !isDocumentOcrQueueState(value.ocrQueueState)
        || !(value.ocrQueueReason === null || isDocumentOcrQueueReason(value.ocrQueueReason))
        || !(value.ocrReplayArtifactSnapshot === null || typeof value.ocrReplayArtifactSnapshot === 'string')) return null;
    return Object.freeze({ ...value }) as Snapshot;
}
function parseTransition(value: unknown): Transition | null {
    if (!exactDataRecord(value, TRANSITION_KEYS)
        || (value.outcome !== 'applied' && value.outcome !== 'duplicate')
        || (value.nextState !== 'ocr_done' && value.nextState !== 'ocr_failed')
        || typeof value.artifactSnapshot !== 'string' || value.artifactSnapshot.length < 1
        || !Number.isSafeInteger(value.updatedAtMs) || (value.updatedAtMs as number) < 0) return null;
    return Object.freeze({ ...value }) as Transition;
}
function mapDenied(code: AttachmentCurrentnessCasCode): AttachmentOcrReplayCurrentnessOutcome {
    if (code === 'missing') return outcome('not_found');
    if (['identity_mismatch', 'stale', 'cardinality_violation', 'counter_unavailable', 'operation_reentered'].includes(code)) return outcome('conflict');
    return outcome('failed');
}

export function createAttachmentOcrReplayCurrentness(host: Host) {
    const cas = createAttachmentCurrentnessCas(host);
    return Object.freeze({
        commit(snapshotValue: unknown, transitionValue: unknown): AttachmentOcrReplayCurrentnessOutcome {
            const snapshot = parseSnapshot(snapshotValue);
            const transition = parseTransition(transitionValue);
            if (!snapshot || !transition) return outcome('failed');
            if (transition.outcome === 'duplicate') {
                if (snapshot.ocrReplayArtifactSnapshot === null
                    || snapshot.ocrReplayArtifactSnapshot !== transition.artifactSnapshot
                    || !canTransitionDocumentOcrQueueState(snapshot.ocrQueueState, transition.nextState)) return outcome('conflict');
            } else if (snapshot.ocrQueueState !== 'processing'
                && !canTransitionDocumentOcrQueueState(snapshot.ocrQueueState, 'processing')) return outcome('conflict');
            const result = cas.mutate({
                id: snapshot.id, documentSourceRef: snapshot.documentSourceRef,
                expectedRevision: snapshot.documentRevision,
                expectedFreshnessEpoch: snapshot.documentFreshnessEpoch,
            }, (database: BetterSQLite3Database) => {
                const changes = database.update(attachments).set({
                    ocrQueueState: transition.nextState,
                    ocrQueueUpdatedAt: new Date(transition.updatedAtMs),
                    ...(transition.outcome === 'applied' ? { ocrReplayArtifactSnapshot: transition.artifactSnapshot } : {}),
                }).where(eq(attachments.id, snapshot.id)).run().changes;
                return { changes };
            });
            return result.status === 'committed' ? outcome('updated') : mapDenied(result.code);
        },
    });
}
