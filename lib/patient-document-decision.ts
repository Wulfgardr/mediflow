/* @Codex */
import {
    applyDocumentDecisionGuardrails,
    buildDocumentDecision,
    createDocumentDecisionEvidenceRef,
    type DocumentDecision,
    type DocumentDecisionAction,
    type DocumentDecisionClassification,
    type DocumentDecisionDomainItem,
    type DocumentDecisionEvidenceRef,
} from './document-decision';
/* @Codex */
import type { PatientDocumentReviewDraft } from './patient-document-review';
/* @Codex */
import { buildPatientImportDecision } from './patient-import-decision';

function compact(value: string | undefined): string {
    return (value || '').replace(/\s+/g, ' ').trim();
}

function evidenceId(prefix: string, index: number): string {
    return `${prefix}:${index + 1}`;
}

function buildEvidence(draft: PatientDocumentReviewDraft): DocumentDecisionEvidenceRef[] {
    const evidence: DocumentDecisionEvidenceRef[] = [];
    if (draft.sourceExcerpt) {
        evidence.push(createDocumentDecisionEvidenceRef('source:excerpt', draft.sourceExcerpt, 'patient-document-review'));
    }

    draft.fields.forEach((field, index) => {
        evidence.push(createDocumentDecisionEvidenceRef(
            evidenceId('field', index),
            `${field.label}: ${field.value}`,
            'patient-document-review',
        ));
    });
    draft.diagnoses.forEach((diagnosis, index) => {
        evidence.push(createDocumentDecisionEvidenceRef(
            evidenceId('diagnosis', index),
            compact(diagnosis.evidence) || `${diagnosis.system} ${diagnosis.code}: ${diagnosis.description}`,
            'patient-document-review',
        ));
    });
    draft.medications.forEach((medication, index) => {
        evidence.push(createDocumentDecisionEvidenceRef(
            evidenceId('medication', index),
            compact(medication.evidence) || [medication.drugName, medication.dosage, medication.motivation].filter(Boolean).join(' '),
            'patient-document-review',
        ));
    });

    return evidence;
}

function classifyDraft(draft: PatientDocumentReviewDraft): DocumentDecisionClassification {
    if (draft.diagnoses.length > 0) return 'specialist_report';
    if (draft.fields.some((field) => field.key === 'taxCode')) return 'identity_document';
    return 'unknown';
}

function confidenceFromDraft(draft: PatientDocumentReviewDraft): DocumentDecision['classification']['confidence'] {
    if (draft.confidence >= 0.8) return 'high';
    if (draft.confidence >= 0.45) return 'medium';
    return 'low';
}

function actionFromDomain(item: DocumentDecisionDomainItem): DocumentDecisionAction {
    return {
        id: `action:${item.id}`,
        kind: item.action,
        target: item.id,
        evidenceRefs: item.evidenceRefs,
        confidence: item.confidence,
        rationale: item.rationale,
        blockedReason: item.blockedReason,
    };
}

/* @Codex */
export function buildPatientDocumentDecision(draft: PatientDocumentReviewDraft): DocumentDecision {
    const importDecision = buildPatientImportDecision(draft);
    const evidenceRefs = buildEvidence(draft);
    const fallbackEvidenceRef = evidenceRefs[0]?.id ?? 'source:excerpt';
    const patientFields = importDecision.fieldDecisions.map((field, index): DocumentDecisionDomainItem => ({
        id: `patient-field:${field.key}`,
        label: field.label,
        action: field.action === 'apply' ? 'update_patient_fields' : 'blocked',
        confidence: confidenceFromDraft(draft),
        evidenceRefs: [evidenceId('field', index)],
        rationale: field.rationale,
        blockedReason: field.action === 'apply' ? undefined : 'missing_evidence_ref',
    }));
    const clinicalFacts = importDecision.diagnosisDecisions.map((diagnosis, index): DocumentDecisionDomainItem => ({
        id: `diagnosis:${diagnosis.id}`,
        label: diagnosis.description,
        action: diagnosis.action === 'apply_structured' ? 'create_diagnosis_candidate' : 'blocked',
        confidence: diagnosis.confidence ?? confidenceFromDraft(draft),
        evidenceRefs: [evidenceId('diagnosis', index)],
        rationale: diagnosis.rationale,
        blockedReason: diagnosis.action === 'apply_structured' ? undefined : 'diagnostic_question_is_not_diagnosis',
    }));
    const medicationPrescriptions = importDecision.therapyDecisions.map((therapy, index): DocumentDecisionDomainItem => ({
        id: `therapy:${therapy.id}`,
        label: therapy.drugName,
        action: therapy.action === 'persist_structured'
            ? 'create_active_therapy'
            : therapy.action === 'append_note'
                ? 'append_review_note'
                : 'blocked',
        confidence: therapy.confidence ?? confidenceFromDraft(draft),
        evidenceRefs: [evidenceId('medication', index)],
        rationale: therapy.rationale,
        blockedReason: therapy.action === 'persist_structured' ? undefined : 'prescription_is_not_active_therapy',
    }));
    const proposedActions = [
        ...patientFields,
        ...clinicalFacts,
        ...medicationPrescriptions,
    ].map(actionFromDomain);

    return applyDocumentDecisionGuardrails(buildDocumentDecision({
        source: {
            documentId: `patient-document-review:${draft.source}`,
            textState: 'text_present',
            ocrStatus: draft.source === 'regex' ? 'not_needed' : 'completed',
        },
        classification: {
            type: classifyDraft(draft),
            family: draft.medications.length > 0 ? 'prescription' : draft.diagnoses.length > 0 ? 'report' : 'unknown',
            confidence: confidenceFromDraft(draft),
            rationale: draft.quality?.reason || 'Decisione derivata dalla review documentale prima dell apply al form.',
            evidenceRefs: [fallbackEvidenceRef],
        },
        evidenceRefs,
        domains: {
            patientFields,
            clinicalFacts,
            medicationPrescriptions,
        },
        proposedActions,
        humanRequiredFor: ['clinical_write', 'identity_resolution'],
        model: {
            recognitionMode: draft.source === 'regex' ? 'deterministic' : 'hybrid',
        },
    }));
}
