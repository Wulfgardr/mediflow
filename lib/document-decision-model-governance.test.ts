/* @Codex */
import test from 'node:test';
/* @Codex */
import assert from 'node:assert/strict';
/* @Codex */
import {
    buildDocumentDecision,
    createDocumentDecisionEvidenceRef,
} from './document-decision';
/* @Codex */
import {
    DOCUMENT_DECISION_MODEL_GOVERNANCE_VERSION,
    documentDecisionModelPolicies,
    validateDocumentDecisionModelGovernance,
} from './document-decision-model-governance';

const baseSource = {
    documentId: 'synthetic-model-governance-doc',
    sha256: 'synthetic-model-governance-sha256',
    mimeType: 'application/pdf',
    pageCount: 1,
    textState: 'text_present' as const,
    ocrStatus: 'not_needed' as const,
};

test('model governance publishes lane policies for local LLM, deterministic write, OCR, and shadow eval', () => {
    const policies = documentDecisionModelPolicies();

    assert.equal(policies.some((policy) => policy.lane === 'ocr' && policy.mode === 'local_ocr_only'), true);
    assert.equal(policies.some((policy) => policy.lane === 'write_plan' && policy.mode === 'human_review_only'), true);
    assert.equal(policies.some((policy) => policy.lane === 'benchmark_shadow_eval' && policy.mode === 'shadow_eval_only'), true);
});

test('model governance accepts bounded local LLM proposals when clinical review is explicit', () => {
    const decision = buildDocumentDecision({
        source: baseSource,
        classification: {
            type: 'specialist_service_prescription',
            family: 'prescription',
            confidence: 'medium',
            rationale: 'Classificazione bounded sintetica.',
            evidenceRefs: ['ev:1'],
        },
        evidenceRefs: [createDocumentDecisionEvidenceRef('ev:1', 'Visita specialistica sintetica.')],
        proposedActions: [{
            id: 'action:service',
            kind: 'create_service_prescription_proposal',
            target: 'service:synthetic',
            evidenceRefs: ['ev:1'],
            confidence: 'medium',
            rationale: 'Proposta evidence-bound da review.',
        }],
        humanRequiredFor: ['clinical_write'],
        model: {
            recognitionMode: 'local_llm',
            modelName: 'synthetic-local-model',
            generatedAt: '2026-05-08T12:00:00.000Z',
        },
    });

    const result = validateDocumentDecisionModelGovernance(decision);
    assert.equal(result.schemaVersion, DOCUMENT_DECISION_MODEL_GOVERNANCE_VERSION);
    assert.equal(result.valid, true);
});

test('model governance rejects generative deterministic apply mode', () => {
    const decision = buildDocumentDecision({
        source: baseSource,
        classification: {
            type: 'medication_prescription',
            family: 'prescription',
            confidence: 'medium',
            rationale: 'Ricetta sintetica.',
            evidenceRefs: ['ev:1'],
        },
        evidenceRefs: [createDocumentDecisionEvidenceRef('ev:1', 'Farmaco prescritto sintetico.')],
        proposedActions: [{
            id: 'action:medication',
            kind: 'create_medication_prescription_proposal',
            target: 'medication:synthetic',
            evidenceRefs: ['ev:1'],
            confidence: 'medium',
            rationale: 'Proposta evidence-bound.',
        }],
        humanRequiredFor: ['clinical_write'],
        model: {
            recognitionMode: 'hybrid',
            generatedAt: '2026-05-08T12:00:00.000Z',
        },
    });
    const unsafeDecision = {
        ...decision,
        writePlan: {
            ...decision.writePlan,
            mode: 'deterministic_apply_after_review' as const,
        },
    };

    const result = validateDocumentDecisionModelGovernance(unsafeDecision);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /cannot directly enter deterministic apply mode/i);
});

test('model governance rejects LLM patient identity resolution', () => {
    const decision = buildDocumentDecision({
        source: baseSource,
        classification: {
            type: 'identity_document',
            family: 'identity',
            confidence: 'medium',
            rationale: 'Documento identita sintetico.',
            evidenceRefs: ['ev:1'],
        },
        evidenceRefs: [createDocumentDecisionEvidenceRef('ev:1', 'Paziente CF TSTTST00A00A000A')],
        identity: {
            action: 'link_existing_patient',
            patientId: 'synthetic-patient-1',
            taxCodes: [{
                value: 'TSTTST00A00A000A',
                role: 'patient_cf',
                confidence: 'high',
                evidenceRefs: ['ev:1'],
            }],
            humanRequired: false,
        },
        model: {
            recognitionMode: 'local_llm',
            generatedAt: '2026-05-08T12:00:00.000Z',
        },
    });

    const result = validateDocumentDecisionModelGovernance(decision);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /cannot directly resolve patient identity/i);
});
