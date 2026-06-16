/* @Codex */
import test from 'node:test';
/* @Codex */
import assert from 'node:assert/strict';
/* @Codex */
import {
    DOCUMENT_DECISION_SCHEMA_VERSION,
    DOCUMENT_DECISION_UNSPECIFIED_GENERATED_AT,
    applyDocumentDecisionGuardrails,
    buildDocumentDecision,
    createDocumentDecisionEvidenceRef,
    validateDocumentDecision,
    type DocumentDecisionAction,
} from './document-decision';

const baseSource = {
    documentId: 'synthetic-doc-001',
    sha256: 'syntheticsha256',
    mimeType: 'application/pdf',
    pageCount: 1,
    textState: 'text_present' as const,
    ocrStatus: 'not_needed' as const,
};

function action(kind: DocumentDecisionAction['kind'], evidenceRefs = ['ev:1']): DocumentDecisionAction {
    return {
        id: `action:${kind}`,
        kind,
        target: 'synthetic-target',
        evidenceRefs,
        confidence: 'high',
        rationale: 'Synthetic action for contract test.',
    };
}

test('document decision v1 accepts service prescriptions as non-drug proposals', () => {
    const decision = buildDocumentDecision({
        source: baseSource,
        classification: {
            type: 'specialist_service_prescription',
            family: 'prescription',
            confidence: 'high',
            rationale: 'Impegnativa per visita ORL.',
            evidenceRefs: ['ev:1'],
        },
        evidenceRefs: [
            createDocumentDecisionEvidenceRef('ev:1', 'Visita otorinolaringoiatrica di controllo'),
        ],
        domains: {
            servicePrescriptions: [
                {
                    id: 'service:orl-visit',
                    label: 'Visita otorinolaringoiatrica',
                    action: 'create_service_prescription_proposal',
                    confidence: 'high',
                    evidenceRefs: ['ev:1'],
                    rationale: 'Prestazione specialistica, non farmaco.',
                },
            ],
        },
    });

    assert.equal(decision.schemaVersion, DOCUMENT_DECISION_SCHEMA_VERSION);
    assert.equal(decision.model.generatedAt, DOCUMENT_DECISION_UNSPECIFIED_GENERATED_AT);
    assert.equal(validateDocumentDecision(decision).valid, true);
    assert.equal(decision.writePlan.allowedActions[0].kind, 'create_service_prescription_proposal');
});

test('document decision guardrail blocks ORL service prescription promoted to drug therapy', () => {
    const decision = buildDocumentDecision({
        source: baseSource,
        classification: {
            type: 'specialist_service_prescription',
            family: 'prescription',
            confidence: 'high',
            rationale: 'Impegnativa per visita ORL.',
            evidenceRefs: ['ev:1'],
        },
        evidenceRefs: [
            createDocumentDecisionEvidenceRef('ev:1', 'Prescritta visita otorinolaringoiatrica'),
        ],
        proposedActions: [
            action('create_medication_prescription_proposal'),
        ],
    });

    const validation = validateDocumentDecision(decision);
    assert.equal(validation.valid, false);
    assert.match(validation.errors.join('\n'), /cannot be promoted to drug or therapy/i);

    const guarded = applyDocumentDecisionGuardrails(decision);
    assert.deepEqual(guarded.writePlan.allowedActions, []);
    assert.equal(guarded.writePlan.forbiddenActions.length, 1);
    assert.ok(guarded.negativeAssertions.includes('service_prescription_is_not_drug'));
});

test('document decision guardrail only forbids the offending action', () => {
    const decision = buildDocumentDecision({
        source: baseSource,
        classification: {
            type: 'specialist_service_prescription',
            family: 'prescription',
            confidence: 'high',
            rationale: 'Impegnativa per visita ORL.',
            evidenceRefs: ['ev:1'],
        },
        evidenceRefs: [
            createDocumentDecisionEvidenceRef('ev:1', 'Prescritta visita otorinolaringoiatrica'),
        ],
        proposedActions: [
            action('create_service_prescription_proposal'),
            action('create_medication_prescription_proposal'),
        ],
    });

    const guarded = applyDocumentDecisionGuardrails(decision);
    assert.deepEqual(
        guarded.writePlan.allowedActions.map((item) => item.kind),
        ['create_service_prescription_proposal'],
    );
    assert.deepEqual(
        guarded.writePlan.forbiddenActions.map((item) => item.target),
        ['synthetic-target'],
    );
});

test('document decision guardrail blocks medication prescription as active therapy', () => {
    const decision = buildDocumentDecision({
        source: baseSource,
        classification: {
            type: 'medication_prescription',
            family: 'prescription',
            confidence: 'high',
            rationale: 'Ricetta farmaco.',
            evidenceRefs: ['ev:1'],
        },
        evidenceRefs: [
            createDocumentDecisionEvidenceRef('ev:1', 'Amoxicillina 1 g prescritta'),
        ],
        proposedActions: [
            action('create_active_therapy'),
        ],
    });

    const guarded = applyDocumentDecisionGuardrails(decision);
    assert.ok(guarded.negativeAssertions.includes('prescription_is_not_active_therapy'));
    assert.equal(guarded.writePlan.forbiddenActions[0].kind, 'blocked');
});

test('document decision guardrail blocks OCR-needed structured writes', () => {
    const decision = buildDocumentDecision({
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
            rationale: 'PDF senza text layer.',
            evidenceRefs: [],
        },
        proposedActions: [
            action('create_diagnosis_candidate', []),
        ],
    });

    const guarded = applyDocumentDecisionGuardrails(decision);
    assert.ok(guarded.negativeAssertions.includes('ocr_required'));
    assert.deepEqual(guarded.writePlan.allowedActions, []);
});

test('document decision guardrail blocks partial text structured writes', () => {
    const decision = buildDocumentDecision({
        source: {
            ...baseSource,
            textState: 'text_partial',
            ocrStatus: 'queued',
        },
        classification: {
            type: 'unknown',
            family: 'unknown',
            confidence: 'low',
            rationale: 'Testo parziale.',
            evidenceRefs: ['ev:1'],
        },
        evidenceRefs: [createDocumentDecisionEvidenceRef('ev:1', 'Testo parziale sintetico')],
        proposedActions: [
            action('create_diagnosis_candidate'),
        ],
    });

    const guarded = applyDocumentDecisionGuardrails(decision);
    assert.ok(guarded.negativeAssertions.includes('ocr_required'));
    assert.deepEqual(guarded.writePlan.allowedActions, []);
});

test('document decision records boundary negative assertions even without proposed writes', () => {
    const decision = buildDocumentDecision({
        source: baseSource,
        classification: {
            type: 'specialist_service_prescription',
            family: 'prescription',
            confidence: 'high',
            rationale: 'Impegnativa per visita.',
            evidenceRefs: ['ev:1'],
        },
        evidenceRefs: [createDocumentDecisionEvidenceRef('ev:1', 'Visita specialistica')],
        proposedActions: [],
    });

    const guarded = applyDocumentDecisionGuardrails(decision);
    assert.equal(validateDocumentDecision(guarded).valid, true);
    assert.ok(guarded.negativeAssertions.includes('service_prescription_is_not_drug'));
});

test('document decision guardrail requires role-aware patient tax code before create', () => {
    const decision = buildDocumentDecision({
        source: baseSource,
        classification: {
            type: 'identity_document',
            family: 'identity',
            confidence: 'medium',
            rationale: 'Documento anagrafico sintetico.',
            evidenceRefs: ['ev:1'],
        },
        evidenceRefs: [createDocumentDecisionEvidenceRef('ev:1', 'CF medico e CF paziente presenti')],
        identity: {
            action: 'create_patient_candidate',
            taxCodes: [
                {
                    value: 'RSSMRA80A01F205X',
                    role: 'unknown_cf',
                    confidence: 'medium',
                    evidenceRefs: ['ev:1'],
                },
            ],
            humanRequired: true,
        },
        proposedActions: [
            action('create_patient_candidate'),
        ],
    });

    const guarded = applyDocumentDecisionGuardrails(decision);
    assert.ok(guarded.negativeAssertions.includes('ambiguous_identity'));
});

test('document decision validation surfaces structured reason codes alongside errors', () => {
    const decision = buildDocumentDecision({
        source: baseSource,
        classification: {
            type: 'specialist_service_prescription',
            family: 'prescription',
            confidence: 'high',
            rationale: 'Impegnativa per visita ORL.',
            evidenceRefs: ['ev:1'],
        },
        evidenceRefs: [
            createDocumentDecisionEvidenceRef('ev:1', 'Prescritta visita otorinolaringoiatrica'),
        ],
        proposedActions: [
            action('create_medication_prescription_proposal'),
        ],
    });

    const validation = validateDocumentDecision(decision);
    assert.equal(validation.valid, false);
    assert.ok(validation.reasons.includes('service_prescription_is_not_drug'));
    assert.ok(validation.errors.length > 0);
});

test('document decision build coerces link_existing_patient without patientId into review identity', () => {
    const decision = buildDocumentDecision({
        source: baseSource,
        classification: {
            type: 'identity_document',
            family: 'identity',
            confidence: 'medium',
            rationale: 'Documento identita sintetico senza patientId.',
            evidenceRefs: ['ev:1'],
        },
        evidenceRefs: [createDocumentDecisionEvidenceRef('ev:1', 'CF paziente presente, patientId non risolto.')],
        identity: {
            action: 'link_existing_patient',
            taxCodes: [{
                value: 'TSTTST00A00A000A',
                role: 'patient_cf',
                confidence: 'high',
                evidenceRefs: ['ev:1'],
            }],
            humanRequired: false,
        },
    });

    assert.equal(decision.identity.action, 'review_identity');
    assert.equal(decision.identity.patientId, undefined);
    assert.equal(decision.identity.humanRequired, true);
});

test('document decision guardrail blocks link_patient action when identity lacks patientId', () => {
    const decision = buildDocumentDecision({
        source: baseSource,
        classification: {
            type: 'identity_document',
            family: 'identity',
            confidence: 'high',
            rationale: 'Documento anagrafico sintetico.',
            evidenceRefs: ['ev:1'],
        },
        evidenceRefs: [createDocumentDecisionEvidenceRef('ev:1', 'CF paziente sintetico.')],
        identity: {
            action: 'link_existing_patient',
            taxCodes: [{
                value: 'TSTTST00A00A000A',
                role: 'patient_cf',
                confidence: 'high',
                evidenceRefs: ['ev:1'],
            }],
            humanRequired: false,
        },
        proposedActions: [action('link_patient')],
    });

    const guarded = applyDocumentDecisionGuardrails(decision);
    assert.equal(guarded.identity.action, 'review_identity');
    assert.ok(guarded.negativeAssertions.includes('ambiguous_identity'));
    assert.equal(guarded.writePlan.forbiddenActions[0].blockedReason, 'ambiguous_identity');
    assert.deepEqual(guarded.writePlan.allowedActions, []);
});

test('document decision guardrail keeps partial prosthetics out of structured writes', () => {
    const decision = buildDocumentDecision({
        source: baseSource,
        classification: {
            type: 'prosthetic_prescription',
            family: 'prosthetic',
            confidence: 'medium',
            rationale: 'Protesica incompleta.',
            evidenceRefs: ['ev:1'],
        },
        evidenceRefs: [createDocumentDecisionEvidenceRef('ev:1', 'Prescrizione ausilio senza codice ISO')],
        domains: {
            prosthetics: [
                {
                    id: 'prosthetic:partial',
                    label: 'Ausilio deambulazione',
                    action: 'create_prosthetic_prescription_proposal',
                    confidence: 'medium',
                    evidenceRefs: ['ev:1'],
                    rationale: 'Manca codice ISO.',
                    completeness: 'partial',
                    requiredFieldsPresent: ['label'],
                    missingRequiredFields: ['isoCode', 'quantity'],
                },
            ],
        },
    });

    const guarded = applyDocumentDecisionGuardrails(decision);
    assert.ok(guarded.negativeAssertions.includes('prosthetic_required_fields_missing'));
});
