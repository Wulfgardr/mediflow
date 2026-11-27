export {
    LOMBARDIA_SERVICE_CODE_SYSTEM,
    LOMBARDIA_SERVICE_PACKAGE_SCHEMA,
    SERVICE_PACKAGE_PRIORITIES,
    SERVICE_PACKAGE_SOURCE_STATUSES,
    approvedApprovalSchema,
    approvedServicePackageSchema,
    complicationModuleSchema,
    documentSourceSchema,
    draftApprovalSchema,
    draftComplicationModuleSchema,
    draftServicePackageItemSchema,
    draftServicePackageSchema,
    formatServicePackageApproval,
    isValidIsoCalendarDate,
    physicianDecisionSourceSchema,
    servicePackageApprovalSchema,
    servicePackageItemSchema,
    servicePackageSchema,
    servicePackageSourceKey,
    servicePackageSourceSchema,
    type ApprovedServicePackage,
    type ApprovedServicePackageApproval,
    type ComplicationModule,
    type DocumentSource,
    type DraftComplicationModule,
    type DraftServicePackage,
    type DraftServicePackageApproval,
    type DraftServicePackageItem,
    type ExemptionApplicationStatus,
    type GeneratedServiceRequest,
    type LombardiaReferenceCatalog,
    type PatientServiceHistoryEntry,
    type PhysicianDecisionSource,
    type RegionalExemptionCoverageEntry,
    type RegionalServiceCatalog,
    type RegionalServiceCatalogEntry,
    type ServicePackage,
    type ServicePackageApproval,
    type ServicePackageItem,
    type ServicePackagePriority,
    type ServicePackageSource,
    type ServicePackageSourceStatus,
    type ServicePrescriptionCategory,
    type ServicePrescriptionStatus,
    type ServiceRequestReason,
    type SkippedServiceItem,
    type SkippedServiceReason,
} from './contract';

export {
    validateServicePackage,
    type ServicePackageValidationIssue,
    type ServicePackageValidationIssueCode,
    type ServicePackageValidationResult,
} from './validation';

export {
    generatePackageServiceRequests,
    isApprovedServicePackage,
    listApprovedServicePackages,
    resolveMatchingComplicationModules,
    selectApprovedServicePackagesForDiagnoses,
    type GeneratePackageServiceRequestsInput,
    type ServicePackageGenerationErrorCode,
    type ServicePackageGenerationOutcome,
} from './generation';

export { DIABETES_T2_PACKAGE } from './diabetes-type2';
export { DRAFT_SET_MINIMI_PACKAGES } from './set-minimi-drafts';

import type { ServicePackage } from './contract';
import { DIABETES_T2_PACKAGE } from './diabetes-type2';
import { DRAFT_SET_MINIMI_PACKAGES } from './set-minimi-drafts';

export const ALL_LOMBARDIA_SERVICE_PACKAGES: readonly ServicePackage[] = [
    DIABETES_T2_PACKAGE,
    ...DRAFT_SET_MINIMI_PACKAGES,
];
