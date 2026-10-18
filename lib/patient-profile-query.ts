export const PATIENT_PROFILE_READ_OPERATION = Object.freeze({
    id: 'patient-profile.read.v1',
    version: 1,
    purpose: 'patient-profile-read',
    fsePurpose: 'patient-export-validation',
    effects: 'none',
} as const);

export type PatientProfileActor =
    | Readonly<{ kind: 'operator'; ref: string; role: string; channel: 'web' | 'native' }>
    | Readonly<{ kind: 'local-service'; ref: 'local-api'; role: null; channel: 'local-token' }>;

export type PatientProfileQuery = Readonly<{
    operation: typeof PATIENT_PROFILE_READ_OPERATION.id;
    actor: PatientProfileActor;
    purpose: typeof PATIENT_PROFILE_READ_OPERATION.purpose | typeof PATIENT_PROFILE_READ_OPERATION.fsePurpose;
    patientId: string;
    scope: Readonly<{ kind: 'local' }> | Readonly<{ kind: 'ambulatory'; ambulatoryId: string }>;
}>;

export interface PatientProfileView {
    id: string;
    firstName: string;
    lastName: string;
    taxCode: string;
    birthDate: string | null;
    address: string | null;
    phone: string | null;
    caregiver: string | null;
    exemptions: string | null;
    diagnoses: string | null;
    monitoringProfile: string | null;
    statusReason: string | null;
    archiveReason: string | null;
    archiveNote: string | null;
    notes: string | null;
    aiSummary: string | null;
    aiSummaryGeneratedAt: string | null;
    aiSummaryContextHash: string | null;
    documentInsights: string | null;
    isAdi: boolean | null;
    isArchived: boolean | null;
    deletedAt: string | null;
    deletionReason: string | null;
    version: number;
    ambulatoryId: string | null;
    createdAt: string | null;
    updatedAt: string | null;
}
