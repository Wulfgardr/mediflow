/* @Codex */
import { and, desc, eq } from 'drizzle-orm';
// WUL-306 (ADR 0066): network replicas never see soft-deleted patients
import { activePatients } from './patient-lifecycle';
/* @Codex */
import { dbServer } from './db-server';
/* @Codex */
import { patients, patientsToAmbulatories } from './schema';
/* @Codex */
import type { PatientDetail, PatientSummary } from './api/v1/types';

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

function toPatientDetail(patient: typeof patients.$inferSelect): PatientDetail {
    return {
        id: patient.id,
        firstName: patient.firstName,
        lastName: patient.lastName,
        birthDate: toIsoString(patient.birthDate),
        taxCode: patient.taxCode,
        address: patient.address ?? null,
        phone: patient.phone ?? null,
        caregiver: patient.caregiver ?? null,
        exemptions: patient.exemptions ?? null,
        diagnoses: patient.diagnoses ?? null,
        monitoringProfile: patient.monitoringProfile ?? null,
        statusReason: patient.statusReason ?? null,
        notes: patient.notes ?? null,
        aiSummary: patient.aiSummary ?? null,
        aiSummaryGeneratedAt: toIsoString(patient.aiSummaryGeneratedAt),
        aiSummaryContextHash: patient.aiSummaryContextHash ?? null,
        documentInsights: patient.documentInsights ?? null,
        isAdi: patient.isAdi ?? null,
        isArchived: patient.isArchived ?? null,
        deletedAt: toIsoString(patient.deletedAt),
        deletionReason: patient.deletionReason ?? null,
        version: patient.version,
        ambulatoryId: patient.ambulatoryId ?? null,
        createdAt: toIsoString(patient.createdAt),
        updatedAt: toIsoString(patient.updatedAt),
    };
}

/* @Codex */
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

/* @Codex */
export async function getNetworkScopedPatientDetail(
    patientId: string,
    scopeAmbulatoryId: string
): Promise<PatientDetail | null> {
    const row = await dbServer
        .select({ patient: patients })
        .from(patients)
        .innerJoin(patientsToAmbulatories, eq(patients.id, patientsToAmbulatories.patientId))
        .where(and(
            eq(patients.id, patientId),
            eq(patientsToAmbulatories.ambulatoryId, scopeAmbulatoryId),
            activePatients(),
        ))
        .get();

    return row ? toPatientDetail(row.patient) : null;
}
