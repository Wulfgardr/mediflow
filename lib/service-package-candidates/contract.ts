import { z } from 'zod';
import {
    SERVICE_PRESCRIPTION_CATEGORIES,
    type SERVICE_PRESCRIPTION_STATUSES,
} from '../prescription-domain';

export const PERSONAL_SERVICE_CANDIDATE_KIND = 'personal_history_candidate' as const;
export const PERSONAL_CANDIDATE_REVIEW_SCHEMA = 'mediflow.personal-service-candidates.review.v1' as const;
export const PERSONAL_CANDIDATE_REVIEW_SETTING_KEY = 'servicePackageCandidates.personalReview.v1' as const;

export const CANDIDATE_SUFFICIENCY_STATUSES = [
    'sufficient',
    'insufficient_prescriptions',
    'insufficient_patients',
] as const;

export const CANDIDATE_REVIEW_STATUSES = [
    'pending',
    'kept',
    'corrected',
    'discarded',
] as const;

export type CandidateServiceCategory = (typeof SERVICE_PRESCRIPTION_CATEGORIES)[number];
export type CandidateServicePrescriptionStatus = (typeof SERVICE_PRESCRIPTION_STATUSES)[number];
export type CandidateSufficiencyStatus = (typeof CANDIDATE_SUFFICIENCY_STATUSES)[number];
export type CandidateReviewStatus = (typeof CANDIDATE_REVIEW_STATUSES)[number];

const nonEmptyShortText = z.string().trim().min(1).max(240);
const optionalShortText = z.string().trim().max(240).nullable();

export const candidateServiceItemSchema = z.object({
    key: nonEmptyShortText,
    codeSystem: optionalShortText,
    serviceCode: optionalShortText,
    serviceName: nonEmptyShortText,
    category: z.enum(SERVICE_PRESCRIPTION_CATEGORIES).nullable(),
}).strict();

export const candidateDiagnosisReferenceSchema = z.object({
    code: nonEmptyShortText,
    system: nonEmptyShortText,
    description: nonEmptyShortText,
}).strict();

export const associatedDiagnosisStatSchema = z.object({
    code: nonEmptyShortText,
    system: nonEmptyShortText,
    description: nonEmptyShortText,
    prescriptionCount: z.number().int().positive(),
    patientCount: z.number().int().positive(),
}).strict();

export const recurringServiceGroupCandidateSchema = z.object({
    kind: z.literal(PERSONAL_SERVICE_CANDIDATE_KIND),
    id: nonEmptyShortText,
    signature: nonEmptyShortText,
    services: z.array(candidateServiceItemSchema).min(2).readonly(),
    prescriptionCount: z.number().int().positive(),
    patientCount: z.number().int().positive(),
    diagnoses: z.array(associatedDiagnosisStatSchema).readonly(),
    primaryDiagnosis: associatedDiagnosisStatSchema.nullable(),
    sufficiency: z.enum(CANDIDATE_SUFFICIENCY_STATUSES),
}).strict();

export const candidateReviewDecisionSchema = z.object({
    kind: z.literal(PERSONAL_SERVICE_CANDIDATE_KIND),
    candidateId: nonEmptyShortText,
    status: z.enum(['kept', 'corrected', 'discarded']),
    title: nonEmptyShortText,
    services: z.array(candidateServiceItemSchema).min(1).readonly(),
    associatedDiagnosis: candidateDiagnosisReferenceSchema.nullable(),
    note: z.string().trim().max(400).nullable(),
    updatedAt: z.string().datetime(),
}).strict();

export const personalCandidateReviewStoreSchema = z.object({
    schemaVersion: z.literal(PERSONAL_CANDIDATE_REVIEW_SCHEMA),
    decisions: z.array(candidateReviewDecisionSchema).readonly(),
}).strict();

export type CandidateServiceItem = z.infer<typeof candidateServiceItemSchema>;
export type CandidateDiagnosisReference = z.infer<typeof candidateDiagnosisReferenceSchema>;
export type AssociatedDiagnosisStat = z.infer<typeof associatedDiagnosisStatSchema>;
export type RecurringServiceGroupCandidate = z.infer<typeof recurringServiceGroupCandidateSchema>;
export type CandidateReviewDecision = z.infer<typeof candidateReviewDecisionSchema>;
export type PersonalCandidateReviewStore = z.infer<typeof personalCandidateReviewStoreSchema>;

export type MiningThresholds = Readonly<{
    minPrescriptionCount: number;
    minPatientCount: number;
    minObservationCount: number;
    minGroupSize: number;
    maxGroupSize: number;
    maxServicesPerPrescription: number;
    maxCandidateSetsPerLevel: number;
    maxReturnedCandidates: number;
    maxDiagnosesPerCandidate: number;
}>;

export const DEFAULT_MINING_THRESHOLDS: MiningThresholds = Object.freeze({
    minPrescriptionCount: 3,
    minPatientCount: 2,
    minObservationCount: 2,
    minGroupSize: 2,
    maxGroupSize: 5,
    maxServicesPerPrescription: 12,
    maxCandidateSetsPerLevel: 500,
    maxReturnedCandidates: 30,
    maxDiagnosesPerCandidate: 5,
});

export type RecurringCandidateAnalysisStatus = 'empty_history' | 'insufficient_data' | 'ready';

export type RecurringCandidateAnalysisSummary = Readonly<{
    totalPrescriptionsScanned: number;
    eligiblePrescriptions: number;
    distinctPatients: number;
    cancelledPrescriptionsExcluded: number;
    truncatedPrescriptions: number;
    candidatePoolCapped: boolean;
}>;

export type RecurringServiceCandidateAnalysis = Readonly<{
    kind: typeof PERSONAL_SERVICE_CANDIDATE_KIND;
    status: RecurringCandidateAnalysisStatus;
    thresholds: MiningThresholds;
    summary: RecurringCandidateAnalysisSummary;
    candidates: readonly RecurringServiceGroupCandidate[];
    insufficientCandidates: readonly RecurringServiceGroupCandidate[];
}>;

export type CandidateHistoryDiagnosisInput = Readonly<{
    code?: string | null;
    system?: string | null;
    description?: string | null;
}>;

export type CandidateHistoryPatientInput = Readonly<{
    id: string;
    deletedAt?: Date | string | null;
    diagnoses?: readonly CandidateHistoryDiagnosisInput[] | null;
}>;

export type CandidateHistoryPrescriptionInput = Readonly<{
    id: string;
    patientId: string;
    status: CandidateServicePrescriptionStatus;
    category?: CandidateServiceCategory | null;
    codeSystem?: string | null;
    serviceCode?: string | null;
    serviceName?: string | null;
}>;

export type CandidateHistoryPrescriptionItemInput = Readonly<{
    id: string;
    patientId: string;
    prescriptionId: string;
    status: CandidateServicePrescriptionStatus;
    category?: CandidateServiceCategory | null;
    codeSystem?: string | null;
    serviceCode?: string | null;
    serviceName?: string | null;
    catalogDisplayName?: string | null;
}>;

export type DeriveRecurringCandidatesInput = Readonly<{
    patients: readonly CandidateHistoryPatientInput[];
    prescriptions: readonly CandidateHistoryPrescriptionInput[];
    items: readonly CandidateHistoryPrescriptionItemInput[];
    thresholds?: Partial<MiningThresholds>;
}>;

export function formatCandidateDefaultTitle(services: readonly CandidateServiceItem[]): string {
    const names = services.map((service) => service.serviceName).filter(Boolean);
    if (names.length === 0) return 'Gruppo di prestazioni';
    if (names.length <= 3) return names.join(' + ');
    return `${names.slice(0, 2).join(' + ')} + altre ${names.length - 2}`;
}
