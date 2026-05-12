/* @Codex */
import test from 'node:test';
/* @Codex */
import assert from 'node:assert/strict';
/* @Codex */
import type { PatientDocumentReviewDraft } from './patient-document-review';
/* @Codex */
import { buildPatientDocumentDecision } from './patient-document-decision';
/* @Codex */
import { validateDocumentDecisionModelGovernance } from './document-decision-model-governance';

const baseDraft: PatientDocumentReviewDraft = {
    source: 'hybrid',
    confidence: 0.82,
    sourceLabel: 'Documento sintetico AI + fallback',
    sourceExcerpt: 'Dimissione sintetica: terapia alla dimissione Amoxicillina 1 g ogni 12 ore.',
    quality: {
        level: 'green',
        reason: 'Testo sintetico leggibile.',
    },
    fields: [{
        key: 'lastName',
        label: 'Cognome',
        value: 'Test',
        included: true,
        kind: 'text',
        sourceLabel: 'Documento sintetico',
    }],
    diagnoses: [{
        id: 'diagnosis:synthetic',
        code: 'J00',
        description: 'Raffreddore comune sintetico',
        system: 'ICD-10',
        evidence: 'ICD-10 J00 esplicito nel documento sintetico.',
        confidence: 'high',
        included: true,
    }],
    medications: [{
        id: 'medication:synthetic',
        drugName: 'Amoxicillina',
        dosage: '1 g ogni 12 ore',
        therapyState: 'active',
        matchType: 'catalog',
        evidence: 'Terapia alla dimissione: Amoxicillina 1 g ogni 12 ore.',
        confidence: 'high',
        included: true,
        sourceLabel: 'Documento sintetico',
    }],
};

test('patient document decision projects reviewed fields, diagnoses, therapies, and evidence', () => {
    const decision = buildPatientDocumentDecision(baseDraft);

    assert.equal(decision.classification.type, 'specialist_report');
    assert.equal(decision.evidenceRefs.length >= 4, true);
    assert.ok(decision.humanRequiredFor.includes('clinical_write'));
    assert.deepEqual(
        decision.writePlan.allowedActions.map((action) => action.kind),
        ['update_patient_fields', 'create_diagnosis_candidate', 'create_active_therapy'],
    );
    assert.deepEqual(decision.writePlan.forbiddenActions, []);
});

test('patient document decision keeps excluded therapies out of active therapy writes', () => {
    const draft: PatientDocumentReviewDraft = {
        ...baseDraft,
        medications: [{
            ...baseDraft.medications[0],
            included: false,
            blockedReason: 'Terapia non confermata come corrente nel documento',
        }],
    };

    const decision = buildPatientDocumentDecision(draft);
    assert.equal(decision.writePlan.allowedActions.some((action) => action.kind === 'create_active_therapy'), false);
    assert.equal(decision.writePlan.blockedActions.some((action) => action.kind === 'blocked'), true);
    assert.equal(decision.negativeAssertions.includes('prescription_is_not_active_therapy'), false);
});

test('patient document decision stays review-required and never deterministic apply', () => {
    const decision = buildPatientDocumentDecision(baseDraft);

    assert.equal(decision.writePlan.mode, 'review_required');
    assert.ok(decision.model.recognitionMode === 'hybrid');
});

test('patient document decision satisfies model governance for hybrid reviewed proposals', () => {
    const decision = buildPatientDocumentDecision(baseDraft);
    const governance = validateDocumentDecisionModelGovernance(decision);

    assert.equal(governance.valid, true);
    assert.deepEqual(governance.errors, []);
});
