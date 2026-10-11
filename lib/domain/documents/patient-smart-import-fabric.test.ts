/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { transitionProviderLifecycle } from '../../ai-providers/fabric/provider-lifecycle.ts';
import {
    createPatientSmartImportCandidateHostSnapshot,
    executePatientSmartImportFabricPreview,
    PatientSmartImportFabricDeniedError,
} from './patient-smart-import-fabric.ts';

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
const health = Object.freeze({ status: 'ok', models: Object.freeze(['synthetic-model']) });

test('Smart Import resolves its named Fabric capability before one provider preview', async () => {
    let invocations = 0;
    const result = await executePatientSmartImportFabricPreview(
        { modelInfo, health, host: createPatientSmartImportCandidateHostSnapshot() },
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
    const available = createPatientSmartImportCandidateHostSnapshot();
    const cases = [
        { host: { ...available, capabilityAvailable: false }, health },
        { host: available, health: { status: 'error', models: [] } },
        { host: { ...available, lifecycle: transitionProviderLifecycle(available.lifecycle, 'degrade') }, health },
        { host: { ...available, lifecycle: transitionProviderLifecycle(available.lifecycle, 'revoke') }, health },
    ];

    for (const candidate of cases) {
        let invocations = 0;
        await assert.rejects(
            executePatientSmartImportFabricPreview({ modelInfo, ...candidate }, async () => {
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
            { modelInfo: { ...modelInfo, model: 'mismatched-model' }, health, host: available },
            async () => { mismatchInvocations += 1; return 'must-not-run'; },
        ),
        (error) => error instanceof PatientSmartImportFabricDeniedError
            && error.denial.denialCode === 'provider_receipt_mismatch',
    );
    assert.equal(mismatchInvocations, 0);
});

test('Smart Import denies when health omits the selected receipt model', async () => {
    let invocations = 0;
    await assert.rejects(executePatientSmartImportFabricPreview({
        modelInfo,
        health: { status: 'ok', models: ['different-model'] },
        host: createPatientSmartImportCandidateHostSnapshot(),
    }, async () => { invocations += 1; return 'must-not-run'; }),
    (error) => error instanceof PatientSmartImportFabricDeniedError && error.denial.receipt === null);
    assert.equal(invocations, 0);
});
