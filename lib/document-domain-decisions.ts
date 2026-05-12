/* @Codex */
import type {
    DocumentDecisionActionKind,
    DocumentDecisionConfidence,
    DocumentDecisionDomainItem,
    DocumentDecisionDomains,
    DocumentDecisionProstheticItem,
} from './document-decision';

/* @Codex */
export type DocumentServicePrescriptionKind = 'specialist' | 'lab' | 'imaging' | 'screening';

/* @Codex */
export interface DocumentDomainDecisionInput {
    id: string;
    label: string;
    confidence: DocumentDecisionConfidence;
    evidenceRefs: string[];
    rationale: string;
}

/* @Codex */
export interface ProstheticDomainDecisionInput extends DocumentDomainDecisionInput {
    requiredFieldsPresent: string[];
    missingRequiredFields: string[];
}

const EMPTY_DOMAINS: DocumentDecisionDomains = {
    patientFields: [],
    clinicalFacts: [],
    diagnosticQuestions: [],
    medicationPrescriptions: [],
    servicePrescriptions: [],
    exemptions: [],
    prosthetics: [],
    ocrNeeded: [],
};

const SERVICE_ACTION_BY_KIND: Record<DocumentServicePrescriptionKind, DocumentDecisionActionKind> = {
    specialist: 'create_service_prescription_proposal',
    lab: 'create_lab_prescription_proposal',
    imaging: 'create_imaging_prescription_proposal',
    screening: 'create_screening_proposal',
};

function domainItem(input: DocumentDomainDecisionInput, action: DocumentDecisionActionKind): DocumentDecisionDomainItem {
    return {
        id: input.id,
        label: input.label,
        action,
        confidence: input.confidence,
        evidenceRefs: input.evidenceRefs,
        rationale: input.rationale,
    };
}

/* @Codex */
export function createMedicationPrescriptionProposal(input: DocumentDomainDecisionInput): DocumentDecisionDomainItem {
    return domainItem(input, 'create_medication_prescription_proposal');
}

/* @Codex */
export function createServicePrescriptionProposal(
    input: DocumentDomainDecisionInput,
    kind: DocumentServicePrescriptionKind,
): DocumentDecisionDomainItem {
    return domainItem(input, SERVICE_ACTION_BY_KIND[kind]);
}

/* @Codex */
export function createDiagnosticQuestionArtifact(input: DocumentDomainDecisionInput): DocumentDecisionDomainItem {
    return domainItem(input, 'create_diagnostic_question');
}

/* @Codex */
export function createExemptionProposal(input: DocumentDomainDecisionInput): DocumentDecisionDomainItem {
    return domainItem(input, 'create_exemption_proposal');
}

/* @Codex */
export function createProstheticPrescriptionProposal(
    input: ProstheticDomainDecisionInput,
): DocumentDecisionProstheticItem {
    const complete = input.missingRequiredFields.length === 0;
    return {
        ...domainItem(
            input,
            complete ? 'create_prosthetic_prescription_proposal' : 'blocked',
        ),
        completeness: complete ? 'complete' : 'partial',
        requiredFieldsPresent: input.requiredFieldsPresent,
        missingRequiredFields: input.missingRequiredFields,
        blockedReason: complete ? undefined : 'prosthetic_required_fields_missing',
    };
}

/* @Codex */
export function buildReviewableDocumentDecisionDomains(input: Partial<DocumentDecisionDomains>): DocumentDecisionDomains {
    return {
        patientFields: input.patientFields ?? EMPTY_DOMAINS.patientFields,
        clinicalFacts: input.clinicalFacts ?? EMPTY_DOMAINS.clinicalFacts,
        diagnosticQuestions: input.diagnosticQuestions ?? EMPTY_DOMAINS.diagnosticQuestions,
        medicationPrescriptions: input.medicationPrescriptions ?? EMPTY_DOMAINS.medicationPrescriptions,
        servicePrescriptions: input.servicePrescriptions ?? EMPTY_DOMAINS.servicePrescriptions,
        exemptions: input.exemptions ?? EMPTY_DOMAINS.exemptions,
        prosthetics: input.prosthetics ?? EMPTY_DOMAINS.prosthetics,
        ocrNeeded: input.ocrNeeded ?? EMPTY_DOMAINS.ocrNeeded,
    };
}
