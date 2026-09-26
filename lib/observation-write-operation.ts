/* @Codex: one ordinary observation create/update authority; no generic clinical CRUD or headless path. */
import { and, eq } from 'drizzle-orm';
import { dbServer } from './db-server';
import { activePatients } from './patient-lifecycle';
import { writeAuditEventInTransaction, type RequiredAuditContext } from './security/audit';
import { observations, patients, patientsToAmbulatories, servicePrescriptionItems } from './schema';
import { buildObservationVersionConflictPayload } from './observation-concurrency';

type Tx = Parameters<Parameters<typeof dbServer.transaction>[0]>[0];
type Mode = 'web' | 'v1' | 'network';
type Result = { status: 200 | 201 | 404 | 409 | 422; value: Record<string, unknown> };
type CreateInput = {
    patientId: string; observationId: string; values: typeof observations.$inferInsert; changedFields: string[];
    mode: Mode; scopeAmbulatoryId?: string; audit: RequiredAuditContext;
};
type UpdateInput = {
    patientId?: string; observationId: string; expectedVersion: number;
    values: Partial<typeof observations.$inferInsert>; changedFields: string[];
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

function webLinkError(tx: Tx, patientId: string, servicePrescriptionItemId: string | null | undefined): Result | null {
    if (!servicePrescriptionItemId) return null;
    const item = tx.select({ patientId: servicePrescriptionItems.patientId }).from(servicePrescriptionItems)
        .where(eq(servicePrescriptionItems.id, servicePrescriptionItemId)).get();
    return item?.patientId === patientId ? null : { status: 422,
        value: { error: 'Service prescription item not found or does not belong to observation patient' } };
}

/* @Codex: IMMEDIATE serializes the admission, duplicate check, row insert and required audit. */
export function createObservationOperation(input: CreateInput): Result {
    return dbServer.transaction((tx): Result => {
        const admitted = input.mode === 'network'
            ? networkScopeContains(tx, input.patientId, input.scopeAmbulatoryId!)
                && activeParentExists(tx, input.patientId)
            : activeParentExists(tx, input.patientId);
        if (!admitted) return { status: 404, value: { error: input.mode === 'network' ? 'Not found' : 'Patient not found' } };

        const duplicate = tx.select({ id: observations.id }).from(observations).where(eq(observations.id, input.observationId)).get();
        if (duplicate) return { status: 409, value: { error: 'Conflict' } };
        if (input.mode === 'web') {
            const linkError = webLinkError(tx, input.patientId, input.values.servicePrescriptionItemId);
            if (linkError) return linkError;
        }
        const inserted = tx.insert(observations).values({ ...input.values, id: input.observationId,
            patientId: input.patientId, version: 1 }).run();
        if (inserted.changes !== 1) throw new Error('Observation create did not write exactly one row');
        writeAuditEventInTransaction(tx, {
            eventType: 'observation.created', outcome: 'success',
            actorType: input.audit.actorType, actorRef: input.audit.actorRef,
            subjectType: 'observation', subjectRef: input.observationId,
            sourceSurface: input.audit.sourceSurface, requestId: input.audit.requestId,
            redactedMetadata: { changedFields: input.changedFields, resourceVersion: 1, flags: input.audit.flags },
        });
        return { status: 201, value: { id: input.observationId, version: 1 } };
    }, { behavior: 'immediate' });
}

/* @Codex: a matched UPDATE IGNORE is an integrity fault, not an optimistic 409. */
export function updateObservationOperation(input: UpdateInput): Result {
    return dbServer.transaction((tx): Result => {
        const existing = input.mode === 'network'
            ? tx.select({ observation: observations }).from(observations)
                .innerJoin(patientsToAmbulatories, eq(observations.patientId, patientsToAmbulatories.patientId))
                .where(and(eq(observations.id, input.observationId), eq(observations.patientId, input.patientId!),
                    eq(patientsToAmbulatories.ambulatoryId, input.scopeAmbulatoryId!))).get()?.observation
            : tx.select().from(observations).where(input.mode === 'v1'
                ? and(eq(observations.id, input.observationId), eq(observations.patientId, input.patientId!))
                : eq(observations.id, input.observationId)).get();
        if (!existing) return { status: 404, value: { error: 'Not found' } };
        if (!activeParentExists(tx, existing.patientId)) return { status: 404, value: { error: 'Not found' } };
        if (input.mode === 'web') {
            const linkError = webLinkError(tx, existing.patientId, input.values.servicePrescriptionItemId);
            if (linkError) return linkError;
        }
        if (existing.version !== input.expectedVersion) return { status: 409,
            value: buildObservationVersionConflictPayload(input.expectedVersion, input.observationId, existing) as unknown as Record<string, unknown> };

        const changed = tx.update(observations).set({ ...input.values, version: input.expectedVersion + 1 })
            .where(and(eq(observations.id, input.observationId), eq(observations.patientId, existing.patientId),
                eq(observations.version, input.expectedVersion))).run();
        if (changed.changes !== 1) throw new Error('Observation update did not write exactly one row');
        writeAuditEventInTransaction(tx, {
            eventType: input.values.deletedAt ? 'observation.deleted' : 'observation.updated', outcome: 'success',
            actorType: input.audit.actorType, actorRef: input.audit.actorRef,
            subjectType: 'observation', subjectRef: input.observationId,
            sourceSurface: input.audit.sourceSurface, requestId: input.audit.requestId,
            redactedMetadata: { changedFields: input.changedFields,
                resourceVersion: input.expectedVersion + 1, flags: input.audit.flags },
        });
        return { status: 200, value: { success: true } };
    }, { behavior: 'immediate' });
}
