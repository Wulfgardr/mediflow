/* @Codex: one ordinary checkup create/update authority; no generic clinical CRUD or headless path. */
import { and, eq } from 'drizzle-orm';
import { dbServer } from './db-server';
import { activePatients } from './patient-lifecycle';
import { writeAuditEventInTransaction, type RequiredAuditContext } from './security/audit';
import { checkups, patients, patientsToAmbulatories } from './schema';
import { buildCheckupVersionConflictPayload } from './checkup-concurrency';

type Tx = Parameters<Parameters<typeof dbServer.transaction>[0]>[0];
type Mode = 'web' | 'v1' | 'network';
type Result = { status: 200 | 201 | 404 | 409; value: Record<string, unknown> };
type CreateInput = {
    patientId: string; checkupId: string; values: typeof checkups.$inferInsert; changedFields: string[];
    mode: Mode; scopeAmbulatoryId?: string; audit: RequiredAuditContext;
};
type UpdateInput = {
    patientId?: string; checkupId: string; expectedVersion: number;
    values: Partial<typeof checkups.$inferInsert>; changedFields: string[];
    mode: Mode; scopeAmbulatoryId?: string; audit: RequiredAuditContext;
};

function networkScopeContains(tx: Tx, patientId: string, ambulatoryId: string): boolean {
    return Boolean(tx.select({ patientId: patientsToAmbulatories.patientId })
        .from(patientsToAmbulatories).where(and(eq(patientsToAmbulatories.patientId, patientId),
            eq(patientsToAmbulatories.ambulatoryId, ambulatoryId))).get());
}

function activeParentExists(tx: Tx, patientId: string): boolean {
    return Boolean(tx.select({ id: patients.id }).from(patients)
        .where(and(eq(patients.id, patientId), activePatients())).get());
}

/* @Codex: IMMEDIATE serializes the admission, row insert and required audit. */
export function createCheckupOperation(input: CreateInput): Result {
    return dbServer.transaction((tx): Result => {
        const admitted = input.mode === 'network'
            ? networkScopeContains(tx, input.patientId, input.scopeAmbulatoryId!)
                && activeParentExists(tx, input.patientId)
            : activeParentExists(tx, input.patientId);
        if (!admitted) return { status: 404, value: { error: input.mode === 'network' ? 'Not found' : 'Patient not found' } };

        const inserted = tx.insert(checkups).values({ ...input.values, id: input.checkupId,
            patientId: input.patientId, version: 1 }).run();
        if (inserted.changes !== 1) throw new Error('Checkup create did not write exactly one row');
        writeAuditEventInTransaction(tx, {
            eventType: 'checkup.created', outcome: 'success',
            actorType: input.audit.actorType, actorRef: input.audit.actorRef,
            subjectType: 'checkup', subjectRef: input.checkupId,
            sourceSurface: input.audit.sourceSurface, requestId: input.audit.requestId,
            redactedMetadata: { changedFields: input.changedFields, resourceVersion: 1, flags: input.audit.flags },
        });
        return { status: 201, value: { id: input.checkupId, version: 1 } };
    }, { behavior: 'immediate' });
}

/* @Codex: a matched UPDATE IGNORE is an integrity fault, not an optimistic 409. */
export function updateCheckupOperation(input: UpdateInput): Result {
    return dbServer.transaction((tx): Result => {
        const existing = input.mode === 'network'
            ? tx.select({ checkup: checkups }).from(checkups)
                .innerJoin(patientsToAmbulatories, eq(checkups.patientId, patientsToAmbulatories.patientId))
                .where(and(eq(checkups.id, input.checkupId), eq(checkups.patientId, input.patientId!),
                    eq(patientsToAmbulatories.ambulatoryId, input.scopeAmbulatoryId!))).get()?.checkup
            : tx.select().from(checkups).where(input.mode === 'v1'
                ? and(eq(checkups.id, input.checkupId), eq(checkups.patientId, input.patientId!))
                : eq(checkups.id, input.checkupId)).get();
        if (!existing) return { status: 404, value: { error: 'Not found' } };
        if (!activeParentExists(tx, existing.patientId)) return { status: 404, value: { error: 'Not found' } };
        if (existing.version !== input.expectedVersion) return { status: 409,
            value: buildCheckupVersionConflictPayload(input.expectedVersion, input.checkupId, existing) as unknown as Record<string, unknown> };

        const changed = tx.update(checkups).set({ ...input.values, version: input.expectedVersion + 1 })
            .where(and(eq(checkups.id, input.checkupId), eq(checkups.patientId, existing.patientId),
                eq(checkups.version, input.expectedVersion))).run();
        if (changed.changes !== 1) throw new Error('Checkup update did not write exactly one row');
        writeAuditEventInTransaction(tx, {
            eventType: input.values.deletedAt ? 'checkup.deleted' : 'checkup.updated', outcome: 'success',
            actorType: input.audit.actorType, actorRef: input.audit.actorRef,
            subjectType: 'checkup', subjectRef: input.checkupId,
            sourceSurface: input.audit.sourceSurface, requestId: input.audit.requestId,
            redactedMetadata: { changedFields: input.changedFields,
                resourceVersion: input.expectedVersion + 1, flags: input.audit.flags },
        });
        return { status: 200, value: { success: true } };
    }, { behavior: 'immediate' });
}
