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

const deterministicRoute = {
    classification: 'lab_report' as const,
    confidence: 'high' as const,
    signals: ['filename:laboratorio', 'content:referto'] as string[],
};
const usableText = 'Referto di laboratorio con determinazione risultato e intervalli di riferimento. '.repeat(2);

function decide(
    mode: 'off' | 'shadow' | 'active',
    routed: Pick<DocumentClassRouterResult, 'classification' | 'confidence' | 'signals'> = deterministicRoute,
    normalizedText = usableText,
) {
    return decideDocumentRouterControlFlow({
        documentSynthesisKillSwitchValue: 'enabled',
        mode,
        routed,
        normalizedText,
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
    const lowConfidence = decide('active', { ...deterministicRoute, confidence: 'medium' });
    const narrative = decide('active', { ...deterministicRoute, classification: 'specialist_report' });

    assert.equal(lowConfidence.wouldSkip, false);
    assert.equal(lowConfidence.useDeterministicSynthesis, false);
    assert.equal(narrative.wouldSkip, false);
    assert.equal(narrative.useDeterministicSynthesis, false);
});

test('active retains the model path for filename-only, empty, and narrative administrative routes', () => {
    const filenameOnly = decide('active', {
        classification: 'lab_report',
        confidence: 'high',
        signals: ['filename:laboratorio'],
    });
    const empty = decide('active', deterministicRoute, '');
    const administrative = decide('active', {
        classification: 'administrative',
        confidence: 'high',
        signals: ['filename:certificato_medico_introduttivo', 'content:certificato'],
    });
    const medicationPrescription = decide('active', {
        classification: 'medication_prescription',
        confidence: 'high',
        signals: ['filename:prescrizione_medica', 'content:ricetta'],
    });
    const prostheticPrescription = decide('active', {
        classification: 'prosthetic_prescription',
        confidence: 'high',
        signals: ['filename:protesica', 'content:prescrizione_protesica'],
    });

    assert.equal(filenameOnly.useDeterministicSynthesis, false);
    assert.equal(empty.useDeterministicSynthesis, false);
    assert.equal(administrative.useDeterministicSynthesis, false);
    assert.equal(medicationPrescription.useDeterministicSynthesis, false);
    assert.equal(prostheticPrescription.useDeterministicSynthesis, false);
});

test('the document synthesis kill switch stops control-flow before an active skip', () => {
    assert.throws(
        () => decideDocumentRouterControlFlow({
            documentSynthesisKillSwitchValue: 'disabled',
            mode: 'active',
            routed: deterministicRoute,
            normalizedText: usableText,
        }),
        (error: unknown) => error instanceof AiDocumentSynthesisDisabledError,
    );
});
