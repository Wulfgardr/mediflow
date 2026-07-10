import test from 'node:test';
import assert from 'node:assert/strict';
/* @Codex */
import { deriveNetworkAiRuntimeSummary } from './network-ai-runtime-model.ts';
import { resolveNetworkAiRuntimeKillSwitches } from './network-ai-runtime.ts';

test('resolveNetworkAiRuntimeKillSwitches is fail-closed for absent and unknown settings', () => {
    assert.deepEqual(resolveNetworkAiRuntimeKillSwitches({}), {
        patientInsight: 'disabled',
        documentSynthesis: 'disabled',
        smartImport: 'disabled',
        treatmentReasoning: 'disabled',
    });
    assert.deepEqual(resolveNetworkAiRuntimeKillSwitches({
        aiPatientInsightKillSwitch: 'enabled',
        aiDocumentSynthesisKillSwitch: 'unexpected',
        aiSmartImportKillSwitch: 'enabled',
        aiTreatmentReasoningKillSwitch: 'garbage',
    }), {
        patientInsight: 'enabled',
        documentSynthesis: 'disabled',
        smartImport: 'enabled',
        treatmentReasoning: 'disabled',
    });
});

test('deriveNetworkAiRuntimeSummary keeps AI local while the node stays local-only', () => {
    const summary = deriveNetworkAiRuntimeSummary({
        operatingMode: 'local-only',
        provider: 'ollama',
        localTargetValid: true,
        hardwareProfile: 'medium',
        clinicalModel: 'qwen3.5:35b-a3b',
        reasoningModel: 'qwen3.5:35b-a3b',
        ocrModel: 'deepseek-ocr',
        killSwitches: {
            patientInsight: 'disabled',
            documentSynthesis: 'disabled',
            smartImport: 'disabled',
            treatmentReasoning: 'disabled',
        },
    });

    assert.equal(summary.mode, 'local-ai');
    assert.equal(summary.localRuntime.state, 'configured');
    assert.equal(summary.centralRuntime.state, 'disabled');
    assert.equal(summary.centralRuntime.capabilityStatus, 'disabled');
    assert.deepEqual(summary.surfaces, [
        'patient-insight',
        'smart-import',
        'document-synthesis',
        'treatment-reasoning',
    ]);
    assert.deepEqual(summary.killSwitches, {
        patientInsight: 'disabled',
        documentSynthesis: 'disabled',
        smartImport: 'disabled',
        treatmentReasoning: 'disabled',
    });
});

test('deriveNetworkAiRuntimeSummary exposes centralized AI when home-base mode and local runtime are ready', () => {
    const summary = deriveNetworkAiRuntimeSummary({
        operatingMode: 'network-home-base',
        provider: 'ollama',
        localTargetValid: true,
        hardwareProfile: 'high',
        clinicalModel: 'qwen3.5:35b-a3b',
        reasoningModel: 'qwen3.5:35b-a3b',
        ocrModel: 'deepseek-ocr',
        killSwitches: {
            patientInsight: 'enabled',
            documentSynthesis: 'enabled',
            smartImport: 'enabled',
            treatmentReasoning: 'enabled',
        },
    });

    assert.equal(summary.mode, 'centralized-available');
    assert.equal(summary.localRuntime.state, 'configured');
    assert.equal(summary.centralRuntime.state, 'available');
    assert.equal(summary.centralRuntime.capabilityStatus, 'available');
});

test('deriveNetworkAiRuntimeSummary marks centralized AI unavailable when the local runtime target is not valid', () => {
    const summary = deriveNetworkAiRuntimeSummary({
        operatingMode: 'network-home-base',
        provider: 'ollama',
        localTargetValid: false,
        hardwareProfile: 'custom',
        clinicalModel: null,
        reasoningModel: null,
        ocrModel: null,
        killSwitches: {
            patientInsight: 'disabled',
            documentSynthesis: 'disabled',
            smartImport: 'disabled',
            treatmentReasoning: 'disabled',
        },
    });

    assert.equal(summary.mode, 'centralized-unavailable');
    assert.equal(summary.localRuntime.state, 'misconfigured');
    assert.equal(summary.centralRuntime.state, 'unavailable');
    assert.equal(summary.centralRuntime.capabilityStatus, 'unavailable');
    assert.equal(summary.rolloutGate, 'lane-benchmarks-and-rollout-governance-required');
});
