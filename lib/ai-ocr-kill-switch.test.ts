/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    AiOcrDisabledError,
    assertAiOcrEnabledValue,
    isAiOcrEnabledValue,
    resolveAiOcrKillSwitchState,
    serializeAiOcrKillSwitchState,
} from './ai-ocr-kill-switch';

test('OCR kill switch stays active when unset and fails closed for explicit disabled or malformed values', () => {
    assert.equal(resolveAiOcrKillSwitchState(undefined), 'enabled');
    assert.equal(resolveAiOcrKillSwitchState('enabled'), 'enabled');
    assert.equal(resolveAiOcrKillSwitchState('disabled'), 'disabled');
    assert.equal(resolveAiOcrKillSwitchState('unexpected'), 'disabled');
    assert.equal(isAiOcrEnabledValue(undefined), true);
    assert.equal(serializeAiOcrKillSwitchState(true), 'enabled');
    assert.equal(serializeAiOcrKillSwitchState(false), 'disabled');
});

test('OCR assert throws the lane-specific disabled error', () => {
    assert.throws(
        () => assertAiOcrEnabledValue('disabled'),
        AiOcrDisabledError,
    );
    assert.doesNotThrow(() => assertAiOcrEnabledValue(undefined));
    assert.doesNotThrow(() => assertAiOcrEnabledValue('enabled'));
});
