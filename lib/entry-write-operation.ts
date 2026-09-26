/* @Codex: one ordinary diary create/update authority; no headless receipt or generic CRUD path. */
import { and, eq } from 'drizzle-orm';
import { dbServer } from './db-server';
import { buildEntryVersionConflictPayload } from './entry-concurrency';
import { activePatients } from './patient-lifecycle';
import { writeAuditEventInTransaction, type RequiredAuditContext } from './security/audit';
import { entries, patients, patientsToAmbulatories } from './schema';

type CreateInput = {
    patientId: string;
    id: string;
    values: typeof entries.$inferInsert;
    changedFields: string[];
    mode: 'web' | 'v1' | 'network';
    scopeAmbulatoryId?: string;
    audit: RequiredAuditContext;
};

type UpdateInput = {
    patientId?: string;
    entryId: string;
    expectedVersion: number;
    values: Partial<typeof entries.$inferInsert>;
    changedFields: string[];
    mode: 'web' | 'v1' | 'network';
    scopeAmbulatoryId?: string;
    audit: RequiredAuditContext;
};

type Result = { status: 200 | 201 | 404 | 409; value: Record<string, unknown> };
type Tx = Parameters<Parameters<typeof dbServer.transaction>[0]>[0];

function networkScopeContains(tx: Tx, patientId: string, ambulatoryId: string): boolean {
    return Boolean(tx.select({ patientId: patientsToAmbulatories.patientId })
        .from(patientsToAmbulatories)
        .where(and(eq(patientsToAmbulatories.patientId, patientId),
            eq(patientsToAmbulatories.ambulatoryId, ambulatoryId))).get());
}

function activeParentExists(tx: Tx, patientId: string): boolean {
    return Boolean(tx.select({ id: patients.id }).from(patients)
        .where(and(eq(patients.id, patientId), activePatients())).get());
}

function sameNetworkCreate(existing: typeof entries.$inferSelect, values: typeof entries.$inferInsert): boolean {
    return existing.patientId === values.patientId && existing.type === values.type
        && existing.title === values.title && existing.date.getTime() === values.date.getTime()
        && existing.content === values.content && existing.setting === values.setting
        && existing.metadata === values.metadata && existing.attachments === values.attachments
        && existing.deletedAt === null;
}

/* @Codex: IMMEDIATE acquires the writer lock before parent/scope and duplicate reads. */
export function createEntryOperation(input: CreateInput): Result {
    return dbServer.transaction((tx): Result => {
        const admitted = input.mode === 'network'
            ? networkScopeContains(tx, input.patientId, input.scopeAmbulatoryId!)
                && activeParentExists(tx, input.patientId)
            : activeParentExists(tx, input.patientId);
        if (!admitted) return { status: 404, value: { error: input.mode === 'network' ? 'Not found' : 'Patient not found' } };

        const existing = tx.select().from(entries).where(eq(entries.id, input.id)).get();
        if (existing) {
            if (input.mode === 'network' && sameNetworkCreate(existing, input.values)) {
                return { status: 200, value: { id: existing.id, version: existing.version, idempotent: true } };
            }
            return { status: 409, value: { error: input.mode === 'network'
                ? 'Network diary create id already exists with different content' : 'Conflict' } };
        }

        const inserted = tx.insert(entries).values(input.values).run();
        if (inserted.changes !== 1) throw new Error('Entry create did not write exactly one row');
        writeAuditEventInTransaction(tx, {
            eventType: 'entry.created', outcome: 'success',
            actorType: input.audit.actorType, actorRef: input.audit.actorRef,
            subjectType: 'entry', subjectRef: input.id,
            sourceSurface: input.audit.sourceSurface, requestId: input.audit.requestId,
            redactedMetadata: { changedFields: input.changedFields, resourceVersion: 1, flags: input.audit.flags },
        });
        return { status: 201, value: input.mode === 'web' ? { id: input.id, version: 1 }
            : input.mode === 'v1' ? { id: input.id } : { id: input.id, version: 1 } };
    }, { behavior: 'immediate' });
}

/* @Codex: matched UPDATE IGNORE is an integrity fault, not an optimistic conflict. */
export function updateEntryOperation(input: UpdateInput): Result {
    return dbServer.transaction((tx): Result => {
        const existing = input.mode === 'network'
            ? tx.select({ entry: entries }).from(entries)
                .innerJoin(patientsToAmbulatories, eq(entries.patientId, patientsToAmbulatories.patientId))
                .where(and(eq(entries.id, input.entryId), eq(entries.patientId, input.patientId!),
                    eq(patientsToAmbulatories.ambulatoryId, input.scopeAmbulatoryId!))).get()?.entry
            : tx.select().from(entries)
                .where(input.mode === 'v1'
                    ? and(eq(entries.id, input.entryId), eq(entries.patientId, input.patientId!))
                    : eq(entries.id, input.entryId)).get();
        if (!existing) return { status: 404, value: { error: 'Not found' } };
        if (!activeParentExists(tx, existing.patientId)) return { status: 404, value: { error: 'Not found' } };
        if (existing.version !== input.expectedVersion) {
            return { status: 409, value: buildEntryVersionConflictPayload(
                input.expectedVersion, input.entryId, existing) as unknown as Record<string, unknown> };
        }
        const changed = tx.update(entries).set({ ...input.values, version: input.expectedVersion + 1 })
            .where(and(eq(entries.id, input.entryId), eq(entries.patientId, existing.patientId),
                eq(entries.version, input.expectedVersion))).run();
        if (changed.changes !== 1) throw new Error('Entry update did not write exactly one row');
        writeAuditEventInTransaction(tx, {
            eventType: input.values.deletedAt ? 'entry.deleted' : 'entry.updated', outcome: 'success',
            actorType: input.audit.actorType, actorRef: input.audit.actorRef,
            subjectType: 'entry', subjectRef: input.entryId,
            sourceSurface: input.audit.sourceSurface, requestId: input.audit.requestId,
            redactedMetadata: { changedFields: input.changedFields,
                resourceVersion: input.expectedVersion + 1, flags: input.audit.flags },
        });
        return { status: 200, value: { success: true } };
    }, { behavior: 'immediate' });
}
