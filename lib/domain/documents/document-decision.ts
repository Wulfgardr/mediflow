/* @Codex */
export const DOCUMENT_DECISION_SCHEMA_VERSION = 'mediflow.document_decision.v1';
/* @Codex */
export const DOCUMENT_DECISION_UNSPECIFIED_GENERATED_AT = 'unspecified';

/* @Codex */
export type DocumentTextState = 'text_present' | 'text_partial' | 'text_absent' | 'unreadable';

/* @Codex */
export type DocumentOcrStatus = 'not_needed' | 'needed' | 'queued' | 'completed' | 'failed';

/* @Codex */
export type DocumentDecisionClassification =
    | 'identity_document'
    | 'medication_prescription'
    | 'specialist_service_prescription'
    | 'lab_prescription'
    | 'imaging_prescription'
    | 'screening_prescription_or_invitation'
    | 'specialist_report'
    | 'lab_report'
    | 'imaging_report'
    | 'exemption_document'
    | 'prosthetic_prescription'
    | 'administrative'
    | 'mute_or_scanned'
    | 'unknown';

/* @Codex */
export type DocumentDecisionFamily =
    | 'identity'
    | 'prescription'
    | 'report'
    | 'exemption'
    | 'prosthetic'
    | 'administrative'
    | 'unknown';

/* @Codex */
export type DocumentDecisionConfidence = 'high' | 'medium' | 'low' | 'blocked';

/* @Codex */
export type DocumentDecisionIdentityRole =
    | 'patient_cf'
    | 'physician_cf'
    | 'prescriber_cf'
    | 'operator_cf'
    | 'facility_tax_code'
    | 'unknown_cf';

/* @Codex */
export type DocumentDecisionIdentityAction =
    | 'link_existing_patient'
    | 'create_patient_candidate'
    | 'review_identity'
    | 'attach_without_patient';

/* @Codex */
export type DocumentDecisionActionKind =
    | 'attach_only'
    | 'queue_ocr'
    | 'link_patient'
    | 'create_patient_candidate'
    | 'update_patient_fields'
    | 'create_diagnostic_question'
    | 'create_diagnosis_candidate'
    | 'create_medication_prescription_proposal'
    | 'create_active_therapy'
    | 'create_service_prescription_proposal'
    | 'create_lab_prescription_proposal'
    | 'create_imaging_prescription_proposal'
    | 'create_screening_proposal'
    | 'create_exemption_proposal'
    | 'create_prosthetic_prescription_proposal'
    | 'append_review_note'
    | 'blocked';

/* @Codex */
export type DocumentDecisionForbiddenReason =
    | 'missing_evidence_ref'
    | 'ambiguous_identity'
    | 'unknown_cf_role'
    | 'ocr_required'
    | 'service_prescription_is_not_drug'
    | 'lab_or_imaging_is_not_therapy'
    | 'prescription_is_not_active_therapy'
    | 'diagnostic_question_is_not_diagnosis'
    | 'exemption_is_not_diagnosis'
    | 'prosthetic_required_fields_missing'
    | 'false_patient_create_risk'
    | 'confidence_too_low_for_auto_apply'
    | 'target_field_locked'
    | 'structured_fact_already_present';

/* @Codex */
export type DocumentDecisionHumanRequirement =
    | 'identity_resolution'
    | 'ocr_review'
    | 'patient_create_or_merge'
    | 'clinical_write'
    | 'prescription_boundary'
    | 'prosthetic_completion'
    | 'exemption_confirmation';

/* @Codex */
export interface DocumentDecisionEvidenceRef {
    id: string;
    sourceId: string;
    page?: number;
    sectionId?: string;
    fieldPath?: string;
    snippet: string;
}

/* @Codex */
export interface DocumentDecisionSource {
    documentId: string;
    attachmentId?: string;
    fileName?: string;
    sha256?: string;
    mimeType?: string;
    pageCount?: number;
    textState: DocumentTextState;
    ocrStatus: DocumentOcrStatus;
}

/* @Codex */
export interface DocumentDecisionClassificationResult {
    type: DocumentDecisionClassification;
    family: DocumentDecisionFamily;
    confidence: DocumentDecisionConfidence;
    rationale: string;
    evidenceRefs: string[];
}

/* @Codex */
export interface DocumentDecisionTaxCodeRole {
    value: string;
    role: DocumentDecisionIdentityRole;
    confidence: DocumentDecisionConfidence;
    evidenceRefs: string[];
}

/* @Codex */
export interface DocumentDecisionIdentityCommon {
    candidatePatientIds: string[];
    taxCodes: DocumentDecisionTaxCodeRole[];
    rationale: string;
    humanRequired: boolean;
}

/* @Codex */
export interface DocumentDecisionLinkExistingPatientIdentity extends DocumentDecisionIdentityCommon {
    action: 'link_existing_patient';
    patientId: string;
}

/* @Codex */
export interface DocumentDecisionCreatePatientCandidateIdentity extends DocumentDecisionIdentityCommon {
    action: 'create_patient_candidate';
    patientId?: string;
}

/* @Codex */
export interface DocumentDecisionReviewIdentity extends DocumentDecisionIdentityCommon {
    action: 'review_identity';
    patientId?: string;
}

/* @Codex */
export interface DocumentDecisionAttachWithoutPatientIdentity extends DocumentDecisionIdentityCommon {
    action: 'attach_without_patient';
    patientId?: string;
}

/* @Codex */
export type DocumentDecisionIdentity =
    | DocumentDecisionLinkExistingPatientIdentity
    | DocumentDecisionCreatePatientCandidateIdentity
    | DocumentDecisionReviewIdentity
    | DocumentDecisionAttachWithoutPatientIdentity;

/* @Codex */
export interface DocumentDecisionDomainItem {
    id: string;
    label: string;
    action: DocumentDecisionActionKind;
    confidence: DocumentDecisionConfidence;
    evidenceRefs: string[];
    rationale: string;
    blockedReason?: DocumentDecisionForbiddenReason;
}

/* @Codex */
export interface DocumentDecisionProstheticItem extends DocumentDecisionDomainItem {
    completeness: 'complete' | 'partial';
    requiredFieldsPresent: string[];
    missingRequiredFields: string[];
}

/* @Codex */
export interface DocumentDecisionDomains {
    patientFields: DocumentDecisionDomainItem[];
    clinicalFacts: DocumentDecisionDomainItem[];
    diagnosticQuestions: DocumentDecisionDomainItem[];
    medicationPrescriptions: DocumentDecisionDomainItem[];
    servicePrescriptions: DocumentDecisionDomainItem[];
    exemptions: DocumentDecisionDomainItem[];
    prosthetics: DocumentDecisionProstheticItem[];
    ocrNeeded: DocumentDecisionDomainItem[];
}

/* @Codex */
export interface DocumentDecisionAction {
    id: string;
    kind: DocumentDecisionActionKind;
    target: string;
    evidenceRefs: string[];
    confidence: DocumentDecisionConfidence;
    rationale: string;
    blockedReason?: DocumentDecisionForbiddenReason;
}

/* @Codex */
export interface DocumentDecisionWritePlan {
    mode: 'none' | 'review_required' | 'deterministic_apply_after_review';
    allowedActions: DocumentDecisionAction[];
    blockedActions: DocumentDecisionAction[];
    forbiddenActions: DocumentDecisionAction[];
}

/* @Codex */
export interface DocumentDecisionModelMetadata {
    recognitionMode: 'deterministic' | 'local_llm' | 'hybrid' | 'manual';
    modelName?: string;
    modelVersion?: string;
    promptHash?: string;
    generatedAt: string;
}

/* @Codex */
export interface DocumentDecision {
    schemaVersion: typeof DOCUMENT_DECISION_SCHEMA_VERSION;
    source: DocumentDecisionSource;
    classification: DocumentDecisionClassificationResult;
    evidenceRefs: DocumentDecisionEvidenceRef[];
    identity: DocumentDecisionIdentity;
    domains: DocumentDecisionDomains;
    proposedActions: DocumentDecisionAction[];
    humanRequiredFor: DocumentDecisionHumanRequirement[];
    writePlan: DocumentDecisionWritePlan;
    model: DocumentDecisionModelMetadata;
    negativeAssertions: DocumentDecisionForbiddenReason[];
}

/* @Codex */
export interface ValidateDocumentDecisionResult {
    valid: boolean;
    errors: string[];
    reasons: DocumentDecisionForbiddenReason[];
}

/* @Codex */
export interface DocumentDecisionIdentityInput {
    action?: DocumentDecisionIdentityAction;
    patientId?: string;
    candidatePatientIds?: string[];
    taxCodes?: DocumentDecisionTaxCodeRole[];
    rationale?: string;
    humanRequired?: boolean;
}

/* @Codex */
export interface BuildDocumentDecisionInput {
    source: DocumentDecisionSource;
    classification: DocumentDecisionClassificationResult;
    evidenceRefs?: DocumentDecisionEvidenceRef[];
    identity?: DocumentDecisionIdentityInput;
    domains?: Partial<DocumentDecisionDomains>;
    proposedActions?: DocumentDecisionAction[];
    humanRequiredFor?: DocumentDecisionHumanRequirement[];
    model?: Partial<DocumentDecisionModelMetadata>;
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

const SERVICE_PRESCRIPTION_TYPES = new Set<DocumentDecisionClassification>([
    'specialist_service_prescription',
    'lab_prescription',
    'imaging_prescription',
    'screening_prescription_or_invitation',
]);

const CLINICAL_WRITE_ACTION_KINDS = new Set<DocumentDecisionActionKind>([
    'create_diagnostic_question',
    'create_diagnosis_candidate',
    'create_medication_prescription_proposal',
    'create_active_therapy',
    'create_service_prescription_proposal',
    'create_lab_prescription_proposal',
    'create_imaging_prescription_proposal',
    'create_screening_proposal',
    'create_exemption_proposal',
    'create_prosthetic_prescription_proposal',
]);

function unique<T>(items: T[]): T[] {
    return Array.from(new Set(items));
}

function evidenceRefIds(decision: Pick<DocumentDecision, 'evidenceRefs'>): Set<string> {
    return new Set(decision.evidenceRefs.map((ref) => ref.id));
}

function actionHasEvidence(action: DocumentDecisionAction, evidenceIds: Set<string>): boolean {
    return action.evidenceRefs.length > 0 && action.evidenceRefs.every((id) => evidenceIds.has(id));
}

function allDomainItems(domains: DocumentDecisionDomains): DocumentDecisionDomainItem[] {
    return [
        ...domains.patientFields,
        ...domains.clinicalFacts,
        ...domains.diagnosticQuestions,
        ...domains.medicationPrescriptions,
        ...domains.servicePrescriptions,
        ...domains.exemptions,
        ...domains.prosthetics,
        ...domains.ocrNeeded,
    ];
}

/* @Codex */
function normalizeIdentity(input: DocumentDecisionIdentityInput | undefined): DocumentDecisionIdentity {
    const requestedAction = input?.action ?? 'attach_without_patient';
    const candidatePatientIds = input?.candidatePatientIds ?? [];
    const taxCodes = input?.taxCodes ?? [];
    const baseRationale = input?.rationale ?? 'Identità non risolta dal documento.';
    const baseHumanRequired = input?.humanRequired ?? true;
    const patientId = input?.patientId;

    if (requestedAction === 'link_existing_patient') {
        if (!patientId) {
            return {
                action: 'review_identity',
                patientId: undefined,
                candidatePatientIds,
                taxCodes,
                rationale: input?.rationale
                    ?? 'link_existing_patient richiede patientId esplicito; identità riportata in review.',
                humanRequired: true,
            };
        }
        return {
            action: 'link_existing_patient',
            patientId,
            candidatePatientIds,
            taxCodes,
            rationale: baseRationale,
            humanRequired: baseHumanRequired,
        };
    }

    if (requestedAction === 'create_patient_candidate') {
        return {
            action: 'create_patient_candidate',
            patientId,
            candidatePatientIds,
            taxCodes,
            rationale: baseRationale,
            humanRequired: baseHumanRequired,
        };
    }

    if (requestedAction === 'review_identity') {
        return {
            action: 'review_identity',
            patientId,
            candidatePatientIds,
            taxCodes,
            rationale: baseRationale,
            humanRequired: baseHumanRequired,
        };
    }

    return {
        action: 'attach_without_patient',
        patientId,
        candidatePatientIds,
        taxCodes,
        rationale: baseRationale,
        humanRequired: baseHumanRequired,
    };
}

/* @Codex */
export function buildDocumentDecision(input: BuildDocumentDecisionInput): DocumentDecision {
    const domains: DocumentDecisionDomains = {
        patientFields: input.domains?.patientFields ?? [],
        clinicalFacts: input.domains?.clinicalFacts ?? [],
        diagnosticQuestions: input.domains?.diagnosticQuestions ?? [],
        medicationPrescriptions: input.domains?.medicationPrescriptions ?? [],
        servicePrescriptions: input.domains?.servicePrescriptions ?? [],
        exemptions: input.domains?.exemptions ?? [],
        prosthetics: input.domains?.prosthetics ?? [],
        ocrNeeded: input.domains?.ocrNeeded ?? [],
    };
    const proposedActions = input.proposedActions ?? allDomainItems(domains).map((item) => ({
        id: `action:${item.id}`,
        kind: item.action,
        target: item.id,
        evidenceRefs: item.evidenceRefs,
        confidence: item.confidence,
        rationale: item.rationale,
        blockedReason: item.blockedReason,
    }));
    const blockedActions = proposedActions.filter((action) => action.kind === 'blocked' || Boolean(action.blockedReason));
    const allowedActions = proposedActions.filter((action) => action.kind !== 'blocked' && !action.blockedReason);
    const defaultHumanRequired: DocumentDecisionHumanRequirement[] = [];

    if (input.identity?.humanRequired) defaultHumanRequired.push('identity_resolution');
    if (input.source.ocrStatus === 'needed' || input.source.ocrStatus === 'queued') defaultHumanRequired.push('ocr_review');
    if (allowedActions.some((action) => CLINICAL_WRITE_ACTION_KINDS.has(action.kind))) {
        defaultHumanRequired.push('clinical_write');
    }

    return {
        schemaVersion: DOCUMENT_DECISION_SCHEMA_VERSION,
        source: input.source,
        classification: input.classification,
        evidenceRefs: input.evidenceRefs ?? [],
        identity: normalizeIdentity(input.identity),
        domains,
        proposedActions,
        humanRequiredFor: unique([...(input.humanRequiredFor ?? []), ...defaultHumanRequired]),
        writePlan: {
            mode: allowedActions.length > 0 ? 'review_required' : 'none',
            allowedActions,
            blockedActions,
            forbiddenActions: [],
        },
        model: {
            recognitionMode: input.model?.recognitionMode ?? 'deterministic',
            modelName: input.model?.modelName,
            modelVersion: input.model?.modelVersion,
            promptHash: input.model?.promptHash,
            generatedAt: input.model?.generatedAt ?? DOCUMENT_DECISION_UNSPECIFIED_GENERATED_AT,
        },
        negativeAssertions: [],
    };
}

/* @Codex */
interface DocumentDecisionViolation {
    code: DocumentDecisionForbiddenReason;
    message: string;
    actionIds: string[];
}

/* @Codex */
function isOcrPending(decision: DocumentDecision): boolean {
    return decision.source.textState === 'text_absent'
        || decision.source.textState === 'text_partial'
        || decision.source.textState === 'unreadable'
        || decision.source.ocrStatus === 'needed';
}

/* @Codex */
function servicePrescriptionReasonFor(decision: DocumentDecision): DocumentDecisionForbiddenReason {
    return decision.classification.type === 'lab_prescription' || decision.classification.type === 'imaging_prescription'
        ? 'lab_or_imaging_is_not_therapy'
        : 'service_prescription_is_not_drug';
}

/* @Codex
 * Reason-coded violation collector. Replaces the previous regex-on-error fallback so each
 * negative assertion ties back to a deterministic predicate plus the offending action ids.
 * Order is priority order: the first matching code wins for action-level blockedReason.
 */
function collectDocumentDecisionViolations(decision: DocumentDecision): DocumentDecisionViolation[] {
    const violations: DocumentDecisionViolation[] = [];
    const evidenceIds = evidenceRefIds(decision);

    if (SERVICE_PRESCRIPTION_TYPES.has(decision.classification.type)) {
        const reason = servicePrescriptionReasonFor(decision);
        const offendingActionIds = decision.proposedActions
            .filter((action) => action.kind === 'create_medication_prescription_proposal' || action.kind === 'create_active_therapy')
            .map((action) => action.id);
        violations.push({
            code: reason,
            message: offendingActionIds.length > 0
                ? 'Service/lab/imaging prescriptions cannot be promoted to drug or therapy actions.'
                : 'Service/lab/imaging prescription kept out of drug or therapy lane.',
            actionIds: offendingActionIds,
        });
    }

    if (decision.classification.type === 'medication_prescription') {
        const offendingActionIds = decision.proposedActions
            .filter((action) => action.kind === 'create_active_therapy')
            .map((action) => action.id);
        violations.push({
            code: 'prescription_is_not_active_therapy',
            message: offendingActionIds.length > 0
                ? 'Medication prescriptions cannot directly create active therapies.'
                : 'Medication prescription kept out of active therapy lane.',
            actionIds: offendingActionIds,
        });
    }

    const diagnosticQuestionActionIds = decision.domains.diagnosticQuestions
        .filter((item) => item.action === 'create_diagnosis_candidate')
        .map((item) => `action:${item.id}`);
    if (diagnosticQuestionActionIds.length > 0) {
        violations.push({
            code: 'diagnostic_question_is_not_diagnosis',
            message: 'Diagnostic questions cannot be promoted to diagnosis candidates without a separate review lane.',
            actionIds: diagnosticQuestionActionIds,
        });
    }

    const exemptionActionIds = decision.domains.exemptions
        .filter((item) => item.action === 'create_diagnosis_candidate')
        .map((item) => `action:${item.id}`);
    if (exemptionActionIds.length > 0) {
        violations.push({
            code: 'exemption_is_not_diagnosis',
            message: 'Exemptions cannot be promoted to diagnosis candidates.',
            actionIds: exemptionActionIds,
        });
    }

    const partialProstheticActionIds = decision.domains.prosthetics
        .filter((item) => item.completeness !== 'complete' && item.action === 'create_prosthetic_prescription_proposal')
        .map((item) => `action:${item.id}`);
    if (partialProstheticActionIds.length > 0) {
        violations.push({
            code: 'prosthetic_required_fields_missing',
            message: `Partial prosthetic items propose structured writes: ${partialProstheticActionIds.join(', ')}.`,
            actionIds: partialProstheticActionIds,
        });
    }

    if (isOcrPending(decision)) {
        const offendingActionIds = decision.proposedActions
            .filter((action) => CLINICAL_WRITE_ACTION_KINDS.has(action.kind))
            .map((action) => action.id);
        violations.push({
            code: 'ocr_required',
            message: offendingActionIds.length > 0
                ? 'OCR-needed documents cannot propose clinical structured writes.'
                : 'OCR review required before structured clinical writes.',
            actionIds: offendingActionIds,
        });
    }

    const lowConfidenceClinicalWriteActionIds = decision.proposedActions
        .filter((action) => (
            CLINICAL_WRITE_ACTION_KINDS.has(action.kind)
            && (action.confidence === 'low' || action.confidence === 'blocked')
        ))
        .map((action) => action.id);
    if (lowConfidenceClinicalWriteActionIds.length > 0) {
        violations.push({
            code: 'confidence_too_low_for_auto_apply',
            message: `Low-confidence clinical writes require review-first handling: ${lowConfidenceClinicalWriteActionIds.join(', ')}.`,
            actionIds: lowConfidenceClinicalWriteActionIds,
        });
    }

    const patientTaxCodes = decision.identity.taxCodes.filter((taxCode) => taxCode.role === 'patient_cf');
    const unknownTaxCodes = decision.identity.taxCodes.filter((taxCode) => taxCode.role === 'unknown_cf');
    const taxCodesClean = patientTaxCodes.length === 1 && unknownTaxCodes.length === 0;
    const linkPatientAuthorized = decision.identity.action === 'link_existing_patient'
        && Boolean(decision.identity.patientId)
        && taxCodesClean;
    const createPatientAuthorized = decision.identity.action === 'create_patient_candidate' && taxCodesClean;
    const ambiguousActionIds = decision.proposedActions
        .filter((action) => (
            (action.kind === 'link_patient' && !linkPatientAuthorized)
            || (action.kind === 'create_patient_candidate' && !createPatientAuthorized)
        ))
        .map((action) => action.id);
    const linkWithoutPatientId = decision.identity.action === 'link_existing_patient' && !decision.identity.patientId;
    if (ambiguousActionIds.length > 0 || linkWithoutPatientId) {
        violations.push({
            code: 'ambiguous_identity',
            message: linkWithoutPatientId
                ? 'link_existing_patient identity requires patientId.'
                : 'Patient create/link actions require a verified single patient_cf and a resolved identity.',
            actionIds: ambiguousActionIds,
        });
    }

    const missingEvidenceActionIds = decision.proposedActions
        .filter((action) => action.kind !== 'attach_only' && action.kind !== 'queue_ocr' && !actionHasEvidence(action, evidenceIds))
        .map((action) => action.id);
    if (missingEvidenceActionIds.length > 0) {
        violations.push({
            code: 'missing_evidence_ref',
            message: `Actions lack valid evidence refs: ${missingEvidenceActionIds.join(', ')}.`,
            actionIds: missingEvidenceActionIds,
        });
    }

    return violations;
}

function buildActionReasonMap(violations: DocumentDecisionViolation[]): Map<string, DocumentDecisionForbiddenReason> {
    const map = new Map<string, DocumentDecisionForbiddenReason>();
    for (const violation of violations) {
        for (const actionId of violation.actionIds) {
            if (!map.has(actionId)) map.set(actionId, violation.code);
        }
    }
    return map;
}

/* @Codex */
export function validateDocumentDecision(decision: DocumentDecision): ValidateDocumentDecisionResult {
    const errors: string[] = [];

    if (decision.schemaVersion !== DOCUMENT_DECISION_SCHEMA_VERSION) {
        errors.push(`Unsupported schemaVersion: ${decision.schemaVersion}`);
    }

    const violations = collectDocumentDecisionViolations(decision);
    for (const violation of violations) {
        if (violation.actionIds.length > 0) errors.push(violation.message);
    }

    return {
        valid: errors.length === 0,
        errors,
        reasons: unique(violations.map((violation) => violation.code)),
    };
}

/* @Codex */
export function applyDocumentDecisionGuardrails(decision: DocumentDecision): DocumentDecision {
    const violations = collectDocumentDecisionViolations(decision);
    const baselineAssertions = unique(violations.map((violation) => violation.code));
    const actionReasons = buildActionReasonMap(violations);

    if (actionReasons.size === 0) {
        return {
            ...decision,
            negativeAssertions: baselineAssertions,
            writePlan: {
                ...decision.writePlan,
                forbiddenActions: [],
            },
        };
    }

    const forbiddenActions = decision.proposedActions
        .filter((action) => actionReasons.has(action.id))
        .map((action) => ({
            ...action,
            kind: 'blocked' as const,
            blockedReason: action.blockedReason ?? actionReasons.get(action.id)!,
        }));
    const blockedActions = decision.writePlan.blockedActions.filter((action) => !actionReasons.has(action.id));
    const allowedActions = decision.proposedActions.filter((action) => (
        !actionReasons.has(action.id)
        && action.kind !== 'blocked'
        && !action.blockedReason
    ));

    return {
        ...decision,
        negativeAssertions: baselineAssertions,
        humanRequiredFor: unique([...decision.humanRequiredFor, 'clinical_write']),
        writePlan: {
            mode: 'review_required',
            allowedActions,
            blockedActions,
            forbiddenActions,
        },
    };
}

/* @Codex */
export function createDocumentDecisionEvidenceRef(
    id: string,
    snippet: string,
    sourceId = 'document',
): DocumentDecisionEvidenceRef {
    return {
        id,
        sourceId,
        snippet,
    };
}

/* @Codex */
export { EMPTY_DOMAINS as EMPTY_DOCUMENT_DECISION_DOMAINS };
