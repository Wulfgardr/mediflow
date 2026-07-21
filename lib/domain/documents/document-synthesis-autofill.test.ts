/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCKED_DATA_PLACEHOLDER } from '../../locked-field-guard';
import {
    buildDocumentSynthesisAutofillPlan,
    parseExistingDocumentSynthesisDiagnoses,
} from './document-synthesis-autofill';
import type { Diagnosis, DocumentDiagnosisSuggestion } from '../../db';

const baseSuggestion: DocumentDiagnosisSuggestion = {
    code: 'I10',
    description: 'Ipertensione essenziale sintetica',
    system: 'ICD-10',
    evidence: 'ICD-10 I10 esplicito nel referto sintetico.',
    confidence: 'high',
};

function buildPlan(
    diagnoses: DocumentDiagnosisSuggestion[],
    options: {
        existingDiagnoses?: Diagnosis[];
        existingDiagnosesRaw?: unknown;
        qualityLevel?: 'green' | 'yellow' | 'red';
    } = {},
) {
    return buildDocumentSynthesisAutofillPlan({
        documentId: 'synthetic-document-autofill',
        fileName: '2026-07-02__referto__synthetic.pdf',
        rawMarkdown: 'Referto sintetico con codice ICD esplicito.',
        qualityLevel: options.qualityLevel ?? 'green',
        diagnoses,
        existingDiagnoses: options.existingDiagnoses ?? [],
        existingDiagnosesRaw: options.existingDiagnosesRaw,
    });
}

test('document synthesis autofill applies high confidence explicit diagnoses', () => {
    const plan = buildPlan([baseSuggestion]);

    assert.deepEqual(plan.appliedCodes, ['ICD-10:I10']);
    assert.equal(plan.diagnoses.length, 1);
    assert.equal(plan.decision.writePlan.allowedActions.length, 1);
    assert.equal(plan.decision.writePlan.mode, 'review_required');
    assert.deepEqual(plan.decision.writePlan.forbiddenActions, []);
});

test('document synthesis autofill does not apply low confidence diagnoses', () => {
    const plan = buildPlan([{ ...baseSuggestion, confidence: 'low' }]);

    assert.deepEqual(plan.appliedCodes, []);
    assert.deepEqual(plan.diagnoses, []);
    assert.equal(plan.decision.writePlan.allowedActions.length, 0);
    assert.equal(plan.decision.writePlan.forbiddenActions[0]?.blockedReason, 'confidence_too_low_for_auto_apply');
});

/* @Codex */
test('document synthesis autofill does not apply diagnoses without confidence', () => {
    const plan = buildPlan([{ ...baseSuggestion, confidence: undefined }]);

    assert.deepEqual(plan.appliedCodes, []);
    assert.equal(plan.decision.writePlan.forbiddenActions[0]?.blockedReason, 'confidence_too_low_for_auto_apply');
});

test('document synthesis autofill does not reapply duplicate diagnoses', () => {
    const existing: Diagnosis[] = [{
        code: 'I10',
        description: 'Ipertensione essenziale gia presente',
        system: 'ICD-10',
        date: new Date('2026-01-01T00:00:00.000Z'),
    }];
    const plan = buildPlan([baseSuggestion], { existingDiagnoses: existing });

    assert.deepEqual(plan.appliedCodes, []);
    assert.deepEqual(plan.diagnoses, existing);
    assert.equal(plan.decision.writePlan.allowedActions.length, 0);
    assert.equal(plan.decision.writePlan.blockedActions[0]?.blockedReason, 'structured_fact_already_present');
});

test('document synthesis autofill respects locked diagnoses fields', () => {
    const plan = buildPlan([baseSuggestion], {
        existingDiagnosesRaw: LOCKED_DATA_PLACEHOLDER,
    });

    assert.deepEqual(plan.appliedCodes, []);
    assert.deepEqual(plan.diagnoses, []);
    assert.equal(plan.diagnosesFieldLocked, true);
    assert.equal(plan.decision.writePlan.allowedActions.length, 0);
    assert.equal(plan.decision.writePlan.blockedActions[0]?.blockedReason, 'target_field_locked');
});

test('document synthesis diagnosis parser preserves locked raw values as unreadable', () => {
    const parsed = parseExistingDocumentSynthesisDiagnoses(LOCKED_DATA_PLACEHOLDER);

    assert.equal(parsed.locked, true);
    assert.deepEqual(parsed.diagnoses, []);
});
