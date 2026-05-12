/* @Codex */
import {
    validateDocumentDecision,
    type DocumentDecision,
    type DocumentDecisionActionKind,
} from './document-decision';

/* @Codex */
export const DOCUMENT_DECISION_MODEL_GOVERNANCE_VERSION = 'mediflow.document_decision_model_governance.v1';

/* @Codex */
export type DocumentDecisionModelLane =
    | 'ocr'
    | 'classification'
    | 'identity_resolution'
    | 'domain_extraction'
    | 'write_plan'
    | 'benchmark_shadow_eval';

/* @Codex */
export type DocumentDecisionModelPolicyMode =
    | 'local_ocr_only'
    | 'deterministic_or_local_llm_bounded'
    | 'deterministic_only'
    | 'human_review_only'
    | 'shadow_eval_only';

/* @Codex */
export interface DocumentDecisionModelPolicy {
    lane: DocumentDecisionModelLane;
    mode: DocumentDecisionModelPolicyMode;
    rationale: string;
}

/* @Codex */
export interface DocumentDecisionModelGovernanceResult {
    schemaVersion: typeof DOCUMENT_DECISION_MODEL_GOVERNANCE_VERSION;
    valid: boolean;
    errors: string[];
    policies: DocumentDecisionModelPolicy[];
}

const STRUCTURED_WRITE_ACTIONS = new Set<DocumentDecisionActionKind>([
    'link_patient',
    'create_patient_candidate',
    'update_patient_fields',
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

/* @Codex */
export function documentDecisionModelPolicies(): DocumentDecisionModelPolicy[] {
    return [
        {
            lane: 'ocr',
            mode: 'local_ocr_only',
            rationale: 'OCR resta locale; un PDF muto non genera dati clinici strutturati prima di OCR e review.',
        },
        {
            lane: 'classification',
            mode: 'deterministic_or_local_llm_bounded',
            rationale: 'La classificazione puo usare LLM locale bounded, ma deve produrre evidence refs e negative assertions.',
        },
        {
            lane: 'identity_resolution',
            mode: 'deterministic_only',
            rationale: 'Ruoli CF e link/create paziente richiedono resolver deterministico e review sugli ambigui.',
        },
        {
            lane: 'domain_extraction',
            mode: 'deterministic_or_local_llm_bounded',
            rationale: 'L estrazione dominio puo usare LLM locale bounded solo come proposta evidence-bound.',
        },
        {
            lane: 'write_plan',
            mode: 'human_review_only',
            rationale: 'Il write plan non puo essere deciso direttamente da LLM; applicazione solo dopo review deterministica.',
        },
        {
            lane: 'benchmark_shadow_eval',
            mode: 'shadow_eval_only',
            rationale: 'Comparator/cloud o modelli alternativi restano shadow eval su case pack privati/redatti, non runtime write.',
        },
    ];
}

/* @Codex */
export function validateDocumentDecisionModelGovernance(
    decision: DocumentDecision,
): DocumentDecisionModelGovernanceResult {
    const errors: string[] = [];
    const contractValidation = validateDocumentDecision(decision);
    if (!contractValidation.valid) errors.push(...contractValidation.errors);

    const modelCanBeGenerative = decision.model.recognitionMode === 'local_llm' || decision.model.recognitionMode === 'hybrid';
    const hasStructuredAllowedWrites = decision.writePlan.allowedActions.some((action) => STRUCTURED_WRITE_ACTIONS.has(action.kind));

    if (modelCanBeGenerative && decision.writePlan.mode === 'deterministic_apply_after_review') {
        errors.push('Generative or hybrid model output cannot directly enter deterministic apply mode.');
    }
    if (modelCanBeGenerative && hasStructuredAllowedWrites && !decision.humanRequiredFor.includes('clinical_write')) {
        errors.push('Generative or hybrid structured proposals require explicit clinical_write review.');
    }
    if (decision.model.recognitionMode === 'local_llm' && decision.identity.action !== 'review_identity' && decision.identity.taxCodes.length > 0) {
        errors.push('LLM recognition cannot directly resolve patient identity actions.');
    }
    if ((decision.source.ocrStatus === 'needed' || decision.source.ocrStatus === 'queued') && hasStructuredAllowedWrites) {
        errors.push('OCR-needed documents cannot expose structured allowed writes.');
    }

    return {
        schemaVersion: DOCUMENT_DECISION_MODEL_GOVERNANCE_VERSION,
        valid: errors.length === 0,
        errors,
        policies: documentDecisionModelPolicies(),
    };
}
