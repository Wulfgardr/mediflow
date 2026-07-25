/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

function assertNoAppliedResult(plan: ReturnType<typeof buildPlan>) {
    assert.equal('diagnoses' in plan, false);
    assert.equal('appliedCodes' in plan, false);
    assert.equal('appliedSuggestions' in plan, false);
}

test('document synthesis keeps high confidence explicit diagnoses review-only', () => {
    const plan = buildPlan([baseSuggestion]);

    assertNoAppliedResult(plan);
    assert.equal(plan.decision.writePlan.allowedActions.length, 1);
    assert.equal(plan.decision.writePlan.mode, 'review_required');
    assert.deepEqual(plan.decision.writePlan.forbiddenActions, []);
    assert.strictEqual(plan.decision.writePlan.allowedActions[0], plan.decision.proposedActions[0]);
    assert.strictEqual(plan.diagnosisCandidateActions[0]?.candidate, baseSuggestion);
});

test('document synthesis preserves review action order and identity at medium confidence', () => {
    const suggestions = [
        baseSuggestion,
        {
            ...baseSuggestion,
            code: 'E11.9',
            description: 'Diabete mellito tipo 2 sintetico',
            confidence: 'medium' as const,
        },
    ];
    const plan = buildPlan(suggestions);

    assertNoAppliedResult(plan);
    assert.deepEqual(
        plan.decision.writePlan.allowedActions.map((action) => action.id),
        ['document-synthesis-autofill:1', 'document-synthesis-autofill:2'],
    );
    assert.strictEqual(plan.decision.writePlan.allowedActions[0], plan.decision.proposedActions[0]);
    assert.strictEqual(plan.decision.writePlan.allowedActions[1], plan.decision.proposedActions[1]);
    assert.deepEqual(
        plan.diagnosisCandidateActions.map(({ actionId }) => actionId),
        plan.decision.writePlan.allowedActions.map(({ id }) => id),
    );
    assert.strictEqual(plan.diagnosisCandidateActions[0]?.candidate, suggestions[0]);
    assert.strictEqual(plan.diagnosisCandidateActions[1]?.candidate, suggestions[1]);
});

test('document synthesis autofill does not apply low confidence diagnoses', () => {
    const plan = buildPlan([{ ...baseSuggestion, confidence: 'low' }]);

    assertNoAppliedResult(plan);
    assert.equal(plan.decision.writePlan.allowedActions.length, 0);
    assert.equal(plan.decision.writePlan.forbiddenActions[0]?.blockedReason, 'confidence_too_low_for_auto_apply');
    assert.deepEqual(plan.diagnosisCandidateActions, []);
});

/* @Codex */
test('document synthesis autofill does not apply diagnoses without confidence', () => {
    const plan = buildPlan([{ ...baseSuggestion, confidence: undefined }]);

    assertNoAppliedResult(plan);
    assert.equal(plan.decision.writePlan.forbiddenActions[0]?.blockedReason, 'confidence_too_low_for_auto_apply');
    assert.deepEqual(plan.diagnosisCandidateActions, []);
});

test('document synthesis fails closed for runtime-invalid confidence', () => {
    const invalid = { ...baseSuggestion, confidence: 'urgent' } as unknown as DocumentDiagnosisSuggestion;
    const plan = buildPlan([invalid]);

    assert.equal(plan.decision.proposedActions[0]?.confidence, 'low');
    assert.equal(plan.decision.writePlan.forbiddenActions[0]?.id, plan.decision.proposedActions[0]?.id);
    assert.equal(plan.decision.writePlan.forbiddenActions[0]?.blockedReason, 'confidence_too_low_for_auto_apply');
    assert.deepEqual(plan.diagnosisCandidateActions, []);
});

test('document synthesis blocks diagnoses when document quality is red', () => {
    const plan = buildPlan([baseSuggestion], { qualityLevel: 'red' });

    assertNoAppliedResult(plan);
    assert.equal(plan.decision.writePlan.allowedActions.length, 0);
    assert.equal(plan.decision.writePlan.forbiddenActions[0]?.blockedReason, 'confidence_too_low_for_auto_apply');
    assert.deepEqual(plan.diagnosisCandidateActions, []);
});

test('document synthesis keeps only the allowed candidate when targets collide', () => {
    const blocked = { ...baseSuggestion, confidence: 'low' as const };
    const allowed = { ...baseSuggestion };
    const plan = buildPlan([blocked, allowed]);

    assert.equal(plan.diagnosisCandidateActions.length, 1);
    assert.equal(plan.diagnosisCandidateActions[0]?.actionId, plan.decision.writePlan.allowedActions[0]?.id);
    assert.strictEqual(plan.diagnosisCandidateActions[0]?.candidate, allowed);
});

test('document synthesis autofill does not reapply duplicate diagnoses', () => {
    const existing: Diagnosis[] = [{
        code: 'I10',
        description: 'Ipertensione essenziale gia presente',
        system: 'ICD-10',
        date: new Date('2026-01-01T00:00:00.000Z'),
    }];
    const plan = buildPlan([baseSuggestion], { existingDiagnoses: existing });

    assertNoAppliedResult(plan);
    assert.equal(plan.decision.writePlan.allowedActions.length, 0);
    assert.equal(plan.decision.writePlan.blockedActions[0]?.blockedReason, 'structured_fact_already_present');
    assert.deepEqual(plan.diagnosisCandidateActions, []);
});

test('document synthesis autofill respects locked diagnoses fields', () => {
    const plan = buildPlan([baseSuggestion], {
        existingDiagnosesRaw: LOCKED_DATA_PLACEHOLDER,
    });

    assertNoAppliedResult(plan);
    assert.equal(plan.diagnosesFieldLocked, true);
    assert.equal(plan.decision.writePlan.allowedActions.length, 0);
    assert.equal(plan.decision.writePlan.blockedActions[0]?.blockedReason, 'target_field_locked');
    assert.deepEqual(plan.diagnosisCandidateActions, []);
});

test('document synthesis diagnosis parser preserves locked raw values as unreadable', () => {
    const parsed = parseExistingDocumentSynthesisDiagnoses(LOCKED_DATA_PLACEHOLDER);

    assert.equal(parsed.locked, true);
    assert.deepEqual(parsed.diagnoses, []);
});

test('document synthesis review planner has no persistence, encryption, or egress calls', () => {
    const source = readFileSync(new URL('./document-synthesis-autofill.ts', import.meta.url), 'utf8');

    assert.doesNotMatch(source, /\b(?:fetch|upsert|encrypt|encryptData|deriveDocumentDiagnosisProposalIdentity)\s*\(/u);
    assert.doesNotMatch(source, /\bdb\./u);
    assert.doesNotMatch(source, /\b(?:crypto|console\.(?:log|warn|error))\b/u);
});
