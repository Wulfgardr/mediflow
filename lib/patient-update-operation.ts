/* @Codex: WUL-718 one authoritative patient-profile update and membership commit. */
import { and, eq } from 'drizzle-orm';
import { dbServer } from './db-server';
import { buildPatientVersionConflictPayload } from './patient-concurrency';
import { activePatients } from './patient-lifecycle';
import { upsertPrimaryAmbulatoryMembership } from './patient-ambulatory-membership';
import {
    classifyPatientMutationEvent,
    writeAuditEventInTransaction,
    type RequiredAuditContext,
} from './security/audit';
import { patients, patientsToAmbulatories } from './schema';

type PatientUpdateValues = Partial<typeof patients.$inferInsert>;

type PatientUpdateOperationInput = {
    patientId: string;
    expectedVersion: number;
    values: PatientUpdateValues;
    setPrimaryAmbulatory: boolean;
    // Present only after the network adapter has authorized the effective scope.
    scopeAmbulatoryId?: string;
    audit: RequiredAuditContext;
};

export type PatientUpdateOperationResult =
    | { status: 200; value: { success: true }; existing: typeof patients.$inferSelect }
    | { status: 404 | 409; value: Record<string, unknown> };

/* @Codex */
export function updatePatientOperation(input: PatientUpdateOperationInput): PatientUpdateOperationResult {
    // better-sqlite3/Drizzle callback stays synchronous. Patient, membership and
    // required audit either commit together or all roll back; no second writer.
    return dbServer.transaction((tx): PatientUpdateOperationResult => {
        const condition = and(
            eq(patients.id, input.patientId),
            activePatients(),
            ...(input.scopeAmbulatoryId === undefined ? [] : [
                eq(patientsToAmbulatories.ambulatoryId, input.scopeAmbulatoryId),
            ]),
        );
        const existing = input.scopeAmbulatoryId === undefined
            ? tx.select().from(patients).where(condition).get()
            : tx.select({ patient: patients }).from(patients)
                .innerJoin(patientsToAmbulatories, eq(patients.id, patientsToAmbulatories.patientId))
                .where(condition).get()?.patient;

        if (!existing) return { status: 404, value: { error: 'Not found' } };

        const updated = tx.update(patients).set({ ...input.values, version: input.expectedVersion + 1 })
            .where(and(eq(patients.id, input.patientId), eq(patients.version, input.expectedVersion), activePatients()))
            .run();
        if (updated.changes === 0) {
            const current = tx.select({
                id: patients.id, version: patients.version,
                updatedAt: patients.updatedAt, isArchived: patients.isArchived,
            }).from(patients)
                .where(and(eq(patients.id, input.patientId), activePatients()))
                .get();
            return {
                status: 409,
                value: buildPatientVersionConflictPayload(input.expectedVersion, input.patientId, current ?? null),
            };
        }

        if (input.setPrimaryAmbulatory) {
            upsertPrimaryAmbulatoryMembership(tx, input.patientId, input.values.ambulatoryId);
        }
        writeAuditEventInTransaction(tx, {
            eventType: classifyPatientMutationEvent(existing.isArchived ?? null, input.values.isArchived as boolean | undefined),
            outcome: 'success',
            actorType: input.audit.actorType,
            actorRef: input.audit.actorRef,
            subjectType: 'patient',
            subjectRef: input.patientId,
            sourceSurface: input.audit.sourceSurface,
            requestId: input.audit.requestId,
            redactedMetadata: {
                changedFields: Object.entries(input.values)
                    .filter(([key, value]) => key !== 'version' && key !== 'updatedAt' && value !== undefined)
                    .map(([key]) => key),
                resourceVersion: input.expectedVersion + 1,
                flags: input.audit.flags,
            },
        });
        return { status: 200, value: { success: true }, existing };
    }, { behavior: 'immediate' });
}
