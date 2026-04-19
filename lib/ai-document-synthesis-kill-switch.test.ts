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

test('resolveAiDocumentSynthesisKillSwitchState defaults to enabled', () => {
    assert.equal(resolveAiDocumentSynthesisKillSwitchState(undefined), 'enabled');
    assert.equal(resolveAiDocumentSynthesisKillSwitchState(null), 'enabled');
    assert.equal(resolveAiDocumentSynthesisKillSwitchState('enabled'), 'enabled');
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
});
