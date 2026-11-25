import { z } from 'zod';
import {
    SERVICE_PRESCRIPTION_CATEGORIES,
    type SERVICE_PRESCRIPTION_STATUSES,
} from '../../../prescription-domain';

export const LOMBARDIA_SERVICE_PACKAGE_SCHEMA = 'mediflow.lombardia.service-package.v1' as const;
export const LOMBARDIA_SERVICE_CODE_SYSTEM = 'REGIONAL_PRESTAZIONI' as const;
export const SERVICE_PACKAGE_PRIORITIES = ['U', 'B', 'D', 'P'] as const;
export const SERVICE_PACKAGE_SOURCE_STATUSES = ['vigente', 'riferimento_clinico'] as const;

export type ServicePrescriptionCategory = (typeof SERVICE_PRESCRIPTION_CATEGORIES)[number];
export type ServicePrescriptionStatus = (typeof SERVICE_PRESCRIPTION_STATUSES)[number];
export type ServicePackagePriority = (typeof SERVICE_PACKAGE_PRIORITIES)[number];
export type ServicePackageSourceStatus = (typeof SERVICE_PACKAGE_SOURCE_STATUSES)[number];

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const ICD11_CODE_PATTERN = /^[A-Z0-9][A-Z0-9.&/-]{0,31}$/u;

export function isValidIsoCalendarDate(value: string): boolean {
    const match = ISO_DATE_PATTERN.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day;
}

const nonEmptyText = z.string().trim().min(1).max(512);
const isoCalendarDateSchema = z.string().refine(isValidIsoCalendarDate, {
    message: 'Data non valida (atteso formato AAAA-MM-GG)',
});
const icd11CodeSchema = z.string().trim().regex(ICD11_CODE_PATTERN, {
    message: 'Codice ICD-11 non valido',
});

export const documentSourceSchema = z.object({
    kind: z.literal('documento'),
    document: nonEmptyText,
    sectionOrTable: nonEmptyText,
    publishedAt: isoCalendarDateSchema,
    version: nonEmptyText.optional(),
    url: z.string().url(),
    status: z.enum(SERVICE_PACKAGE_SOURCE_STATUSES),
}).strict();

export const physicianDecisionSourceSchema = z.object({
    kind: z.literal('decisione_del_medico'),
    decidedBy: nonEmptyText,
    decidedAt: isoCalendarDateSchema,
    decision: nonEmptyText,
}).strict();

export const servicePackageSourceSchema = z.discriminatedUnion('kind', [
    documentSourceSchema,
    physicianDecisionSourceSchema,
]);

export const draftApprovalSchema = z.object({
    status: z.literal('draft_pending_approval'),
}).strict();

export const approvedApprovalSchema = z.object({
    status: z.literal('approved'),
    approvedBy: nonEmptyText,
    approvedAt: isoCalendarDateSchema,
}).strict();

export const servicePackageApprovalSchema = z.discriminatedUnion('status', [
    draftApprovalSchema,
    approvedApprovalSchema,
]);

export const servicePackageItemSchema = z.object({
    id: nonEmptyText,
    serviceCode: nonEmptyText,
    serviceName: nonEmptyText,
    category: z.enum(SERVICE_PRESCRIPTION_CATEGORIES),
    periodicityMonths: z.number().int().positive().max(120),
    clinicalQuestion: nonEmptyText,
    priority: z.enum(SERVICE_PACKAGE_PRIORITIES),
    exemptionCode: nonEmptyText.nullable(),
    appropriatenessConditions: z.array(nonEmptyText).readonly(),
    sources: z.array(servicePackageSourceSchema).min(1).readonly(),
}).strict();

export const complicationModuleSchema = z.object({
    id: z.string().trim().min(1).max(64).regex(/^[a-z0-9-]+$/u),
    title: nonEmptyText,
    triggerIcd11Codes: z.array(icd11CodeSchema).min(1).readonly(),
    items: z.array(servicePackageItemSchema).min(1).readonly(),
    sources: z.array(servicePackageSourceSchema).min(1).readonly(),
}).strict();

const servicePackageBaseFields = {
    schemaVersion: z.literal(LOMBARDIA_SERVICE_PACKAGE_SCHEMA),
    id: z.string().trim().min(1).max(128).regex(/^[a-z0-9._-]+$/u),
    territory: z.literal('lom'),
    codeSystem: z.literal(LOMBARDIA_SERVICE_CODE_SYSTEM),
    title: nonEmptyText,
    activation: z.object({
        icd11Codes: z.array(icd11CodeSchema).min(1).readonly(),
        diagnosisLabel: nonEmptyText,
    }).strict(),
    exemption: z.object({
        code: nonEmptyText,
        description: nonEmptyText,
        applicableWhen: nonEmptyText.optional(),
    }).strict(),
    sources: z.array(servicePackageSourceSchema).min(1).readonly(),
    baseItems: z.array(servicePackageItemSchema).min(1).readonly(),
    complicationModules: z.array(complicationModuleSchema).readonly(),
};

export const draftServicePackageSchema = z.object({
    ...servicePackageBaseFields,
    approval: draftApprovalSchema,
}).strict();

export const approvedServicePackageSchema = z.object({
    ...servicePackageBaseFields,
    approval: approvedApprovalSchema,
}).strict();

export const servicePackageSchema = z.union([
    draftServicePackageSchema,
    approvedServicePackageSchema,
]);

export type DocumentSource = z.infer<typeof documentSourceSchema>;
export type PhysicianDecisionSource = z.infer<typeof physicianDecisionSourceSchema>;
export type ServicePackageSource = z.infer<typeof servicePackageSourceSchema>;
export type DraftServicePackageApproval = z.infer<typeof draftApprovalSchema>;
export type ApprovedServicePackageApproval = z.infer<typeof approvedApprovalSchema>;
export type ServicePackageApproval = z.infer<typeof servicePackageApprovalSchema>;
export type ServicePackageItem = z.infer<typeof servicePackageItemSchema>;
export type ComplicationModule = z.infer<typeof complicationModuleSchema>;
export type DraftServicePackage = z.infer<typeof draftServicePackageSchema>;
export type ApprovedServicePackage = z.infer<typeof approvedServicePackageSchema>;
export type ServicePackage = DraftServicePackage | ApprovedServicePackage;

export type RegionalServiceCatalogEntry = Readonly<{
    codeSystem: typeof LOMBARDIA_SERVICE_CODE_SYSTEM;
    serviceCode: string;
    displayName: string;
    category: ServicePrescriptionCategory;
    active: boolean;
}>;

export type RegionalServiceCatalog = ReadonlyArray<RegionalServiceCatalogEntry>;

export type RegionalExemptionCoverageEntry = Readonly<{
    exemptionCode: string;
    serviceCode: string;
    condition: string;
}>;

export type LombardiaReferenceCatalog = Readonly<{
    services: RegionalServiceCatalog;
    exemptions: ReadonlyArray<RegionalExemptionCoverageEntry>;
}>;

export type PatientServiceHistoryEntry = Readonly<{
    serviceCode: string;
    codeSystem?: string | null;
    status: ServicePrescriptionStatus;
    prescribedAt?: string | Date | null;
    scheduledAt?: string | Date | null;
    performedAt?: string | Date | null;
    reportReceivedAt?: string | Date | null;
}>;

export type ServiceRequestReason =
    | Readonly<{ kind: 'never_performed'; label: 'Mai eseguita' }>
    | Readonly<{ kind: 'overdue'; lastPerformedAt: string; overdueMonths: number; label: string }>
    | Readonly<{ kind: 'ordered_not_performed'; orderedAt: string; label: string }>;

export type SkippedServiceReason =
    | Readonly<{ kind: 'within_periodicity'; lastPerformedAt: string; validUntil: string; remainingMonths: number; label: string }>
    | Readonly<{ kind: 'pending_order'; orderedAt: string; validUntil: string; label: string }>;

export type ExemptionApplicationStatus = 'active' | 'declared_by_package' | 'not_held_by_patient';

export type GeneratedServiceRequest = Readonly<{
    itemId: string;
    sourceModuleId: 'base' | string;
    codeSystem: typeof LOMBARDIA_SERVICE_CODE_SYSTEM;
    serviceCode: string;
    serviceName: string;
    category: ServicePrescriptionCategory;
    priority: ServicePackagePriority;
    exemptionCode: string | null;
    exemptionStatus: ExemptionApplicationStatus;
    clinicalQuestion: string;
    appropriatenessConditions: readonly string[];
    periodicityMonths: number;
    reason: ServiceRequestReason;
    sources: readonly ServicePackageSource[];
}>;

export type SkippedServiceItem = Readonly<{
    itemId: string;
    sourceModuleId: 'base' | string;
    codeSystem: typeof LOMBARDIA_SERVICE_CODE_SYSTEM;
    serviceCode: string;
    serviceName: string;
    periodicityMonths: number;
    reason: SkippedServiceReason;
}>;

export function servicePackageSourceKey(source: ServicePackageSource): string {
    return source.kind === 'documento'
        ? [source.kind, source.document, source.sectionOrTable, source.publishedAt].join('\u0000')
        : [source.kind, source.decidedBy, source.decidedAt, source.decision].join('\u0000');
}

export function formatServicePackageApproval(approval: ServicePackageApproval): string {
    if (approval.status === 'draft_pending_approval') {
        return 'Bozza da approvare';
    }
    return `Approvato da ${approval.approvedBy} il ${approval.approvedAt}`;
}
