export const PATIENT_PROFILE_UPDATE_OPERATION = Object.freeze({
    id: 'patient-profile.update.v1',
    version: 1,
} as const);

export type PatientProfileUpdateContract = Readonly<{
    operationId: typeof PATIENT_PROFILE_UPDATE_OPERATION.id;
    contractVersion: typeof PATIENT_PROFILE_UPDATE_OPERATION.version;
}>;

export type PatientProfileUpdatePayload = Readonly<{
    firstName?: string; lastName?: string; taxCode?: string;
    birthDate?: string | null;
    address?: string | null; phone?: string | null; caregiver?: string | null;
    notes?: string | null; monitoringProfile?: string | null; statusReason?: string | null;
    archiveReason?: string | null; archiveNote?: string | null;
    exemptions?: string | null; diagnoses?: string | null;
    aiSummary?: string | null; aiSummaryGeneratedAt?: string | null;
    aiSummaryContextHash?: string | null; documentInsights?: string | null;
    isAdi?: boolean; isArchived?: boolean; ambulatoryId?: string | null;
}>;

export const PATIENT_PROFILE_UPDATE_FIELDS = Object.freeze([
    'firstName', 'lastName', 'taxCode', 'address', 'phone', 'caregiver', 'notes',
    'monitoringProfile', 'statusReason', 'archiveReason', 'archiveNote',
    'aiSummary', 'aiSummaryGeneratedAt', 'aiSummaryContextHash', 'documentInsights',
    'isAdi', 'isArchived', 'ambulatoryId', 'birthDate', 'exemptions', 'diagnoses',
] as const satisfies readonly (keyof PatientProfileUpdatePayload)[]);

export type PatientProfileUpdateEnvelope = PatientProfileUpdateContract & Readonly<{
    executionId: string;
    correlationId: string | null;
    idempotencyKey: string;
    executor: 'legacy-node';
    purpose: 'patient-profile-update';
    author: Readonly<{ kind: 'user' | 'system'; ref: string; surface: 'web' | 'native' | 'api' | 'job' }>;
    authorization: Readonly<{ kind: 'existing-host-admission'; commitGuard: 'paired-transaction' | 'archive-audit' }>;
    scope: Readonly<{ kind: 'local' } | { kind: 'ambulatory'; ambulatoryId: string }>;
    confirmation: 'legacy-not-attested';
    target: Readonly<{ patientId: string; expectedVersion: number }>;
    payload: PatientProfileUpdatePayload;
    normalizedAt: string;
    setPrimaryAmbulatory: boolean;
}>;
