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

test('resolveAiPatientInsightKillSwitchState enables only explicit enabled values', () => {
    assert.equal(resolveAiPatientInsightKillSwitchState('enabled'), 'enabled');
    assert.equal(resolveAiPatientInsightKillSwitchState(true), 'enabled');
    assert.equal(resolveAiPatientInsightKillSwitchState('true'), 'enabled');
    assert.equal(resolveAiPatientInsightKillSwitchState(1), 'enabled');
    assert.equal(resolveAiPatientInsightKillSwitchState('1'), 'enabled');
});

test('resolveAiPatientInsightKillSwitchState fails closed when absent or malformed', () => {
    assert.equal(resolveAiPatientInsightKillSwitchState(undefined), 'disabled');
    assert.equal(resolveAiPatientInsightKillSwitchState(null), 'disabled');
    assert.equal(resolveAiPatientInsightKillSwitchState('unexpected'), 'disabled');
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
    assert.throws(
        () => assertAiPatientInsightEnabledValue(undefined),
        (error: unknown) => error instanceof AiPatientInsightDisabledError,
    );
});
