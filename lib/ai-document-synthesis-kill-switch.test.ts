/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    AiDocumentSynthesisDisabledError,
    assertAiDocumentSynthesisEnabledValue,
    isAiDocumentSynthesisEnabledValue,
    resolveAiDocumentSynthesisKillSwitchState,
    serializeAiDocumentSynthesisKillSwitchState,
} from './ai-document-synthesis-kill-switch.ts';

test('resolveAiDocumentSynthesisKillSwitchState enables only explicit enabled values', () => {
    assert.equal(resolveAiDocumentSynthesisKillSwitchState('enabled'), 'enabled');
    assert.equal(resolveAiDocumentSynthesisKillSwitchState(true), 'enabled');
    assert.equal(resolveAiDocumentSynthesisKillSwitchState('true'), 'enabled');
    assert.equal(resolveAiDocumentSynthesisKillSwitchState(1), 'enabled');
    assert.equal(resolveAiDocumentSynthesisKillSwitchState('1'), 'enabled');
});

test('resolveAiDocumentSynthesisKillSwitchState fails closed when absent or malformed', () => {
    assert.equal(resolveAiDocumentSynthesisKillSwitchState(undefined), 'disabled');
    assert.equal(resolveAiDocumentSynthesisKillSwitchState(null), 'disabled');
    assert.equal(resolveAiDocumentSynthesisKillSwitchState('unexpected'), 'disabled');
});

test('resolveAiDocumentSynthesisKillSwitchState treats explicit disabled values as disabled', () => {
    assert.equal(resolveAiDocumentSynthesisKillSwitchState('disabled'), 'disabled');
    assert.equal(resolveAiDocumentSynthesisKillSwitchState(false), 'disabled');
    assert.equal(resolveAiDocumentSynthesisKillSwitchState('false'), 'disabled');
    assert.equal(resolveAiDocumentSynthesisKillSwitchState(0), 'disabled');
    assert.equal(resolveAiDocumentSynthesisKillSwitchState('0'), 'disabled');
});

test('serializeAiDocumentSynthesisKillSwitchState mirrors enabled boolean', () => {
    assert.equal(serializeAiDocumentSynthesisKillSwitchState(true), 'enabled');
    assert.equal(serializeAiDocumentSynthesisKillSwitchState(false), 'disabled');
});

test('assertAiDocumentSynthesisEnabledValue throws deterministic error when disabled', () => {
    assert.equal(isAiDocumentSynthesisEnabledValue('enabled'), true);
    assert.throws(
        () => assertAiDocumentSynthesisEnabledValue('disabled'),
        (error: unknown) => error instanceof AiDocumentSynthesisDisabledError,
    );
    assert.throws(
        () => assertAiDocumentSynthesisEnabledValue(undefined),
        (error: unknown) => error instanceof AiDocumentSynthesisDisabledError,
    );
});
