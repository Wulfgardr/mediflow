/* @Codex */
import 'server-only';
import { types } from 'node:util';
import { and, eq, or } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { isDocumentSourceRef } from './attachment-currentness';
import { attachments } from './schema';

type Host = Readonly<{ database: BetterSQLite3Database; runImmediateTransaction<T>(operation: () => T): T }>;

type Request = Readonly<{ id: string; documentSourceRef: string; expectedRevision: number; expectedFreshnessEpoch: number }>;

type Receipt = Readonly<{ documentSourceRef: string; documentRevision: number; documentFreshnessEpoch: number }>;

export type AttachmentCurrentnessCasCode = 'invalid_request' | 'missing' | 'identity_mismatch' | 'stale'
    | 'cardinality_violation' | 'counter_unavailable' | 'mutation_failed' | 'operation_reentered'
    | 'storage_unavailable';

export type AttachmentCurrentnessCasOutcome =
    | Readonly<{ status: 'committed'; receipt: Receipt }>
    | Readonly<{ status: 'denied'; code: AttachmentCurrentnessCasCode }>;

const REQUEST_KEYS = ['id', 'documentSourceRef', 'expectedRevision', 'expectedFreshnessEpoch'] as const;
const denied = (code: AttachmentCurrentnessCasCode): AttachmentCurrentnessCasOutcome => Object.freeze({ status: 'denied', code });
const activeHosts = new WeakMap<object, { reentered: boolean }>();

class Rollback extends Error { constructor(readonly code: AttachmentCurrentnessCasCode) { super('Attachment currentness mutation denied.'); } }

function parseRequest(value: unknown): Request | null {
    if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== REQUEST_KEYS.length || !REQUEST_KEYS.every((key) => {
        const descriptor = descriptors[key];
        return descriptor !== undefined && 'value' in descriptor && descriptor.enumerable;
    })) return null;
    const request = value as Record<string, unknown>;
    const id = request.id;
    const revision = request.expectedRevision;
    const epoch = request.expectedFreshnessEpoch;
    if (typeof id !== 'string' || id.length < 1 || id.length > 256 || id.trim() !== id || /[\u0000-\u001f\u007f]/u.test(id)
        || !isDocumentSourceRef(request.documentSourceRef)
        || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1
        || typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 1) return null;
    return Object.freeze({ id, documentSourceRef: request.documentSourceRef, expectedRevision: revision, expectedFreshnessEpoch: epoch });
}

export function createAttachmentCurrentnessCas(host: Host) {
    return Object.freeze({
        mutate(value: unknown, mutation: unknown): AttachmentCurrentnessCasOutcome {
            const request = parseRequest(value);
            if (!request || typeof mutation !== 'function' || types.isProxy(mutation) || types.isAsyncFunction(mutation)) return denied('invalid_request');
            if (request.expectedRevision === Number.MAX_SAFE_INTEGER || request.expectedFreshnessEpoch === Number.MAX_SAFE_INTEGER) {
                return denied('counter_unavailable');
            }
            const existing = activeHosts.get(host.database);
            if (existing) { existing.reentered = true; return denied('operation_reentered'); }
            const state = { reentered: false };
            activeHosts.set(host.database, state);
            try { return host.runImmediateTransaction(() => {
                const candidates = host.database.select({
                    id: attachments.id,
                    documentSourceRef: attachments.documentSourceRef,
                    documentRevision: attachments.documentRevision,
                    documentFreshnessEpoch: attachments.documentFreshnessEpoch,
                }).from(attachments).where(or(
                    eq(attachments.id, request.id),
                    eq(attachments.documentSourceRef, request.documentSourceRef),
                )).all();
                if (candidates.length === 0) return denied('missing');
                if (candidates.length !== 1) return denied('cardinality_violation');
                const current = candidates[0]!;
                if (current.id !== request.id || current.documentSourceRef !== request.documentSourceRef) {
                    return denied('identity_mismatch');
                }
                if (current.documentRevision !== request.expectedRevision || current.documentFreshnessEpoch !== request.expectedFreshnessEpoch) {
                    return denied('stale');
                }
                let result: unknown;
                try { result = (mutation as (database: BetterSQLite3Database) => unknown)(host.database); }
                catch { throw new Rollback('mutation_failed'); }
                if (state.reentered) throw new Rollback('operation_reentered');
                if (!result || typeof result !== 'object' || Array.isArray(result) || types.isProxy(result) || Object.getPrototypeOf(result) !== Object.prototype) {
                    throw new Rollback('mutation_failed');
                }
                const descriptors = Object.getOwnPropertyDescriptors(result);
                const changesDescriptor = descriptors.changes;
                if (Reflect.ownKeys(descriptors).length !== 1 || !changesDescriptor || !('value' in changesDescriptor)
                    || !changesDescriptor.enumerable || !Number.isSafeInteger(changesDescriptor.value)) throw new Rollback('mutation_failed');
                if (changesDescriptor.value !== 1) throw new Rollback('cardinality_violation');
                const after = host.database.select({
                    documentSourceRef: attachments.documentSourceRef,
                    documentRevision: attachments.documentRevision,
                    documentFreshnessEpoch: attachments.documentFreshnessEpoch,
                }).from(attachments).where(eq(attachments.id, request.id)).get();
                if (!after || after.documentSourceRef !== request.documentSourceRef
                    || after.documentRevision !== request.expectedRevision
                    || after.documentFreshnessEpoch !== request.expectedFreshnessEpoch) throw new Rollback('stale');
                const documentRevision = request.expectedRevision + 1;
                const documentFreshnessEpoch = request.expectedFreshnessEpoch + 1;
                const advanced = host.database.update(attachments).set({ documentRevision, documentFreshnessEpoch }).where(and(
                    eq(attachments.id, request.id),
                    eq(attachments.documentSourceRef, request.documentSourceRef),
                    eq(attachments.documentRevision, request.expectedRevision),
                    eq(attachments.documentFreshnessEpoch, request.expectedFreshnessEpoch),
                )).run();
                if (advanced.changes !== 1) throw new Rollback('stale');
                const receipt = Object.freeze({
                    documentSourceRef: request.documentSourceRef,
                    documentRevision,
                    documentFreshnessEpoch,
                });
                return Object.freeze({ status: 'committed' as const, receipt });
            }); } catch (error) {
                return denied(error instanceof Rollback ? error.code : 'storage_unavailable');
            } finally { activeHosts.delete(host.database); }
        },
    });
}
