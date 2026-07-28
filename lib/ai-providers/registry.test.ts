/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    localProviderRegistry,
    ProviderRegistryError,
} from './registry.ts';

const BASE_BINDING = {
    task: 'clinical',
    models: {
        clinical: 'qwen3.5:35b-a3b',
        reasoning: 'reasoning-model',
        ocr: 'ocr-model',
    },
    endpoint: 'http://localhost:11434',
    chatTimeoutMs: 1_000,
};

for (const task of ['clinical', 'reasoning', 'ocr']) {
    test(`associa ${task} al provider Ollama locale`, () => {
        const resolved = localProviderRegistry.resolve({ ...BASE_BINDING, task });

        assert.deepEqual(resolved.receipt, {
            schemaVersion: 'mediflow.ai.provider-selection.v1',
            authorityPlane: 'clinical_application',
            task,
            provider: 'ollama',
            model: BASE_BINDING.models[task as keyof typeof BASE_BINDING.models],
            execution: 'local',
            endpointClass: 'loopback',
            egress: 'none',
            runtimeReadiness: 'required',
            fallbackCount: 0,
        });
        assert.deepEqual(resolved.fallback, { strategy: 'none', candidates: [] });
        assert.equal(Object.isFrozen(resolved.receipt), true);
        assert.equal(Object.isFrozen(resolved.fallback), true);
        assert.equal(resolved.manifest.modelCapabilityReadiness, 'runtime_attestation_required');
        assert.equal(resolved.manifest.capabilityEvidence, 'provider_transport_only');
    });
}

for (const [binding, code] of [
    [{ ...BASE_BINDING, task: 'unknown' }, 'invalid_task'],
    [{ ...BASE_BINDING, provider: 'openai' }, 'provider_not_registered'],
    [{ ...BASE_BINDING, provider: '' }, 'provider_not_registered'],
    [{ ...BASE_BINDING, provider: '   ' }, 'provider_not_registered'],
    [{ ...BASE_BINDING, endpoint: ['https:', '//api.example.test'].join('') }, 'endpoint_not_local'],
    [{ ...BASE_BINDING, models: { clinical: 'qwen3.5:cloud' } }, 'invalid_model'],
    [{ ...BASE_BINDING, models: { clinical: '   ' } }, 'invalid_model'],
    [{ ...BASE_BINDING, models: {} }, 'invalid_model'],
] as const) {
    test(`rifiuta il binding non valido ${code} senza fallback`, () => {
        assert.throws(() => localProviderRegistry.resolve(binding), (error) => {
            return error instanceof ProviderRegistryError && error.code === code;
        });
    });
}

test('non include endpoint, prompt o credenziali nella ricevuta', () => {
    const receipt = localProviderRegistry.resolve(BASE_BINDING).receipt;
    const serialized = JSON.stringify(receipt);

    assert.equal(serialized.includes('11434'), false);
    assert.equal(serialized.includes('prompt'), false);
    assert.equal(serialized.includes('credential'), false);
});
