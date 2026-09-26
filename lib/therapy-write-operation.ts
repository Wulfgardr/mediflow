/* @Codex: one ordinary therapy create/update authority; no generic clinical CRUD or headless path. */
import { and, eq } from 'drizzle-orm';
import { dbServer } from './db-server';
import { activePatients } from './patient-lifecycle';
import { writeAuditEventInTransaction, type RequiredAuditContext } from './security/audit';
import { patients, patientsToAmbulatories, therapies } from './schema';
import { buildTherapyVersionConflictPayload } from './therapy-concurrency';

type Tx = Parameters<Parameters<typeof dbServer.transaction>[0]>[0];
type Mode = 'web' | 'v1' | 'network';
type Result = { status: 200 | 201 | 404 | 409; value: Record<string, unknown> };
type CreateInput = {
    patientId: string; therapyId: string; values: typeof therapies.$inferInsert; changedFields: string[];
    mode: Mode; scopeAmbulatoryId?: string; audit: RequiredAuditContext;
};
type UpdateInput = {
    patientId?: string; therapyId: string; expectedVersion: number;
    values: Partial<typeof therapies.$inferInsert>; changedFields: string[];
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

/* @Codex: IMMEDIATE serializes the admission, duplicate check, row insert and required audit. */
export function createTherapyOperation(input: CreateInput): Result {
    return dbServer.transaction((tx): Result => {
        const admitted = input.mode === 'network'
            ? networkScopeContains(tx, input.patientId, input.scopeAmbulatoryId!)
                && activeParentExists(tx, input.patientId)
            : activeParentExists(tx, input.patientId);
        if (!admitted) return { status: 404, value: { error: input.mode === 'network' ? 'Not found' : 'Patient not found' } };

        const duplicate = tx.select({ id: therapies.id }).from(therapies).where(eq(therapies.id, input.therapyId)).get();
        if (duplicate) return { status: 409, value: { error: 'Conflict' } };
        const inserted = tx.insert(therapies).values(input.values).run();
        if (inserted.changes !== 1) throw new Error('Therapy create did not write exactly one row');
        writeAuditEventInTransaction(tx, {
            eventType: 'therapy.created', outcome: 'success',
            actorType: input.audit.actorType, actorRef: input.audit.actorRef,
            subjectType: 'therapy', subjectRef: input.therapyId,
            sourceSurface: input.audit.sourceSurface, requestId: input.audit.requestId,
            redactedMetadata: { changedFields: input.changedFields, resourceVersion: 1, flags: input.audit.flags },
        });
        return { status: 201, value: { id: input.therapyId, version: 1 } };
    }, { behavior: 'immediate' });
}

/* @Codex: a matched UPDATE IGNORE is an integrity fault, not an optimistic 409. */
export function updateTherapyOperation(input: UpdateInput): Result {
    return dbServer.transaction((tx): Result => {
        const existing = input.mode === 'network'
            ? tx.select({ therapy: therapies }).from(therapies)
                .innerJoin(patientsToAmbulatories, eq(therapies.patientId, patientsToAmbulatories.patientId))
                .where(and(eq(therapies.id, input.therapyId), eq(therapies.patientId, input.patientId!),
                    eq(patientsToAmbulatories.ambulatoryId, input.scopeAmbulatoryId!))).get()?.therapy
            : tx.select().from(therapies).where(input.mode === 'v1'
                ? and(eq(therapies.id, input.therapyId), eq(therapies.patientId, input.patientId!))
                : eq(therapies.id, input.therapyId)).get();
        if (!existing) return { status: 404, value: { error: 'Not found' } };
        if (!activeParentExists(tx, existing.patientId)) return { status: 404, value: { error: 'Not found' } };
        if (existing.version !== input.expectedVersion) return { status: 409,
            value: buildTherapyVersionConflictPayload(input.expectedVersion, input.therapyId, existing) as unknown as Record<string, unknown> };

        const changed = tx.update(therapies).set({ ...input.values, version: input.expectedVersion + 1 })
            .where(and(eq(therapies.id, input.therapyId), eq(therapies.patientId, existing.patientId),
                eq(therapies.version, input.expectedVersion))).run();
        if (changed.changes !== 1) throw new Error('Therapy update did not write exactly one row');
        writeAuditEventInTransaction(tx, {
            eventType: input.values.deletedAt ? 'therapy.deleted' : 'therapy.updated', outcome: 'success',
            actorType: input.audit.actorType, actorRef: input.audit.actorRef,
            subjectType: 'therapy', subjectRef: input.therapyId,
            sourceSurface: input.audit.sourceSurface, requestId: input.audit.requestId,
            redactedMetadata: { changedFields: input.changedFields,
                resourceVersion: input.expectedVersion + 1, flags: input.audit.flags },
        });
        return { status: 200, value: { success: true } };
    }, { behavior: 'immediate' });
}
