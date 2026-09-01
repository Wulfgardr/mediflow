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

test('historical OCR kill-switch compatibility is terminally disabled for every value', () => {
    for (const value of [undefined, 'enabled', true, 1, 'disabled', 'unexpected']) {
        assert.equal(resolveAiOcrKillSwitchState(value), 'disabled');
        assert.equal(isAiOcrEnabledValue(value), false);
    }
    assert.equal(serializeAiOcrKillSwitchState(true), 'disabled');
    assert.equal(serializeAiOcrKillSwitchState(false), 'disabled');
});

test('historical OCR assert always throws the lane-specific disabled error', () => {
    for (const value of [undefined, 'enabled', 'disabled']) {
        assert.throws(() => assertAiOcrEnabledValue(value), AiOcrDisabledError);
    }
});
