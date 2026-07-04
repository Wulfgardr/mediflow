/* @Codex */
import type {
    DocumentDecision,
    DocumentDecisionAction,
    DocumentDecisionHumanRequirement,
} from './document-decision';

/* @Codex */
export interface DocumentDecisionReviewActionView {
    id: string;
    label: string;
    target: string;
    confidence: string;
    rationale: string;
    blockedReason?: string;
}

/* @Codex */
export interface DocumentDecisionReviewViewModel {
    title: string;
    documentType: string;
    patientCandidate: string;
    confidence: string;
    evidence: Array<{ id: string; snippet: string }>;
    allowedActions: DocumentDecisionReviewActionView[];
    blockedActions: DocumentDecisionReviewActionView[];
    forbiddenActions: DocumentDecisionReviewActionView[];
    humanRequiredFor: string[];
    nonWriteSummary: string[];
}

const DOCUMENT_TYPE_LABELS: Record<DocumentDecision['classification']['type'], string> = {
    identity_document: 'Documento anagrafico',
    medication_prescription: 'Prescrizione farmaco',
    specialist_service_prescription: 'Prescrizione prestazione specialistica',
    lab_prescription: 'Prescrizione laboratorio',
    imaging_prescription: 'Prescrizione imaging',
    screening_prescription_or_invitation: 'Screening / invito',
    specialist_report: 'Referto specialistico',
    lab_report: 'Referto laboratorio',
    imaging_report: 'Referto imaging',
    exemption_document: 'Documento esenzione',
    prosthetic_prescription: 'Prescrizione protesica',
    administrative: 'Documento amministrativo',
    mute_or_scanned: 'PDF muto o scansionato',
    unknown: 'Documento da classificare',
};

const ACTION_LABELS: Record<DocumentDecisionAction['kind'], string> = {
    attach_only: 'Archivia allegato',
    queue_ocr: 'Accoda OCR',
    link_patient: 'Collega paziente',
    create_patient_candidate: 'Crea candidato paziente',
    update_patient_fields: 'Aggiorna campi paziente',
    create_diagnostic_question: 'Registra quesito diagnostico',
    create_diagnosis_candidate: 'Crea diagnosi candidata',
    create_medication_prescription_proposal: 'Proposta prescrizione farmaco',
    create_active_therapy: 'Crea terapia attiva',
    create_service_prescription_proposal: 'Proposta prestazione specialistica',
    create_lab_prescription_proposal: 'Proposta esami laboratorio',
    create_imaging_prescription_proposal: 'Proposta imaging',
    create_screening_proposal: 'Proposta screening',
    create_exemption_proposal: 'Proposta esenzione',
    create_prosthetic_prescription_proposal: 'Proposta protesica',
    append_review_note: 'Aggiungi nota di review',
    blocked: 'Azione bloccata',
};

const HUMAN_REQUIREMENT_LABELS: Record<DocumentDecisionHumanRequirement, string> = {
    identity_resolution: 'Risoluzione identita',
    ocr_review: 'Review OCR',
    patient_create_or_merge: 'Creazione/merge paziente',
    clinical_write: 'Write clinico',
    prescription_boundary: 'Confine prescrizione',
    prosthetic_completion: 'Completamento protesica',
    exemption_confirmation: 'Conferma esenzione',
};

const FORBIDDEN_REASON_LABELS: Record<string, string> = {
    missing_evidence_ref: 'evidenza mancante',
    ambiguous_identity: 'identita ambigua',
    unknown_cf_role: 'ruolo CF non chiaro',
    ocr_required: 'OCR richiesto',
    service_prescription_is_not_drug: 'prestazione non farmaco',
    lab_or_imaging_is_not_therapy: 'lab/imaging non terapia',
    prescription_is_not_active_therapy: 'prescrizione non terapia attiva',
    diagnostic_question_is_not_diagnosis: 'quesito non diagnosi',
    exemption_is_not_diagnosis: 'esenzione non diagnosi',
    prosthetic_required_fields_missing: 'campi protesica mancanti',
    false_patient_create_risk: 'rischio falso paziente',
    confidence_too_low_for_auto_apply: 'confidenza insufficiente',
    target_field_locked: 'campo cifrato non leggibile',
    structured_fact_already_present: 'dato gia presente',
};

function actionView(action: DocumentDecisionAction): DocumentDecisionReviewActionView {
    return {
        id: action.id,
        label: ACTION_LABELS[action.kind],
        target: action.target,
        confidence: action.confidence,
        rationale: action.rationale,
        blockedReason: action.blockedReason ? FORBIDDEN_REASON_LABELS[action.blockedReason] ?? action.blockedReason : undefined,
    };
}

function patientCandidate(decision: DocumentDecision): string {
    const patientCf = decision.identity.taxCodes.find((taxCode) => taxCode.role === 'patient_cf');
    if (decision.identity.patientId) return `Paziente collegato: ${decision.identity.patientId}`;
    if (patientCf) return `CF paziente candidato: ${patientCf.value}`;
    if (decision.identity.taxCodes.length > 0) return 'CF presenti ma non paziente deterministico';
    return 'Nessun paziente candidato deterministico';
}

function buildNonWriteSummary(decision: DocumentDecision): string[] {
    const summary: string[] = [];
    for (const assertion of decision.negativeAssertions) {
        const label = FORBIDDEN_REASON_LABELS[assertion] ?? assertion;
        if (!summary.includes(label)) summary.push(label);
    }
    if (decision.writePlan.forbiddenActions.length > 0) {
        summary.push(`${decision.writePlan.forbiddenActions.length} azioni vietate`);
    }
    if (decision.writePlan.blockedActions.length > 0) {
        summary.push(`${decision.writePlan.blockedActions.length} azioni bloccate`);
    }
    return summary;
}

/* @Codex */
export function buildDocumentDecisionReviewViewModel(decision: DocumentDecision): DocumentDecisionReviewViewModel {
    return {
        title: 'Review decisione documento',
        documentType: DOCUMENT_TYPE_LABELS[decision.classification.type],
        patientCandidate: patientCandidate(decision),
        confidence: decision.classification.confidence,
        evidence: decision.evidenceRefs.slice(0, 6).map((evidence) => ({
            id: evidence.id,
            snippet: evidence.snippet,
        })),
        allowedActions: decision.writePlan.allowedActions.map(actionView),
        blockedActions: decision.writePlan.blockedActions.map(actionView),
        forbiddenActions: decision.writePlan.forbiddenActions.map(actionView),
        humanRequiredFor: decision.humanRequiredFor.map((item) => HUMAN_REQUIREMENT_LABELS[item]),
        nonWriteSummary: buildNonWriteSummary(decision),
    };
}
