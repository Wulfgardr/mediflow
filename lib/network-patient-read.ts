import { and, desc, eq } from 'drizzle-orm';
// WUL-306 (ADR 0066): network replicas never see soft-deleted patients
import { activePatients } from './patient-lifecycle';
import { dbServer } from './db-server';
import { patients, patientsToAmbulatories } from './schema';
import type { PatientDetail, PatientSummary } from './api/v1/types';
import { readPatientProfile } from './patient-profile-service';

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toPatientSummary(patient: typeof patients.$inferSelect, includeDiagnoses = false): PatientSummary {
    return {
        id: patient.id,
        firstName: patient.firstName,
        lastName: patient.lastName,
        birthDate: toIsoString(patient.birthDate),
        taxCode: patient.taxCode,
        isAdi: patient.isAdi ?? null,
        isArchived: patient.isArchived ?? null,
        deletedAt: toIsoString(patient.deletedAt),
        deletionReason: patient.deletionReason ?? null,
        version: patient.version,
        updatedAt: toIsoString(patient.updatedAt),
        ...(includeDiagnoses ? { diagnoses: patient.diagnoses ?? null } : {}),
    };
}


export async function listNetworkScopedPatients(
    scopeAmbulatoryId: string,
    options: { includeDeleted?: boolean; includeDiagnoses?: boolean } = {}
): Promise<PatientSummary[]> {
    const filters = [eq(patientsToAmbulatories.ambulatoryId, scopeAmbulatoryId)];
    if (!options.includeDeleted) {
        filters.push(activePatients());
    }

    const rows = await dbServer
        .select({ patient: patients })
        .from(patients)
        .innerJoin(patientsToAmbulatories, eq(patients.id, patientsToAmbulatories.patientId))
        .where(and(...filters))
        .orderBy(desc(patients.updatedAt));

    return rows.map((row) => toPatientSummary(row.patient, options.includeDiagnoses));
}

export async function getNetworkScopedPatientDetail(
    patientId: string,
    scopeAmbulatoryId: string
): Promise<PatientDetail | null> {
    return readPatientProfile({ patientId, projection: 'network', scopeAmbulatoryId });
}
