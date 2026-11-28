import {
    territorialPackActive,
    type TerritorialPackCapability,
} from '../../../territorial-pack-contract';
import {
    LOMBARDIA_SERVICE_CODE_SYSTEM,
    formatServicePackageApproval,
    type GeneratedServiceRequest,
    type LombardiaReferenceCatalog,
    type PatientServiceHistoryEntry,
    type ServicePackage,
    type ServicePrescriptionStatus,
} from './contract';
import {
    generatePackageServiceRequests,
    resolveMatchingComplicationModules,
    selectApprovedServicePackagesForDiagnoses,
    type ServicePackageGenerationOutcome,
} from './generation';

type DateValue = Date | string | null | undefined;

export type VisitHistoryPrescription = Readonly<{
    id: string;
    patientId: string;
    status: ServicePrescriptionStatus;
    codeSystem?: string | null;
    serviceCode?: string | null;
    prescribedAt: DateValue;
    scheduledAt?: DateValue;
    performedAt?: DateValue;
    reportReceivedAt?: DateValue;
}>;

export type VisitHistoryItem = Readonly<{
    id: string;
    patientId: string;
    prescriptionId: string;
    status: ServicePrescriptionStatus;
    codeSystem?: string | null;
    serviceCode?: string | null;
    scheduledAt?: DateValue;
    performedAt?: DateValue;
    reportReceivedAt?: DateValue;
    createdAt?: DateValue;
}>;

export type VisitHistoryObservation = Readonly<{
    patientId: string;
    display: string;
    observedAt: DateValue;
    deletedAt?: DateValue;
    servicePrescriptionItemId?: string | null;
}>;

export type VisitServiceHistory = Readonly<{
    entries: readonly PatientServiceHistoryEntry[];
    uncomparedObservationNames: readonly string[];
}>;

function hasCode(value: string | null | undefined): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

export function buildVisitServiceHistory(input: Readonly<{
    patientId: string;
    prescriptions: readonly VisitHistoryPrescription[];
    items: readonly VisitHistoryItem[];
    observations: readonly VisitHistoryObservation[];
}>): VisitServiceHistory {
    const prescriptions = input.prescriptions.filter((prescription) => prescription.patientId === input.patientId);
    const items = input.items.filter((item) => item.patientId === input.patientId);
    const prescribedAtById = new Map(prescriptions.map((prescription) => [prescription.id, prescription.prescribedAt]));
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const serviceInPrescription = (id: string, system?: string | null, code?: string | null) =>
        JSON.stringify([id, system?.trim().toUpperCase() || LOMBARDIA_SERVICE_CODE_SYSTEM, code?.trim().toUpperCase()]);
    const itemServices = new Set(items.filter(item => hasCode(item.serviceCode))
        .map(item => serviceInPrescription(item.prescriptionId, item.codeSystem, item.serviceCode)));
    const entries: PatientServiceHistoryEntry[] = [];

    for (const prescription of prescriptions) {
        if (!hasCode(prescription.serviceCode) || itemServices.has(serviceInPrescription(prescription.id, prescription.codeSystem, prescription.serviceCode))) continue;
        entries.push({
            serviceCode: prescription.serviceCode,
            codeSystem: prescription.codeSystem ?? null,
            status: prescription.status,
            prescribedAt: prescription.prescribedAt,
            scheduledAt: prescription.scheduledAt,
            performedAt: prescription.performedAt,
            reportReceivedAt: prescription.reportReceivedAt,
        });
    }
    for (const item of items) {
        if (!hasCode(item.serviceCode)) continue;
        entries.push({
            serviceCode: item.serviceCode,
            codeSystem: item.codeSystem ?? null,
            status: item.status,
            prescribedAt: prescribedAtById.get(item.prescriptionId) ?? item.createdAt,
            scheduledAt: item.scheduledAt,
            performedAt: item.performedAt,
            reportReceivedAt: item.reportReceivedAt,
        });
    }

    const uncompared = new Set<string>();
    for (const observation of input.observations) {
        if (observation.patientId !== input.patientId || observation.deletedAt) continue;
        const linkedItem = observation.servicePrescriptionItemId ? itemsById.get(observation.servicePrescriptionItemId) : undefined;
        if (linkedItem?.codeSystem?.trim().toUpperCase() === LOMBARDIA_SERVICE_CODE_SYSTEM
            && hasCode(linkedItem.serviceCode) && linkedItem.status !== 'cancelled') {
            entries.push({
                serviceCode: linkedItem.serviceCode,
                codeSystem: linkedItem.codeSystem ?? null,
                status: 'performed',
                performedAt: observation.observedAt,
            });
            continue;
        }
        const name = observation.display.trim();
        if (name) uncompared.add(name);
    }

    return {
        entries,
        uncomparedObservationNames: [...uncompared].sort((left, right) => left.localeCompare(right, 'it')),
    };
}

export type VisitDiagnosis = Readonly<{ code: string; system: string }>;

export type VisitPackageProposal = Readonly<{
    packageId: string;
    title: string;
    diagnosisLabel: string;
    approvalLabel: string;
    exemptionCode: string;
    modules: readonly Readonly<{ id: string; title: string }>[];
    outcome: ServicePackageGenerationOutcome;
}>;

export type VisitPackageProposals =
    | Readonly<{ status: 'territory_inactive' }>
    | Readonly<{ status: 'ready'; proposals: readonly VisitPackageProposal[] }>;

export function composeVisitPackageProposals(input: Readonly<{
    packages: readonly ServicePackage[];
    catalog: LombardiaReferenceCatalog;
    territorialCapability: TerritorialPackCapability | null | undefined;
    diagnoses: readonly VisitDiagnosis[];
    exemptionCodes: readonly string[];
    history: readonly PatientServiceHistoryEntry[];
    asOf: string;
}>): VisitPackageProposals {
    if (!territorialPackActive(input.territorialCapability, 'lom')) return { status: 'territory_inactive' };
    const icd11Codes = input.diagnoses
        .filter((diagnosis) => diagnosis.system === 'ICD-11' && hasCode(diagnosis.code))
        .map((diagnosis) => diagnosis.code);
    const proposals = selectApprovedServicePackagesForDiagnoses(input.packages, icd11Codes).map((pkg) => {
        const activeModuleIds = resolveMatchingComplicationModules(pkg, icd11Codes);
        return {
            packageId: pkg.id,
            title: pkg.title,
            diagnosisLabel: pkg.activation.diagnosisLabel,
            approvalLabel: formatServicePackageApproval(pkg.approval),
            exemptionCode: pkg.exemption.code,
            modules: pkg.complicationModules
                .filter((module) => activeModuleIds.includes(module.id))
                .map((module) => ({ id: module.id, title: module.title })),
            outcome: generatePackageServiceRequests({
                package: pkg,
                territorialCapability: input.territorialCapability,
                catalog: input.catalog,
                activeModuleIds,
                history: input.history,
                asOf: input.asOf,
                patientExemptionCodes: input.exemptionCodes,
            }),
        };
    });
    return { status: 'ready', proposals };
}

export type PackageRequestChoice = Readonly<{
    request: GeneratedServiceRequest;
    clinicalQuestion: string;
}>;

export type PackagePrescriptionDraft = Readonly<{
    prescription: Readonly<{
        id: string;
        patientId: string;
        prescribedAt: Date;
        status: 'prescribed';
        category: GeneratedServiceRequest['category'];
        priority: GeneratedServiceRequest['priority'];
        codeSystem: GeneratedServiceRequest['codeSystem'];
        serviceCode: string;
        serviceName: string;
        clinicalQuestion: string;
        source: 'manual';
        notes: string;
    }>;
    item: Readonly<{
        id: string;
        patientId: string;
        prescriptionId: string;
        ordinal: 0;
        status: 'prescribed';
        category: GeneratedServiceRequest['category'];
        codeSystem: GeneratedServiceRequest['codeSystem'];
        serviceCode: string;
        serviceName: string;
        matchStatus: 'manual';
    }>;
}>;

export function packagePrescriptionNote(proposal: Pick<VisitPackageProposal, 'title' | 'approvalLabel'>, request: GeneratedServiceRequest): string {
    const exemption = request.exemptionCode ? ` Esenzione ${request.exemptionCode}.` : '';
    return `Dal pacchetto «${proposal.title}» (${proposal.approvalLabel}).${exemption}`;
}

export function buildPackagePrescriptionDrafts(input: Readonly<{
    patientId: string;
    proposal: Pick<VisitPackageProposal, 'title' | 'approvalLabel'>;
    choices: readonly PackageRequestChoice[];
    prescribedAt: Date;
    newId: () => string;
}>): PackagePrescriptionDraft[] {
    return input.choices.map(({ request, clinicalQuestion }) => {
        const prescriptionId = input.newId();
        return {
            prescription: {
                id: prescriptionId,
                patientId: input.patientId,
                prescribedAt: input.prescribedAt,
                status: 'prescribed',
                category: request.category,
                priority: request.priority,
                codeSystem: request.codeSystem,
                serviceCode: request.serviceCode,
                serviceName: request.serviceName,
                clinicalQuestion: clinicalQuestion.trim() || request.clinicalQuestion,
                source: 'manual',
                notes: packagePrescriptionNote(input.proposal, request),
            },
            item: {
                id: input.newId(),
                patientId: input.patientId,
                prescriptionId,
                ordinal: 0,
                status: 'prescribed',
                category: request.category,
                codeSystem: request.codeSystem,
                serviceCode: request.serviceCode,
                serviceName: request.serviceName,
                matchStatus: 'manual',
            },
        };
    });
}
