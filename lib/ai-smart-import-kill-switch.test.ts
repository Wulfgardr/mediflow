/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    AiSmartImportDisabledError,
    assertAiSmartImportEnabledValue,
    isAiSmartImportEnabledValue,
    resolveAiSmartImportKillSwitchState,
    serializeAiSmartImportKillSwitchState,
} from './ai-smart-import-kill-switch.ts';

test('resolveAiSmartImportKillSwitchState enables only explicit enabled values', () => {
    assert.equal(resolveAiSmartImportKillSwitchState('enabled'), 'enabled');
    assert.equal(resolveAiSmartImportKillSwitchState(true), 'enabled');
    assert.equal(resolveAiSmartImportKillSwitchState('true'), 'enabled');
    assert.equal(resolveAiSmartImportKillSwitchState(1), 'enabled');
    assert.equal(resolveAiSmartImportKillSwitchState('1'), 'enabled');
});

test('resolveAiSmartImportKillSwitchState fails closed when absent or malformed', () => {
    assert.equal(resolveAiSmartImportKillSwitchState(undefined), 'disabled');
    assert.equal(resolveAiSmartImportKillSwitchState(null), 'disabled');
    assert.equal(resolveAiSmartImportKillSwitchState('unexpected'), 'disabled');
});

test('resolveAiSmartImportKillSwitchState treats explicit disabled values as disabled', () => {
    assert.equal(resolveAiSmartImportKillSwitchState('disabled'), 'disabled');
    assert.equal(resolveAiSmartImportKillSwitchState(false), 'disabled');
    assert.equal(resolveAiSmartImportKillSwitchState('false'), 'disabled');
    assert.equal(resolveAiSmartImportKillSwitchState(0), 'disabled');
    assert.equal(resolveAiSmartImportKillSwitchState('0'), 'disabled');
});

test('serializeAiSmartImportKillSwitchState mirrors enabled boolean', () => {
    assert.equal(serializeAiSmartImportKillSwitchState(true), 'enabled');
    assert.equal(serializeAiSmartImportKillSwitchState(false), 'disabled');
});

test('assertAiSmartImportEnabledValue throws deterministic error when disabled', () => {
    assert.equal(isAiSmartImportEnabledValue('enabled'), true);
    assert.throws(
        () => assertAiSmartImportEnabledValue('disabled'),
        (error: unknown) => error instanceof AiSmartImportDisabledError,
    );
    assert.throws(
        () => assertAiSmartImportEnabledValue(undefined),
        (error: unknown) => error instanceof AiSmartImportDisabledError,
    );
});
