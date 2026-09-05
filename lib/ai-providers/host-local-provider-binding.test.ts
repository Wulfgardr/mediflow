/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createHostLocalProviderBindingService,
    type HostLocalProviderBindingDenialCode,
    type HostLocalProviderSettingsSnapshot,
} from './host-local-provider-binding.ts';

const VALID_SETTINGS = {
    aiProvider: 'ollama',
    aiModel_clinical: 'clinical-local:latest',
    aiUrl: 'http://localhost:11434/v1',
} satisfies HostLocalProviderSettingsSnapshot;

async function read(snapshot: HostLocalProviderSettingsSnapshot) {
    return createHostLocalProviderBindingService({ readSettings: async () => snapshot }).readClinical();
}

function assertDenied(
    result: Awaited<ReturnType<ReturnType<typeof createHostLocalProviderBindingService>['readClinical']>>,
    code: HostLocalProviderBindingDenialCode,
) {
    assert.deepEqual(result, { status: 'denied', code, resolution: null });
    assert.equal(Object.isFrozen(result), true);
}

test('legge un solo snapshot e restituisce il binding clinico locale validato', async () => {
    let reads = 0;
    const service = createHostLocalProviderBindingService({
        readSettings: async () => {
            reads += 1;
            return VALID_SETTINGS;
        },
    });

    assert.deepEqual(Object.keys(service), ['readClinical']);
    const result = await service.readClinical();

    assert.equal(reads, 1);
    assert.equal(result.status, 'available');
    if (result.status !== 'available') return;
    assert.equal(result.resolution.receipt.task, 'clinical');
    assert.equal(result.resolution.receipt.provider, 'ollama');
    assert.equal(result.resolution.receipt.model, 'clinical-local:latest');
    assert.equal(result.resolution.receipt.endpointClass, 'loopback');
    assert.equal(result.resolution.receipt.egress, 'none');
    assert.equal(result.resolution.adapter.getBaseUrl(), 'http://127.0.0.1:11434');
    assert.equal(Object.isFrozen(result), true);
});

test('applica le precedenze canoniche senza accettare binding dal caller', async () => {
    for (const [snapshot, model, endpoint] of [
        [{}, 'qwen3.5:35b-a3b', 'http://127.0.0.1:11434'],
        [{ aiModel: 'legacy-local', ollamaUrl: 'http://localhost:11434/v1' }, 'legacy-local', 'http://127.0.0.1:11434'],
        [{ aiModel_clinical: ' clinical-local ', aiModel: 'legacy-local', aiUrl: 'http://127.0.0.1:8080', ollamaUrl: 'http://localhost:11434' },
            'clinical-local', 'http://127.0.0.1:11434'],
    ] as const) {
        const result = await read(snapshot);
        assert.equal(result.status, 'available');
        if (result.status !== 'available') continue;
        assert.equal(result.resolution.receipt.provider, 'ollama');
        assert.equal(result.resolution.receipt.model, model);
        assert.equal(result.resolution.adapter.getBaseUrl(), endpoint);
    }
});

test('nega provider, modello ed endpoint non validi senza fallback silenzioso', async () => {
    for (const [snapshot, code] of [
        [{ ...VALID_SETTINGS, aiProvider: 'remote-provider' }, 'provider_invalid'],
        [{ ...VALID_SETTINGS, aiModel_clinical: 'qwen3.5:cloud', aiModel: 'safe-local' }, 'model_invalid'],
        [{ ...VALID_SETTINGS, aiUrl: ['https:', '//provider.example.test'].join(''), ollamaUrl: 'http://localhost:11434' }, 'endpoint_invalid'],
    ] as const) {
        assertDenied(await read(snapshot), code);
    }
});

test('nega snapshot indisponibili o corrotti con codici fissi', async () => {
    const unavailable = await createHostLocalProviderBindingService({
        readSettings: async () => { throw new Error('raw settings failure'); },
    }).readClinical();
    assertDenied(unavailable, 'settings_unavailable');

    let accessorReads = 0;
    const accessor = {};
    Object.defineProperty(accessor, 'aiProvider', { enumerable: true, get() { accessorReads += 1; return 'ollama'; } });
    for (const snapshot of [null, [], { ...VALID_SETTINGS, extra: 'raw' }, { aiProvider: 42 }, accessor]) {
        const result = await createHostLocalProviderBindingService({
            readSettings: async () => snapshot as never,
        }).readClinical();
        assertDenied(result, 'settings_corrupt');
    }
    assert.equal(accessorReads, 0);
});

test('non include valori settings o errori raw nei dinieghi', async () => {
    const result = await read({
        ...VALID_SETTINGS,
        aiProvider: 'synthetic-secret-provider',
        aiModel_clinical: 'synthetic-secret-model',
        aiUrl: ['https:', '//synthetic-secret.example.test'].join(''),
    });
    const serialized = JSON.stringify(result);

    assert.equal(serialized.includes('synthetic-secret'), false);
    assert.equal(serialized.includes('raw settings failure'), false);
});
