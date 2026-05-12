/* @Codex */
import test from 'node:test';
/* @Codex */
import assert from 'node:assert/strict';
/* @Codex */
import {
    applyDocumentDecisionGuardrails,
    buildDocumentDecision,
    createDocumentDecisionEvidenceRef,
    validateDocumentDecision,
} from './document-decision';
/* @Codex */
import {
    buildReviewableDocumentDecisionDomains,
    createDiagnosticQuestionArtifact,
    createExemptionProposal,
    createMedicationPrescriptionProposal,
    createProstheticPrescriptionProposal,
    createServicePrescriptionProposal,
} from './document-domain-decisions';

const baseSource = {
    documentId: 'synthetic-domain-doc',
    sha256: 'syntheticdomainsha256',
    mimeType: 'application/pdf',
    pageCount: 1,
    textState: 'text_present' as const,
    ocrStatus: 'not_needed' as const,
};

const evidenceRefs = [createDocumentDecisionEvidenceRef('ev:1', 'Synthetic reviewable evidence.')];

const baseInput = {
    id: 'domain:item',
    label: 'Synthetic domain item',
    confidence: 'medium' as const,
    evidenceRefs: ['ev:1'],
    rationale: 'Synthetic domain extraction proposal.',
};

test('domain factory keeps medication prescriptions as proposals, not active therapies', () => {
    const item = createMedicationPrescriptionProposal({
        ...baseInput,
        id: 'medication-prescription:1',
        label: 'Amoxicillina 1 g prescritta',
    });

    assert.equal(item.action, 'create_medication_prescription_proposal');
});

test('domain factory maps service, lab, imaging, and screening prescriptions to distinct proposal lanes', () => {
    assert.equal(createServicePrescriptionProposal(baseInput, 'specialist').action, 'create_service_prescription_proposal');
    assert.equal(createServicePrescriptionProposal(baseInput, 'lab').action, 'create_lab_prescription_proposal');
    assert.equal(createServicePrescriptionProposal(baseInput, 'imaging').action, 'create_imaging_prescription_proposal');
    assert.equal(createServicePrescriptionProposal(baseInput, 'screening').action, 'create_screening_proposal');
});

test('domain factory keeps diagnostic question as question artifact, not diagnosis candidate', () => {
    const item = createDiagnosticQuestionArtifact({
        ...baseInput,
        id: 'diagnostic-question:1',
        label: 'Sospetta ipoacusia',
        rationale: 'Quesito diagnostico sintetico.',
    });
    const decision = buildDocumentDecision({
        source: baseSource,
        classification: {
            type: 'specialist_service_prescription',
            family: 'prescription',
            confidence: 'medium',
            rationale: 'Impegnativa con quesito.',
            evidenceRefs: ['ev:1'],
        },
        evidenceRefs,
        domains: buildReviewableDocumentDecisionDomains({
            diagnosticQuestions: [item],
        }),
    });

    assert.equal(item.action, 'create_diagnostic_question');
    assert.equal(validateDocumentDecision(decision).valid, true);
});

test('guardrails reject diagnostic question upcast to diagnosis candidate', () => {
    const decision = buildDocumentDecision({
        source: baseSource,
        classification: {
            type: 'specialist_service_prescription',
            family: 'prescription',
            confidence: 'medium',
            rationale: 'Impegnativa con quesito.',
            evidenceRefs: ['ev:1'],
        },
        evidenceRefs,
        domains: buildReviewableDocumentDecisionDomains({
            diagnosticQuestions: [{
                ...baseInput,
                id: 'diagnostic-question:upcast',
                label: 'Sospetta ipoacusia',
                action: 'create_diagnosis_candidate',
            }],
        }),
    });

    const guarded = applyDocumentDecisionGuardrails(decision);
    assert.ok(guarded.negativeAssertions.includes('diagnostic_question_is_not_diagnosis'));
    assert.equal(guarded.writePlan.forbiddenActions[0].blockedReason, 'diagnostic_question_is_not_diagnosis');
});

test('domain factory keeps exemption as reviewable proposal, not diagnosis', () => {
    const item = createExemptionProposal({
        ...baseInput,
        id: 'exemption:E01',
        label: 'E01',
        rationale: 'Codice esenzione sintetico esplicito.',
    });
    const decision = buildDocumentDecision({
        source: baseSource,
        classification: {
            type: 'exemption_document',
            family: 'exemption',
            confidence: 'medium',
            rationale: 'Documento esenzione.',
            evidenceRefs: ['ev:1'],
        },
        evidenceRefs,
        domains: buildReviewableDocumentDecisionDomains({
            exemptions: [item],
        }),
    });

    assert.equal(item.action, 'create_exemption_proposal');
    assert.equal(validateDocumentDecision(decision).valid, true);
});

test('domain factory blocks partial prosthetic prescriptions before structured write', () => {
    const item = createProstheticPrescriptionProposal({
        ...baseInput,
        id: 'prosthetic:partial',
        label: 'Ausilio deambulazione',
        requiredFieldsPresent: ['description'],
        missingRequiredFields: ['isoCode', 'quantity', 'clinicalReason'],
    });

    assert.equal(item.completeness, 'partial');
    assert.equal(item.action, 'blocked');
    assert.equal(item.blockedReason, 'prosthetic_required_fields_missing');
});

test('domain factory allows complete prosthetic prescriptions as reviewable proposals', () => {
    const item = createProstheticPrescriptionProposal({
        ...baseInput,
        id: 'prosthetic:complete',
        label: 'Ausilio deambulazione completo',
        requiredFieldsPresent: ['description', 'isoCode', 'quantity', 'clinicalReason'],
        missingRequiredFields: [],
    });
    const decision = buildDocumentDecision({
        source: baseSource,
        classification: {
            type: 'prosthetic_prescription',
            family: 'prosthetic',
            confidence: 'medium',
            rationale: 'Prescrizione protesica completa sintetica.',
            evidenceRefs: ['ev:1'],
        },
        evidenceRefs,
        domains: buildReviewableDocumentDecisionDomains({
            prosthetics: [item],
        }),
    });

    assert.equal(item.completeness, 'complete');
    assert.equal(item.action, 'create_prosthetic_prescription_proposal');
    assert.equal(validateDocumentDecision(decision).valid, true);
});
