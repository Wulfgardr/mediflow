import { and, desc, eq } from 'drizzle-orm';
// WUL-306 (ADR 0066): network replicas never see soft-deleted patients
import { activePatients } from './patient-lifecycle';
import { dbServer } from './db-server';
import { patients, patientsToAmbulatories } from './schema';
import type { PatientSummary } from './api/v1/types';
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

export function getNetworkScopedPatientDetail(request: Request, patientId: () => Promise<string | null>, projection?: 'network'): ReturnType<typeof readPatientProfile>;
export function getNetworkScopedPatientDetail(request: Request, patientId: () => string | null, projection: 'network-fse'): ReturnType<typeof readPatientProfile>;
export function getNetworkScopedPatientDetail(
    request: Request,
    patientId: () => Promise<string | null> | string | null,
    projection: 'network' | 'network-fse' = 'network',
) {
    if (projection === 'network-fse') return readPatientProfile({ request, projection, patientId: () => {
        const id = patientId();
        if (typeof id !== 'string' && id !== null) throw new Error('FSE patient locator must be synchronous');
        return id;
    } });
    return readPatientProfile({ request, patientId: async () => patientId(), projection });
}
