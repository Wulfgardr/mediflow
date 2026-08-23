/* @Codex */
import 'server-only';
import { types } from 'node:util';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
    createAttachmentCurrentnessCas,
    type AttachmentCurrentnessCasCode,
} from './attachment-currentness-cas';
import { isDocumentSourceRef } from './attachment-currentness';

type Host = Readonly<{
    database: BetterSQLite3Database;
    runImmediateTransaction<T>(operation: () => T): T;
}>;

type Snapshot = Readonly<{
    id: string;
    documentSourceRef: string;
    documentRevision: number;
    documentFreshnessEpoch: number;
}>;

type Mutation = (database: BetterSQLite3Database) => unknown;

export type AttachmentWebPutOutcome =
    | Readonly<{ status: 'updated' }>
    | Readonly<{ status: 'not_found' }>
    | Readonly<{ status: 'conflict' }>
    | Readonly<{ status: 'failed' }>;

const SNAPSHOT_KEYS = ['id', 'documentSourceRef', 'documentRevision', 'documentFreshnessEpoch'] as const;
const outcome = (status: AttachmentWebPutOutcome['status']): AttachmentWebPutOutcome => Object.freeze({ status });

function parseSnapshot(value: unknown): Snapshot | null {
    if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)
        || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== SNAPSHOT_KEYS.length || !SNAPSHOT_KEYS.every((key) => {
        const descriptor = descriptors[key];
        return descriptor !== undefined && descriptor.enumerable && 'value' in descriptor;
    })) return null;
    const snapshot = value as Record<string, unknown>;
    if (typeof snapshot.id !== 'string' || !isDocumentSourceRef(snapshot.documentSourceRef)
        || !Number.isSafeInteger(snapshot.documentRevision) || (snapshot.documentRevision as number) < 1
        || !Number.isSafeInteger(snapshot.documentFreshnessEpoch) || (snapshot.documentFreshnessEpoch as number) < 1) return null;
    return Object.freeze({
        id: snapshot.id,
        documentSourceRef: snapshot.documentSourceRef,
        documentRevision: snapshot.documentRevision,
        documentFreshnessEpoch: snapshot.documentFreshnessEpoch,
    }) as Snapshot;
}

function mapDenied(code: AttachmentCurrentnessCasCode): AttachmentWebPutOutcome {
    switch (code) {
        case 'missing': return outcome('not_found');
        case 'identity_mismatch':
        case 'stale':
        case 'cardinality_violation':
        case 'counter_unavailable':
        case 'operation_reentered': return outcome('conflict');
        case 'invalid_request':
        case 'mutation_failed':
        case 'storage_unavailable': return outcome('failed');
        default: return code satisfies never;
    }
}

export function createAttachmentWebPutCurrentness(host: Host) {
    const cas = createAttachmentCurrentnessCas(host);
    return Object.freeze({
        mutate(snapshotValue: unknown, mutation: Mutation): AttachmentWebPutOutcome {
            const snapshot = parseSnapshot(snapshotValue);
            if (!snapshot) return outcome('failed');
            const result = cas.mutate({
                id: snapshot.id,
                documentSourceRef: snapshot.documentSourceRef,
                expectedRevision: snapshot.documentRevision,
                expectedFreshnessEpoch: snapshot.documentFreshnessEpoch,
            }, mutation);
            return result.status === 'committed' ? outcome('updated') : mapDenied(result.code);
        },
    });
}
