/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceOnboarding, startOnboarding } from '../../ai-providers/fabric/onboarding.ts';
import { admitProvider, transitionProviderLifecycle } from '../../ai-providers/fabric/provider-lifecycle.ts';
import { observeVenue } from '../../ai-providers/fabric/routing-observability.ts';
import {
    executePatientSmartImportFabricPreview,
    PatientSmartImportFabricDeniedError,
    type PatientSmartImportFabricHostSnapshot,
} from './patient-smart-import-fabric.ts';

function enabledLocal() {
    return ['configure', 'credential_declared', 'attest_local', 'enable'].reduce(
        (state, type) => advanceOnboarding(state, { type } as Parameters<typeof advanceOnboarding>[1]),
        startOnboarding('ollama', 'local_model'),
    );
}

function hostSnapshot(): PatientSmartImportFabricHostSnapshot {
    const onboarding = enabledLocal();
    return {
        capabilityAvailable: true,
        observation: observeVenue('local_process', 'available', null),
        onboarding,
        lifecycle: admitProvider(onboarding),
    };
}

const modelInfo = Object.freeze({
    provider: 'ollama' as const,
    model: 'synthetic-model',
    baseUrl: 'http://127.0.0.1:11434',
    receipt: Object.freeze({
        schemaVersion: 'mediflow.ai.provider-selection.v1' as const,
        authorityPlane: 'clinical_application' as const,
        task: 'clinical' as const,
        provider: 'ollama' as const,
        model: 'synthetic-model',
        execution: 'local' as const,
        endpointClass: 'loopback' as const,
        egress: 'none' as const,
        runtimeReadiness: 'required' as const,
        fallbackCount: 0 as const,
    }),
});

test('Smart Import resolves its named Fabric capability before one provider preview', async () => {
    let invocations = 0;
    const result = await executePatientSmartImportFabricPreview(
        { modelInfo, host: hostSnapshot() },
        async () => {
            invocations += 1;
            return 'synthetic-provider-output';
        },
    );

    assert.equal(invocations, 1);
    assert.equal(result.output, 'synthetic-provider-output');
    assert.equal(result.metadata.routing.capability, 'smart_import');
    assert.equal(result.metadata.provenance.receipt.capability, 'smart_import');
    assert.equal(result.metadata.writesPerformed, 0);
    assert.equal(JSON.stringify(result.metadata).includes('synthetic-provider-output'), false);
});

test('Smart Import denials never invoke the provider or return a reusable receipt', async () => {
    const available = hostSnapshot();
    const cases = [
        { ...available, capabilityAvailable: false },
        { ...available, observation: observeVenue('local_process', 'offline', 'daemon_unreachable') },
        { ...available, observation: observeVenue('local_process', 'degraded', 'daemon_unreachable') },
        { ...available, lifecycle: transitionProviderLifecycle(available.lifecycle, 'degrade') },
        { ...available, lifecycle: transitionProviderLifecycle(available.lifecycle, 'revoke') },
    ];

    for (const host of cases) {
        let invocations = 0;
        await assert.rejects(
            executePatientSmartImportFabricPreview({ modelInfo, host }, async () => {
                invocations += 1;
                return 'must-not-run';
            }),
            (error) => error instanceof PatientSmartImportFabricDeniedError
                && error.denial.receipt === null,
        );
        assert.equal(invocations, 0);
    }

    let mismatchInvocations = 0;
    await assert.rejects(
        executePatientSmartImportFabricPreview(
            { modelInfo: { ...modelInfo, model: 'mismatched-model' }, host: available },
            async () => { mismatchInvocations += 1; return 'must-not-run'; },
        ),
        (error) => error instanceof PatientSmartImportFabricDeniedError
            && error.denial.denialCode === 'provider_receipt_mismatch',
    );
    assert.equal(mismatchInvocations, 0);
});
