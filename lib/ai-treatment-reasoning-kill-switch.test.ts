/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    AiTreatmentReasoningDisabledError,
    assertAiTreatmentReasoningEnabledValue,
    isAiTreatmentReasoningEnabledValue,
    serializeAiTreatmentReasoningKillSwitchState,
} from './ai-treatment-reasoning-kill-switch';

test('treatment reasoning kill switch is fail-closed', () => {
    assert.equal(isAiTreatmentReasoningEnabledValue(undefined), false);
    assert.equal(isAiTreatmentReasoningEnabledValue('disabled'), false);
    assert.equal(isAiTreatmentReasoningEnabledValue('enabled'), true);
    assert.equal(serializeAiTreatmentReasoningKillSwitchState(true), 'enabled');
    assert.equal(serializeAiTreatmentReasoningKillSwitchState(false), 'disabled');
});

test('treatment reasoning assert throws lane-specific disabled error', () => {
    assert.throws(
        () => assertAiTreatmentReasoningEnabledValue(undefined),
        AiTreatmentReasoningDisabledError,
    );
    assert.doesNotThrow(() => assertAiTreatmentReasoningEnabledValue('enabled'));
});
