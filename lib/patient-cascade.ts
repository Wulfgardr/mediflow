// WUL-306 (ADR 0066): canonical patient child-table cascade.
// The ONLY module allowed to delete clinical child rows. Guarded against drift by
// scripts/patient-cascade.test.mjs (WUL-316 pattern): every table with a patientId
// column in lib/schema.ts (and every raw-SQL table with patient_id in lib/db-server.ts)
// MUST appear in PATIENT_CHILD_TABLES.
import { eq, notInArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
    attachments,
    checkups,
    documentDiagnosisProposals,
    durableReviewPatientLinks,
    entries,
    observations,
    patients,
    patientsToAmbulatories,
    prostheticPrescriptions,
    servicePrescriptionItems,
    servicePrescriptions,
    sissHandoffEvents,
    therapies,
} from './schema';

// Ordered child-first: items before their prescription container, link table last.
export const PATIENT_CHILD_TABLES = [
    { name: 'servicePrescriptionItems', table: servicePrescriptionItems, patientId: servicePrescriptionItems.patientId },
    { name: 'servicePrescriptions', table: servicePrescriptions, patientId: servicePrescriptions.patientId },
    { name: 'prostheticPrescriptions', table: prostheticPrescriptions, patientId: prostheticPrescriptions.patientId },
    { name: 'sissHandoffEvents', table: sissHandoffEvents, patientId: sissHandoffEvents.patientId },
    /* @Codex */
    { name: 'documentDiagnosisProposals', table: documentDiagnosisProposals, patientId: documentDiagnosisProposals.patientId },
    /* @Codex */
    { name: 'durableReviewPatientLinks', table: durableReviewPatientLinks, patientId: durableReviewPatientLinks.patientId },
    { name: 'observations', table: observations, patientId: observations.patientId },
    { name: 'checkups', table: checkups, patientId: checkups.patientId },
    { name: 'therapies', table: therapies, patientId: therapies.patientId },
    { name: 'entries', table: entries, patientId: entries.patientId },
    { name: 'attachments', table: attachments, patientId: attachments.patientId },
    { name: 'patientsToAmbulatories', table: patientsToAmbulatories, patientId: patientsToAmbulatories.patientId },
] as const;

export type PatientChildTableName = (typeof PATIENT_CHILD_TABLES)[number]['name'];
export type PatientCascadeCounts = Record<PatientChildTableName, number>;

// Works both on dbServer and on a synchronous better-sqlite3 transaction.
type PatientCascadeRunner = Pick<BetterSQLite3Database, 'select' | 'delete'>;

export function totalPatientCascadeRows(counts: PatientCascadeCounts): number {
    return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

// Dry-run twin of purgePatientCascade: per-table row counts for one patient.
export function countPatientCascadeRows(runner: PatientCascadeRunner, patientId: string): PatientCascadeCounts {
    const counts = {} as PatientCascadeCounts;
    for (const child of PATIENT_CHILD_TABLES) {
        counts[child.name] = runner
            .select({ patientId: child.patientId })
            .from(child.table)
            .where(eq(child.patientId, patientId))
            .all()
            .length;
    }
    return counts;
}

// Synchronous cascade delete of every clinical child row for one patient.
// Call inside a dbServer.transaction so a mid-flight failure rolls back atomically.
export function purgePatientCascade(runner: PatientCascadeRunner, patientId: string): PatientCascadeCounts {
    const counts = {} as PatientCascadeCounts;
    for (const child of PATIENT_CHILD_TABLES) {
        const result = runner
            .delete(child.table)
            .where(eq(child.patientId, patientId))
            .run();
        counts[child.name] = result.changes;
    }
    return counts;
}

// Historical WUL-306 debt: child rows whose patient_id no longer resolves to a
// patients row (legacy hard deletes). Tombstoned patients still resolve, so their
// children are never treated as orphans.
export function countOrphanedClinicalRows(runner: PatientCascadeRunner): PatientCascadeCounts {
    const counts = {} as PatientCascadeCounts;
    for (const child of PATIENT_CHILD_TABLES) {
        counts[child.name] = runner
            .select({ patientId: child.patientId })
            .from(child.table)
            .where(notInArray(child.patientId, runner.select({ id: patients.id }).from(patients)))
            .all()
            .length;
    }
    return counts;
}

// Explicit-flag cleanup used by fix-orphans AFTER its relink step (ADR 0066 punto 5).
export function purgeOrphanedClinicalRows(runner: PatientCascadeRunner): PatientCascadeCounts {
    const counts = {} as PatientCascadeCounts;
    for (const child of PATIENT_CHILD_TABLES) {
        const result = runner
            .delete(child.table)
            .where(notInArray(child.patientId, runner.select({ id: patients.id }).from(patients)))
            .run();
        counts[child.name] = result.changes;
    }
    return counts;
}
