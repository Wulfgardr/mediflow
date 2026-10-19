/* WUL-718 one authoritative patient-profile update and membership commit. */
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
import { PATIENT_PROFILE_UPDATE_OPERATION, type PatientProfileUpdateContract, type PatientProfileUpdateEnvelope } from './patient-profile-update-contract';
import type { NetworkPatientCommitGuard, NetworkPatientCommitDenial } from './network-patient-commit-authority';
import { createProfileNotesCommitJournal, profileNotesCommitKey, readProfileNotesCommitReceipt, ProfileNotesCommitError,
    type ProfileNotesCommitPermit } from './security/patient-profile-notes-commit-journal';
import type { ProfileNotesCommitReceipt } from '../packages/patient-profile-contracts/src/notes-commit';

type PatientUpdateValues = Partial<typeof patients.$inferInsert>;

type PatientUpdateOperationInput = PatientProfileUpdateContract & {
    patientId: string;
    expectedVersion: number;
    values: PatientUpdateValues;
    setPrimaryAmbulatory: boolean;
    // Present only after the network adapter has authorized the effective scope.
    scopeAmbulatoryId?: string;
    audit: RequiredAuditContext;
    authorizeCommit?: NetworkPatientCommitGuard;
    reviewedNotes?: Readonly<{ command: PatientProfileUpdateEnvelope; permit: ProfileNotesCommitPermit }>;
};

export type PatientUpdateOperationResult =
    | { status: 200; value: { success: true }; existing: typeof patients.$inferSelect; receipt?: ProfileNotesCommitReceipt }
    | { status: 404 | 409; value: Record<string, unknown> }
    | NetworkPatientCommitDenial;

export function updatePatientOperation(input: PatientUpdateOperationInput): PatientUpdateOperationResult {
    if (input.operationId !== PATIENT_PROFILE_UPDATE_OPERATION.id
        || input.contractVersion !== PATIENT_PROFILE_UPDATE_OPERATION.version) {
        throw new Error('Unsupported patient profile update operation');
    }
    const reviewed = input.reviewedNotes;
    const key = reviewed ? profileNotesCommitKey(reviewed.command, reviewed.permit, input.audit) : null;
    if (reviewed && (input.patientId !== reviewed.command.target.patientId || input.expectedVersion !== reviewed.command.target.expectedVersion
        || input.scopeAmbulatoryId !== undefined || input.authorizeCommit !== undefined || input.setPrimaryAmbulatory
        || input.values.notes !== reviewed.command.payload.notes || input.values.updatedAt?.toISOString() !== reviewed.command.normalizedAt
        || Object.entries(input.values).some(([field, value]) => value !== undefined && !['notes', 'version', 'updatedAt'].includes(field)))) {
        throw new ProfileNotesCommitError('commit_denied');
    }
    const scopeAmbulatoryId = reviewed?.permit.ambulatoryId ?? input.scopeAmbulatoryId;
    const replay = key && reviewed ? { reference: key.reference, digest: key.digest, commandDigest: key.commandDigest,
        actorRef: input.audit.actorRef, patientId: input.patientId, ambulatoryId: reviewed.permit.ambulatoryId,
        archiveGeneration: input.audit.archiveGeneration } : null;
    // better-sqlite3/Drizzle callback stays synchronous. Patient, membership and
    // required audit either commit together or all roll back; no second writer.
    return dbServer.transaction((tx): PatientUpdateOperationResult => {
        const denied = input.authorizeCommit?.(tx);
        if (denied) return denied;
        if (reviewed && reviewed.permit.authorizeCommit(tx) !== true) throw new ProfileNotesCommitError('commit_denied');
        const condition = and(
            eq(patients.id, input.patientId),
            activePatients(),
            ...(scopeAmbulatoryId === undefined ? [] : [
                eq(patientsToAmbulatories.ambulatoryId, scopeAmbulatoryId),
            ]),
        );
        const existing = scopeAmbulatoryId === undefined
            ? tx.select().from(patients).where(condition).get()
            : tx.select({ patient: patients }).from(patients)
                .innerJoin(patientsToAmbulatories, eq(patients.id, patientsToAmbulatories.patientId))
                .where(condition).get()?.patient;

        if (!existing) return { status: 404, value: { error: 'Not found' } };

        const prior = replay ? readProfileNotesCommitReceipt(tx, replay) : null;
        if (prior) return { status: 200, value: { success: true }, existing, receipt: prior };

        if (existing.version !== input.expectedVersion) return { status: 409,
            value: buildPatientVersionConflictPayload(input.expectedVersion, input.patientId, existing) };
        if (existing.version >= Number.MAX_SAFE_INTEGER) return { status: 409,
            value: buildPatientVersionConflictPayload(input.expectedVersion, input.patientId, existing) };

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
        const journal = key ? createProfileNotesCommitJournal(key, Date.now()) : undefined;
        writeAuditEventInTransaction(tx, {
            eventType: classifyPatientMutationEvent(existing.isArchived ?? null, input.values.isArchived as boolean | undefined),
            outcome: 'success',
            archiveGeneration: input.audit.archiveGeneration, actorType: input.audit.actorType,
            actorRef: input.audit.actorRef,
            subjectType: 'patient',
            subjectRef: input.patientId,
            sourceSurface: input.audit.sourceSurface,
            requestId: input.audit.requestId,
            occurredAt: journal ? new Date(journal.receipt.committedAt) : undefined,
            redactedMetadata: {
                profileNotesCommit: journal,
                changedFields: Object.entries(input.values)
                    .filter(([key, value]) => key !== 'version' && key !== 'updatedAt' && value !== undefined)
                    .map(([key]) => key),
                resourceVersion: input.expectedVersion + 1,
                flags: input.audit.flags,
            },
        });
        const receipt = replay ? readProfileNotesCommitReceipt(tx, replay) : null;
        if (replay && !receipt) throw new ProfileNotesCommitError('receipt_unavailable');
        return { status: 200, value: { success: true }, existing, ...(receipt ? { receipt } : {}) };
    }, { behavior: 'immediate' });
}
