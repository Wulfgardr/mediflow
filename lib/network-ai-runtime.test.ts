import test from 'node:test';
import assert from 'node:assert/strict';
/* @Codex */
import {
    deriveNetworkAiRuntimeSummary,
    resolveNetworkAiRuntimeKillSwitches,
} from './network-ai-runtime-model.ts';

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
        killSwitches: {
            patientInsight: 'disabled',
            documentSynthesis: 'disabled',
            smartImport: 'disabled',
            treatmentReasoning: 'disabled',
        },
    });

    assert.equal(summary.mode, 'local-ai');
    assert.equal(summary.localRuntime.state, 'configured');
    assert.equal(summary.localRuntime.ocrModel, null);
    assert.equal(summary.centralRuntime.state, 'disabled');
    assert.equal(summary.centralRuntime.capabilityStatus, 'disabled');
    assert.equal(summary.centralRuntime.accessMode, 'status-only');
    assert.equal(summary.centralRuntime.executionAuthorized, false);
    assert.equal(summary.fabric.schemaVersion, 'mediflow.ai.network-fabric-status.v1');
    assert.equal(summary.fabric.contractVersion, 'mediflow.ai.fabric.v1');
    assert.equal(summary.fabric.access, 'status_only');
    assert.equal(summary.fabric.pairedExecution, 'not_authorized');
    assert.equal(summary.fabric.egressGateOpen, false);
    assert.equal(summary.fabric.readinessNote, 'available_unqualified');
    assert.equal(summary.fabric.fallback, 'denied_by_contract');
    assert.deepEqual(summary.fabric.venues, {
        local_process: 'configured',
        home_base: 'disabled',
        on_device: 'not_implemented',
        cloud: 'egress_profile_closed',
    });
    assert.equal(summary.fallbackPolicy, 'ai-unavailable-no-automatic-fallback');
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
        killSwitches: {
            patientInsight: 'enabled',
            documentSynthesis: 'enabled',
            smartImport: 'enabled',
            treatmentReasoning: 'enabled',
        },
    });

    assert.equal(summary.mode, 'centralized-available');
    assert.equal(summary.localRuntime.state, 'configured');
    assert.equal(summary.localRuntime.ocrModel, null);
    assert.equal(summary.centralRuntime.state, 'available');
    assert.equal(summary.centralRuntime.capabilityStatus, 'available');
    assert.equal(summary.centralRuntime.accessMode, 'status-only');
    assert.equal(summary.centralRuntime.executionAuthorized, false);
    assert.equal(summary.fabric.pairedExecution, 'not_authorized');
    assert.equal(summary.fabric.fallback, 'denied_by_contract');
    assert.equal(summary.fabric.venues.home_base, 'host_configured');
    assert.equal(summary.fabric.venues.on_device, 'not_implemented');
    assert.equal(summary.fabric.venues.cloud, 'egress_profile_closed');

    const serialized = JSON.stringify(summary);
    for (const forbiddenKey of ['url', 'secret', 'token', 'prompt', 'payload']) {
        assert.equal(new RegExp(`\"[^\"]*${forbiddenKey}[^\"]*\"\\s*:`, 'i').test(serialized), false);
    }
});

test('deriveNetworkAiRuntimeSummary marks centralized AI unavailable when the local runtime target is not valid', () => {
    const summary = deriveNetworkAiRuntimeSummary({
        operatingMode: 'network-home-base',
        provider: 'ollama',
        localTargetValid: false,
        hardwareProfile: 'custom',
        clinicalModel: null,
        reasoningModel: null,
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
    assert.equal(summary.centralRuntime.executionAuthorized, false);
    assert.equal(summary.fabric.venues.local_process, 'misconfigured');
    assert.equal(summary.fabric.venues.home_base, 'host_unavailable');
    assert.equal(summary.fabric.venues.on_device, 'not_implemented');
    assert.equal(summary.fabric.venues.cloud, 'egress_profile_closed');
    assert.equal(summary.fabric.fallback, 'denied_by_contract');
    assert.equal(summary.rolloutGate, 'lane-benchmarks-and-rollout-governance-required');
});
