#!/usr/bin/env node

/* @Codex */
import {
    applyDocumentDecisionGuardrails,
    buildDocumentDecision,
    createDocumentDecisionEvidenceRef,
    type DocumentDecision,
    type DocumentDecisionAction,
    type DocumentDecisionForbiddenReason,
} from './document-decision';

/* @Codex */
export const DOCUMENT_DECISION_FAILURE_COUNTERS = [
    'doctor_cf_as_patient',
    'service_to_drug_upcast',
    'lab_to_therapy_upcast',
    'prescription_to_active_therapy',
    'diagnostic_question_to_diagnosis',
    'mute_pdf_structured_write',
    'false_create_patient',
    'partial_prosthetic_force_structured',
] as const;

/* @Codex */
export type DocumentDecisionFailureCounter = typeof DOCUMENT_DECISION_FAILURE_COUNTERS[number];

/* @Codex */
export interface DocumentDecisionFailureCounterCase {
    id: string;
    counter: DocumentDecisionFailureCounter;
    expectedAssertion: DocumentDecisionForbiddenReason;
    decision: DocumentDecision;
}

/* @Codex */
export interface DocumentDecisionFailureCounterResult {
    id: string;
    counter: DocumentDecisionFailureCounter;
    passed: boolean;
    expectedAssertion: DocumentDecisionForbiddenReason;
    observedAssertions: DocumentDecisionForbiddenReason[];
    forbiddenActionCount: number;
}

/* @Codex */
export interface DocumentDecisionFailureCounterReport {
    generatedAt: string;
    schemaVersion: 'mediflow.document_decision_failure_counter.v1';
    counters: Record<DocumentDecisionFailureCounter, number>;
    totalFailureCount: number;
    cases: DocumentDecisionFailureCounterResult[];
}

const baseSource = {
    documentId: 'synthetic-benchmark-doc',
    sha256: 'synthetic-only',
    mimeType: 'application/pdf',
    pageCount: 1,
    textState: 'text_present' as const,
    ocrStatus: 'not_needed' as const,
};

function action(kind: DocumentDecisionAction['kind'], target: string = kind): DocumentDecisionAction {
    return {
        id: `action:${target}`,
        kind,
        target,
        evidenceRefs: ['ev:1'],
        confidence: 'high',
        rationale: 'Synthetic adversarial benchmark action.',
    };
}

function evidence(snippet = 'Synthetic evidence snippet') {
    return [createDocumentDecisionEvidenceRef('ev:1', snippet, 'synthetic-document')];
}

function buildCases(): DocumentDecisionFailureCounterCase[] {
    return [
        {
            id: 'doctor-cf-as-patient',
            counter: 'doctor_cf_as_patient',
            expectedAssertion: 'ambiguous_identity',
            decision: buildDocumentDecision({
                source: baseSource,
                classification: {
                    type: 'identity_document',
                    family: 'identity',
                    confidence: 'medium',
                    rationale: 'Synthetic prescription header with prescriber CF only.',
                    evidenceRefs: ['ev:1'],
                },
                evidenceRefs: evidence('CF RSSMRA80A01F205X appears under medico prescrittore'),
                identity: {
                    action: 'create_patient_candidate',
                    taxCodes: [{
                        value: 'RSSMRA80A01F205X',
                        role: 'physician_cf',
                        confidence: 'high',
                        evidenceRefs: ['ev:1'],
                    }],
                    humanRequired: true,
                },
                proposedActions: [action('create_patient_candidate', 'patient-from-physician-cf')],
            }),
        },
        {
            id: 'service-to-drug-upcast',
            counter: 'service_to_drug_upcast',
            expectedAssertion: 'service_prescription_is_not_drug',
            decision: buildDocumentDecision({
                source: baseSource,
                classification: {
                    type: 'specialist_service_prescription',
                    family: 'prescription',
                    confidence: 'high',
                    rationale: 'Synthetic specialist service prescription.',
                    evidenceRefs: ['ev:1'],
                },
                evidenceRefs: evidence('Prescritta visita otorinolaringoiatrica'),
                proposedActions: [action('create_medication_prescription_proposal', 'orl-as-drug')],
            }),
        },
        {
            id: 'lab-to-therapy-upcast',
            counter: 'lab_to_therapy_upcast',
            expectedAssertion: 'lab_or_imaging_is_not_therapy',
            decision: buildDocumentDecision({
                source: baseSource,
                classification: {
                    type: 'lab_prescription',
                    family: 'prescription',
                    confidence: 'high',
                    rationale: 'Synthetic lab prescription.',
                    evidenceRefs: ['ev:1'],
                },
                evidenceRefs: evidence('Prescritti emocromo e creatinina'),
                proposedActions: [action('create_active_therapy', 'lab-as-therapy')],
            }),
        },
        {
            id: 'prescription-to-active-therapy',
            counter: 'prescription_to_active_therapy',
            expectedAssertion: 'prescription_is_not_active_therapy',
            decision: buildDocumentDecision({
                source: baseSource,
                classification: {
                    type: 'medication_prescription',
                    family: 'prescription',
                    confidence: 'high',
                    rationale: 'Synthetic medication prescription.',
                    evidenceRefs: ['ev:1'],
                },
                evidenceRefs: evidence('Prescritta amoxicillina 1 g'),
                proposedActions: [action('create_active_therapy', 'prescription-as-active-therapy')],
            }),
        },
        {
            id: 'diagnostic-question-to-diagnosis',
            counter: 'diagnostic_question_to_diagnosis',
            expectedAssertion: 'diagnostic_question_is_not_diagnosis',
            decision: buildDocumentDecision({
                source: baseSource,
                classification: {
                    type: 'specialist_service_prescription',
                    family: 'prescription',
                    confidence: 'medium',
                    rationale: 'Synthetic referral with diagnostic question.',
                    evidenceRefs: ['ev:1'],
                },
                evidenceRefs: evidence('Quesito diagnostico: sospetta ipoacusia'),
                domains: {
                    diagnosticQuestions: [{
                        id: 'diagnostic-question:hearing',
                        label: 'Sospetta ipoacusia',
                        action: 'create_diagnosis_candidate',
                        confidence: 'medium',
                        evidenceRefs: ['ev:1'],
                        rationale: 'Adversarial upcast from question to diagnosis.',
                    }],
                },
            }),
        },
        {
            id: 'mute-pdf-structured-write',
            counter: 'mute_pdf_structured_write',
            expectedAssertion: 'ocr_required',
            decision: buildDocumentDecision({
                source: {
                    ...baseSource,
                    documentId: 'synthetic-muted-pdf',
                    textState: 'text_absent',
                    ocrStatus: 'needed',
                },
                classification: {
                    type: 'mute_or_scanned',
                    family: 'unknown',
                    confidence: 'blocked',
                    rationale: 'Synthetic mute PDF.',
                    evidenceRefs: [],
                },
                proposedActions: [action('create_diagnosis_candidate', 'mute-pdf-diagnosis')],
            }),
        },
        {
            id: 'false-create-patient',
            counter: 'false_create_patient',
            expectedAssertion: 'ambiguous_identity',
            decision: buildDocumentDecision({
                source: baseSource,
                classification: {
                    type: 'identity_document',
                    family: 'identity',
                    confidence: 'low',
                    rationale: 'Synthetic named folder without reliable CF.',
                    evidenceRefs: ['ev:1'],
                },
                evidenceRefs: evidence('Cartella nominativa senza codice fiscale paziente esplicito'),
                identity: {
                    action: 'create_patient_candidate',
                    taxCodes: [],
                    humanRequired: true,
                },
                proposedActions: [action('create_patient_candidate', 'folder-name-as-patient')],
            }),
        },
        {
            id: 'partial-prosthetic-force-structured',
            counter: 'partial_prosthetic_force_structured',
            expectedAssertion: 'prosthetic_required_fields_missing',
            decision: buildDocumentDecision({
                source: baseSource,
                classification: {
                    type: 'prosthetic_prescription',
                    family: 'prosthetic',
                    confidence: 'medium',
                    rationale: 'Synthetic incomplete prosthetic document.',
                    evidenceRefs: ['ev:1'],
                },
                evidenceRefs: evidence('Ausilio deambulazione senza codice ISO e quantita'),
                domains: {
                    prosthetics: [{
                        id: 'prosthetic:partial',
                        label: 'Ausilio deambulazione',
                        action: 'create_prosthetic_prescription_proposal',
                        confidence: 'medium',
                        evidenceRefs: ['ev:1'],
                        rationale: 'Missing ISO and quantity.',
                        completeness: 'partial',
                        requiredFieldsPresent: ['label'],
                        missingRequiredFields: ['isoCode', 'quantity'],
                    }],
                },
            }),
        },
    ];
}

function scoreCase(testCase: DocumentDecisionFailureCounterCase): DocumentDecisionFailureCounterResult {
    const guarded = applyDocumentDecisionGuardrails(testCase.decision);
    const passed = guarded.negativeAssertions.includes(testCase.expectedAssertion)
        && guarded.writePlan.forbiddenActions.length > 0
        && guarded.writePlan.allowedActions.length === 0;

    return {
        id: testCase.id,
        counter: testCase.counter,
        passed,
        expectedAssertion: testCase.expectedAssertion,
        observedAssertions: guarded.negativeAssertions,
        forbiddenActionCount: guarded.writePlan.forbiddenActions.length,
    };
}

/* @Codex */
export function runDocumentDecisionFailureCounterBenchmark(): DocumentDecisionFailureCounterReport {
    const results = buildCases().map(scoreCase);
    const counters = Object.fromEntries(
        DOCUMENT_DECISION_FAILURE_COUNTERS.map((counter) => [
            counter,
            results.filter((result) => result.counter === counter && !result.passed).length,
        ]),
    ) as Record<DocumentDecisionFailureCounter, number>;
    const totalFailureCount = Object.values(counters).reduce((sum, count) => sum + count, 0);

    return {
        generatedAt: new Date().toISOString(),
        schemaVersion: 'mediflow.document_decision_failure_counter.v1',
        counters,
        totalFailureCount,
        cases: results,
    };
}
