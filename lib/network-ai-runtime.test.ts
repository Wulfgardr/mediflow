import test from 'node:test';
import assert from 'node:assert/strict';
/* @Codex */
import { deriveNetworkAiRuntimeSummary } from './network-ai-runtime-model.ts';

test('deriveNetworkAiRuntimeSummary keeps AI local while the node stays local-only', () => {
    const summary = deriveNetworkAiRuntimeSummary({
        operatingMode: 'local-only',
        provider: 'ollama',
        localTargetValid: true,
        hardwareProfile: 'medium',
        clinicalModel: 'qwen3.5:35b-a3b',
        reasoningModel: 'qwen3.5:35b-a3b',
        ocrModel: 'deepseek-ocr',
    });

    assert.equal(summary.mode, 'local-ai');
    assert.equal(summary.localRuntime.state, 'configured');
    assert.equal(summary.centralRuntime.state, 'disabled');
    assert.equal(summary.centralRuntime.capabilityStatus, 'disabled');
    assert.deepEqual(summary.surfaces, [
        'patient-insight',
        'smart-import',
        'document-synthesis',
    ]);
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
    });

    assert.equal(summary.mode, 'centralized-unavailable');
    assert.equal(summary.localRuntime.state, 'misconfigured');
    assert.equal(summary.centralRuntime.state, 'unavailable');
    assert.equal(summary.centralRuntime.capabilityStatus, 'unavailable');
    assert.equal(summary.rolloutGate, 'lane-benchmarks-and-rollout-governance-required');
});
