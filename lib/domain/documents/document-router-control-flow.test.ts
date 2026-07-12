/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { AiDocumentSynthesisDisabledError } from '../../ai-document-synthesis-kill-switch';
import {
    DEFAULT_DOCUMENT_ROUTER_CONTROL_FLOW_MODE,
    decideDocumentRouterControlFlow,
    parseDocumentRouterControlFlowMode,
} from './document-router-control-flow';
import type { DocumentClassRouterResult } from './document-class-router';

const deterministicRoute = { classification: 'lab_report' as const, confidence: 'high' as const };

function decide(
    mode: 'off' | 'shadow' | 'active',
    routed: Pick<DocumentClassRouterResult, 'classification' | 'confidence'> = deterministicRoute,
) {
    return decideDocumentRouterControlFlow({
        documentSynthesisKillSwitchValue: 'enabled',
        mode,
        routed,
    });
}

test('control-flow defaults missing or invalid settings to shadow', () => {
    assert.equal(parseDocumentRouterControlFlowMode(undefined), DEFAULT_DOCUMENT_ROUTER_CONTROL_FLOW_MODE);
    assert.equal(parseDocumentRouterControlFlowMode('unexpected'), 'shadow');
});

test('off retains the model path without a shadow decision', () => {
    const decision = decide('off');

    assert.equal(decision.wouldSkip, true);
    assert.equal(decision.useDeterministicSynthesis, false);
});

test('shadow records an eligible skip without changing the model path', () => {
    const decision = decide('shadow');

    assert.equal(decision.wouldSkip, true);
    assert.equal(decision.useDeterministicSynthesis, false);
});

test('active uses deterministic synthesis only for an eligible high-confidence route', () => {
    const decision = decide('active');

    assert.equal(decision.wouldSkip, true);
    assert.equal(decision.useDeterministicSynthesis, true);
});

test('active retains the model path for low confidence and narrative classes', () => {
    const lowConfidence = decide('active', { classification: 'lab_report', confidence: 'medium' });
    const narrative = decide('active', { classification: 'specialist_report', confidence: 'high' });

    assert.equal(lowConfidence.wouldSkip, false);
    assert.equal(lowConfidence.useDeterministicSynthesis, false);
    assert.equal(narrative.wouldSkip, false);
    assert.equal(narrative.useDeterministicSynthesis, false);
});

test('the document synthesis kill switch stops control-flow before an active skip', () => {
    assert.throws(
        () => decideDocumentRouterControlFlow({
            documentSynthesisKillSwitchValue: 'disabled',
            mode: 'active',
            routed: deterministicRoute,
        }),
        (error: unknown) => error instanceof AiDocumentSynthesisDisabledError,
    );
});
