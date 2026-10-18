/** Host-owned profile port. HTTP adapters retain admission and wire parsing. */
import { and, eq } from 'drizzle-orm';
import { dbServer } from './db-server';
import { patients, patientsToAmbulatories } from './schema';
import { activePatients } from './patient-lifecycle';
import { normalizePatientUpdateInput } from './patient-write-normalization';
import { updatePatientOperation, type PatientUpdateOperationResult } from './patient-update-operation';
import type { PatientDetail } from './api/v1/types';
import type { NetworkPatientCommitGuard } from './network-patient-commit-authority';
import type { RequiredAuditContext } from './security/audit';

type PatientRecord = typeof patients.$inferSelect;
type RecordRead = { patientId: string; projection: 'web' };
type DetailRead =
    | { patientId: string; projection: 'api-v1' }
    | { patientId: string; projection: 'network'; scopeAmbulatoryId: string };

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function projectDetail(patient: PatientRecord, network: boolean): PatientDetail {
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
        archiveReason: patient.archiveReason ?? null,
        archiveNote: patient.archiveNote ?? null,
        notes: patient.notes ?? null,
        aiSummary: patient.aiSummary ?? null,
        aiSummaryGeneratedAt: toIsoString(patient.aiSummaryGeneratedAt),
        aiSummaryContextHash: patient.aiSummaryContextHash ?? null,
        documentInsights: patient.documentInsights ?? null,
        isAdi: patient.isAdi ?? null,
        isArchived: patient.isArchived ?? null,
        ...(network ? { deletedAt: toIsoString(patient.deletedAt), deletionReason: patient.deletionReason ?? null } : {}),
        version: patient.version,
        ambulatoryId: patient.ambulatoryId ?? null,
        createdAt: toIsoString(patient.createdAt),
        updatedAt: toIsoString(patient.updatedAt),
    };
}

export function readPatientProfile(input: RecordRead): Promise<PatientRecord | null>;
export function readPatientProfile(input: DetailRead): Promise<PatientDetail | null>;
export async function readPatientProfile(input: RecordRead | DetailRead): Promise<PatientRecord | PatientDetail | null> {
    const condition = and(eq(patients.id, input.patientId), activePatients());
    const patient = input.projection === 'network'
        ? (await dbServer.select({ patient: patients }).from(patients)
            .innerJoin(patientsToAmbulatories, eq(patients.id, patientsToAmbulatories.patientId))
            .where(and(condition, eq(patientsToAmbulatories.ambulatoryId, input.scopeAmbulatoryId))).get())?.patient
        : await dbServer.select().from(patients).where(condition).get();
    if (!patient) return null;
    return input.projection === 'web' ? patient : projectDetail(patient, input.projection === 'network');
}

export type PatientProfileUpdateContext = {
    patientId: string;
    expectedVersion: number;
    // These callbacks come from the admitted host adapter, never a decoded body.
    audit: () => RequiredAuditContext;
} & (
    | { scopeAmbulatoryId?: undefined; prepareCommitGuard?: undefined }
    | { scopeAmbulatoryId: string; prepareCommitGuard: () => Promise<NetworkPatientCommitGuard> }
);

export async function updatePatientProfile(
    context: PatientProfileUpdateContext,
    body: Record<string, unknown>,
): Promise<PatientUpdateOperationResult | { status: 400; value: { error: string } }> {
    // Web/v1 retain their existing 404-before-field-validation precedence.
    // Paired input is normalized before its final asynchronous scope admission.
    if (context.scopeAmbulatoryId === undefined) {
        const existing = await dbServer.select({ id: patients.id }).from(patients)
            .where(and(eq(patients.id, context.patientId), activePatients())).get();
        if (!existing) return { status: 404, value: { error: 'Not found' } };
    }
    const normalized = normalizePatientUpdateInput(body, { expectedVersion: context.expectedVersion });
    if (!normalized.ok) return { status: 400, value: { error: normalized.error } };
    const authorizeCommit = context.prepareCommitGuard ? await context.prepareCommitGuard() : undefined;
    // No await between resolving host audit identity and the synchronous commit.
    // The existing operation owns the one SQLite transaction, CAS and audit.
    return updatePatientOperation({
        patientId: context.patientId,
        expectedVersion: context.expectedVersion,
        values: normalized.values,
        setPrimaryAmbulatory: Object.prototype.hasOwnProperty.call(body, 'ambulatoryId'),
        scopeAmbulatoryId: context.scopeAmbulatoryId,
        authorizeCommit,
        audit: context.audit(),
    });
}
