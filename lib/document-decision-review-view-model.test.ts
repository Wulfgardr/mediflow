/* @Codex */
import test from 'node:test';
/* @Codex */
import assert from 'node:assert/strict';
/* @Codex */
import {
    applyDocumentDecisionGuardrails,
    buildDocumentDecision,
    createDocumentDecisionEvidenceRef,
} from './document-decision';
/* @Codex */
import { buildDocumentDecisionReviewViewModel } from './document-decision-review-view-model';

const baseSource = {
    documentId: 'synthetic-review-doc',
    sha256: 'synthetic-review-sha256',
    mimeType: 'application/pdf',
    pageCount: 1,
    textState: 'text_present' as const,
    ocrStatus: 'not_needed' as const,
};

test('review view model exposes document type, patient candidate, actions, and evidence', () => {
    const decision = buildDocumentDecision({
        source: baseSource,
        classification: {
            type: 'specialist_service_prescription',
            family: 'prescription',
            confidence: 'high',
            rationale: 'Impegnativa sintetica.',
            evidenceRefs: ['ev:1'],
        },
        evidenceRefs: [createDocumentDecisionEvidenceRef('ev:1', 'Visita ORL sintetica.')],
        identity: {
            action: 'review_identity',
            taxCodes: [{
                value: 'TSTTST00A00A000A',
                role: 'patient_cf',
                confidence: 'high',
                evidenceRefs: ['ev:1'],
            }],
        },
        proposedActions: [{
            id: 'action:service',
            kind: 'create_service_prescription_proposal',
            target: 'service:orl',
            evidenceRefs: ['ev:1'],
            confidence: 'high',
            rationale: 'Prestazione specialistica, non farmaco.',
        }],
    });

    const view = buildDocumentDecisionReviewViewModel(decision);
    assert.equal(view.documentType, 'Prescrizione prestazione specialistica');
    assert.match(view.patientCandidate, /CF paziente candidato/);
    assert.deepEqual(view.allowedActions.map((action) => action.label), ['Proposta prestazione specialistica']);
    assert.equal(view.evidence[0].snippet, 'Visita ORL sintetica.');
});

test('review view model explains forbidden writes and human review requirements', () => {
    const decision = applyDocumentDecisionGuardrails(buildDocumentDecision({
        source: baseSource,
        classification: {
            type: 'medication_prescription',
            family: 'prescription',
            confidence: 'high',
            rationale: 'Ricetta farmaco sintetica.',
            evidenceRefs: ['ev:1'],
        },
        evidenceRefs: [createDocumentDecisionEvidenceRef('ev:1', 'Amoxicillina prescritta.')],
        proposedActions: [{
            id: 'action:active-therapy',
            kind: 'create_active_therapy',
            target: 'therapy:amoxicillina',
            evidenceRefs: ['ev:1'],
            confidence: 'high',
            rationale: 'Adversarial upcast.',
        }],
    }));

    const view = buildDocumentDecisionReviewViewModel(decision);
    assert.deepEqual(view.allowedActions, []);
    assert.equal(view.forbiddenActions[0].blockedReason, 'prescrizione non terapia attiva');
    assert.ok(view.nonWriteSummary.includes('prescrizione non terapia attiva'));
    assert.ok(view.humanRequiredFor.includes('Write clinico'));
});

test('review view model makes OCR review visible for mute documents', () => {
    const decision = applyDocumentDecisionGuardrails(buildDocumentDecision({
        source: {
            ...baseSource,
            textState: 'text_absent',
            ocrStatus: 'needed',
        },
        classification: {
            type: 'mute_or_scanned',
            family: 'unknown',
            confidence: 'blocked',
            rationale: 'PDF muto sintetico.',
            evidenceRefs: ['ocr:needed'],
        },
        evidenceRefs: [createDocumentDecisionEvidenceRef('ocr:needed', 'PDF muto sintetico.')],
        proposedActions: [{
            id: 'action:queue-ocr',
            kind: 'queue_ocr',
            target: 'synthetic-review-doc',
            evidenceRefs: ['ocr:needed'],
            confidence: 'blocked',
            rationale: 'Serve OCR prima della review.',
        }],
    }));

    const view = buildDocumentDecisionReviewViewModel(decision);
    assert.equal(view.documentType, 'PDF muto o scansionato');
    assert.ok(view.humanRequiredFor.includes('Review OCR'));
    assert.deepEqual(view.allowedActions.map((action) => action.label), ['Accoda OCR']);
});
