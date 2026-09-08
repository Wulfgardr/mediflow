/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFunctionModelCatalog, FUNCTION_SWITCH_KEYS, type FunctionModelSources } from './function-model-preferences';
import { createFunctionModelDispatch, FUNCTION_MODEL_CHOICE_HEADER, functionModelBindingSettings,
    captureFunctionModelTransportGuard, guardFunctionModelResolution } from './function-model-dispatch';
import { localProviderRegistry } from '../registry';

// Synthetic authentication/transport seams; not an owner, Ollama or clinical runtime qualification.
function fixture(): FunctionModelSources {
    return { settings: { aiProvider: 'ollama', aiUrl: 'http://127.0.0.1:11434',
        aiModel_clinical: 'synthetic-clinical:1', aiModel_reasoning: 'synthetic-reasoning:1',
        ...Object.fromEntries(Object.values(FUNCTION_SWITCH_KEYS).map(key => [key, 'enabled'])) },
    ollamaLifecycle: { status: 'available', record: { version: 1, lifecycle: {
        provider: 'ollama', credentialClass: 'local_model', status: 'available_unqualified' } } },
    athenaLifecycle: { status: 'denied', reason: 'missing' }, athenaIdentity: 'synthetic', athenaAvailable: false };
}
const request = (signal?: AbortSignal, choice?: unknown) => new Request('http://localhost/api/ai/patient-insight/preview', {
    method: 'POST', signal, headers: choice ? { [FUNCTION_MODEL_CHOICE_HEADER]: JSON.stringify(choice) } : {},
});

test('cancellation while pre-handler reauthentication resolves never enters the handler', async () => {
    const sources = fixture(); const controller = new AbortController(); let auth = 0; let calls = 0;
    const handler = createFunctionModelDispatch({ readSources: () => sources, authenticate: async () => {
        if (++auth === 2) { await Promise.resolve(); controller.abort(); }
        return 'synthetic-session';
    } })('patient_insight', async () => { calls++; return Response.json({ proposal: 'synthetic' }); });
    const response = await handler(request(controller.signal));
    assert.equal(response.status, 401); assert.equal(calls, 0);
    assert.equal(response.headers.get('x-mediflow-model-option'), null);
});

test('cancellation while final reauthentication resolves never publishes the proposal', async () => {
    const sources = fixture(); const controller = new AbortController(); let auth = 0;
    const handler = createFunctionModelDispatch({ readSources: () => sources, authenticate: async () => {
        if (++auth === 3) { await Promise.resolve(); controller.abort(); }
        return 'synthetic-session';
    } })('patient_insight', async () => Response.json({ proposal: 'must-not-publish' }));
    const response = await handler(request(controller.signal));
    assert.equal(response.status, 401); assert.doesNotMatch(await response.text(), /must-not-publish/);
    assert.equal(response.headers.get('x-mediflow-model-option'), null);
});

test('guarded transport does not start when cancellation occurs during its reauthentication', async () => {
    const sources = fixture(); const controller = new AbortController(); let auth = 0; let calls = 0;
    const handler = createFunctionModelDispatch({ readSources: () => sources, authenticate: async () => {
        if (++auth === 3) { await Promise.resolve(); controller.abort(); }
        return 'synthetic-session';
    } })('patient_insight', async () => {
        const resolution = localProviderRegistry.resolve({ task: 'clinical', provider: 'ollama',
            models: { clinical: 'synthetic-clinical:1' }, endpoint: 'http://127.0.0.1:11434', chatTimeoutMs: 1000 });
        resolution.adapter.chat = async () => { calls++; return { content: 'synthetic', stats: { latency: 0, tokensIn: 0, tokensOut: 0 } }; };
        await guardFunctionModelResolution(resolution).adapter.chat([]);
        return Response.json({ proposal: 'synthetic' });
    });
    const response = await handler(request(controller.signal));
    assert.equal(response.status, 401); assert.equal(calls, 0);
});

for (const outcome of ['success', 'failure'] as const) {
    test(`captured request override cannot be reused after preview ${outcome}`, async () => {
        const sources = fixture(); let retained: (() => Promise<void>) | undefined;
        const handler = createFunctionModelDispatch({ readSources: () => sources, authenticate: async () => 'synthetic-session' })(
            'patient_insight', async () => {
                retained = captureFunctionModelTransportGuard('ollama', 'synthetic-clinical:1', 'http://127.0.0.1:11434');
                await retained();
                if (outcome === 'failure') throw new Error('synthetic handler failure');
                return Response.json({ proposal: 'synthetic' });
            });
        const result = await handler(request()); assert.equal(result.status, outcome === 'success' ? 200 : 503);
        assert.ok(retained); await assert.rejects(retained(), /session_stale/);
    });
}

test('guard awaiting authentication cannot outlive the enclosing response', async () => {
    const sources = fixture(); let release!: () => void; let auth = 0;
    let pending!: Promise<void>; let rejection!: Promise<void>;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const handler = createFunctionModelDispatch({ readSources: () => sources, authenticate: async () => {
        if (++auth === 3) await wait;
        return 'synthetic-session';
    } })('patient_insight', async () => {
        const guard = captureFunctionModelTransportGuard('ollama', 'synthetic-clinical:1', 'http://127.0.0.1:11434');
        pending = guard(); rejection = assert.rejects(pending, /session_stale/);
        return Response.json({ proposal: 'synthetic' });
    });
    assert.equal((await handler(request())).status, 200);
    release(); await rejection;
});

test('concurrent default and override resolve exactly the cataloged model for each request', async () => {
    const sources = fixture(); const catalog = buildFunctionModelCatalog(sources);
    const handler = createFunctionModelDispatch({ readSources: () => sources, authenticate: async () => 'synthetic-session' })(
        'patient_insight', async () => {
            const settings = await functionModelBindingSettings(sources.settings, 'clinical');
            const resolution = localProviderRegistry.resolve({ task: 'clinical', provider: 'ollama',
                models: { clinical: settings.aiModel_clinical! }, endpoint: settings.aiUrl!, chatTimeoutMs: 1000 });
            await captureFunctionModelTransportGuard('ollama', resolution.adapter.getModel(), resolution.adapter.getBaseUrl())();
            assert.equal(resolution.fallback.strategy, 'none');
            return Response.json({ model: resolution.receipt.model });
        });
    const responses = await Promise.all([handler(request()), handler(request(undefined, {
        modelOptionId: catalog.bindings[1].modelOptionId, expectedCatalogRevision: catalog.revision }))]);
    assert.equal(responses[0].status, 200); assert.equal(responses[1].status, 200);
    assert.equal((await responses[0].json()).model, catalog.bindings[0].model);
    assert.equal((await responses[1].json()).model, catalog.bindings[1].model);
    assert.equal(responses[1].headers.get('x-mediflow-model-option'), catalog.bindings[1].modelOptionId);
    assert.equal(responses[1].headers.get('x-mediflow-model-source'), 'request_override');
    assert.equal(sources.settings.aiModel_clinical, 'synthetic-clinical:1');
});

test('model and endpoint mismatch still deny before transport; abort never causes fallback', async () => {
    const sources = fixture(); let calls = 0;
    for (const [model, endpoint] of [['synthetic-other:1', 'http://127.0.0.1:11434'],
        ['synthetic-clinical:1', 'http://127.0.0.1:11435']]) {
        const handler = createFunctionModelDispatch({ readSources: () => sources, authenticate: async () => 'synthetic-session' })(
            'patient_insight', async () => { await captureFunctionModelTransportGuard('ollama', model, endpoint)(); calls++;
                return Response.json({}); });
        assert.equal((await handler(request())).status, 409);
    }
    assert.equal(calls, 0);
});
