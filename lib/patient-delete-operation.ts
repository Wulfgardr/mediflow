/* @Codex: WUL-720 one authoritative patient tombstone and required audit commit. */
import { and, eq } from 'drizzle-orm';
import { dbServer } from './db-server';
import { buildPatientVersionConflictPayload } from './patient-concurrency';
import { activePatients, buildPatientTombstoneValues } from './patient-lifecycle';
import { writeAuditEventInTransaction, type RequiredAuditContext } from './security/audit';
import { patients } from './schema';

type PatientDeleteOperationInput = {
    patientId: string;
    expectedVersion: number;
    deletionReason: string;
    audit: RequiredAuditContext;
};

export type PatientDeleteOperationResult =
    | { status: 200; value: { success: true } }
    | { status: 404 | 409; value: Record<string, unknown> };

/* @Codex: IMMEDIATE acquires the writer lock before the active/version read. */
export function deletePatientOperation(input: PatientDeleteOperationInput): PatientDeleteOperationResult {
    return dbServer.transaction((tx): PatientDeleteOperationResult => {
        const existing = tx.select({ id: patients.id }).from(patients)
            .where(and(eq(patients.id, input.patientId), activePatients())).get();
        if (!existing) return { status: 404, value: { error: 'Not found' } };

        const deleted = tx.update(patients)
            .set(buildPatientTombstoneValues(input.expectedVersion, input.deletionReason))
            .where(and(eq(patients.id, input.patientId), eq(patients.version, input.expectedVersion), activePatients()))
            .run();
        if (deleted.changes === 0) {
            const current = tx.select({
                id: patients.id, version: patients.version,
                updatedAt: patients.updatedAt, isArchived: patients.isArchived,
            }).from(patients).where(and(eq(patients.id, input.patientId), activePatients())).get();
            return { status: 409,
                value: buildPatientVersionConflictPayload(input.expectedVersion, input.patientId, current ?? null) };
        }

        writeAuditEventInTransaction(tx, {
            eventType: 'patient.deleted', outcome: 'success',
            actorType: input.audit.actorType, actorRef: input.audit.actorRef,
            subjectType: 'patient', subjectRef: input.patientId,
            sourceSurface: input.audit.sourceSurface, requestId: input.audit.requestId,
            redactedMetadata: { resourceVersion: input.expectedVersion + 1, flags: input.audit.flags },
        });
        return { status: 200, value: { success: true } };
    }, { behavior: 'immediate' });
}
