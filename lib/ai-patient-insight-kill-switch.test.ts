/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    AiPatientInsightDisabledError,
    assertAiPatientInsightEnabledValue,
    isAiPatientInsightEnabledValue,
    resolveAiPatientInsightKillSwitchState,
    serializeAiPatientInsightKillSwitchState,
} from './ai-patient-insight-kill-switch.ts';

test('resolveAiPatientInsightKillSwitchState defaults to enabled', () => {
    assert.equal(resolveAiPatientInsightKillSwitchState(undefined), 'enabled');
    assert.equal(resolveAiPatientInsightKillSwitchState(null), 'enabled');
    assert.equal(resolveAiPatientInsightKillSwitchState('enabled'), 'enabled');
});

test('resolveAiPatientInsightKillSwitchState treats explicit disabled values as disabled', () => {
    assert.equal(resolveAiPatientInsightKillSwitchState('disabled'), 'disabled');
    assert.equal(resolveAiPatientInsightKillSwitchState(false), 'disabled');
    assert.equal(resolveAiPatientInsightKillSwitchState('false'), 'disabled');
    assert.equal(resolveAiPatientInsightKillSwitchState(0), 'disabled');
    assert.equal(resolveAiPatientInsightKillSwitchState('0'), 'disabled');
});

test('serializeAiPatientInsightKillSwitchState mirrors enabled boolean', () => {
    assert.equal(serializeAiPatientInsightKillSwitchState(true), 'enabled');
    assert.equal(serializeAiPatientInsightKillSwitchState(false), 'disabled');
});

test('assertAiPatientInsightEnabledValue throws deterministic error when disabled', () => {
    assert.equal(isAiPatientInsightEnabledValue('enabled'), true);
    assert.throws(
        () => assertAiPatientInsightEnabledValue('disabled'),
        (error: unknown) => error instanceof AiPatientInsightDisabledError,
    );
});
