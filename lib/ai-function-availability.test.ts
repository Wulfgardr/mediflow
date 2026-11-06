import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AiFunctionUnavailableError, assertFunctionAvailableInRelease } from './ai-function-availability.ts';
import { createFunctionModelDispatch } from './ai-providers/fabric/function-model-dispatch.ts';
import { buildFunctionModelCatalog, FUNCTION_SWITCH_KEYS, planFunctionModelUpdate, readFunctionModelPreferences, type FunctionModelSources } from './ai-providers/fabric/function-model-preferences.ts';
import { beginOrdinaryFunction } from './chatgpt-product/ordinary-flow.ts';

const denied = (error: unknown) => error instanceof AiFunctionUnavailableError && error.code === 'treatment_reasoning_unavailable_in_release';
const lifecycle = (provider: string) => ({ status: 'available', record: { version: 1, lifecycle: { status: 'available_unqualified', provider, credentialClass: 'local_model' } } });
const sources: FunctionModelSources = { settings: { aiProvider: 'ollama', aiModel_clinical: 'synthetic:1', aiModel_reasoning: 'synthetic:1',
    ...Object.fromEntries(Object.values(FUNCTION_SWITCH_KEYS).map(key => [key, 'enabled'])) }, ollamaLifecycle: lifecycle('ollama'), };

test('the release decision denies only Treatment Reasoning', () => {
    assert.throws(() => assertFunctionAvailableInRelease('treatment_reasoning'), denied);
    for (const id of ['patient_insight', 'smart_import', 'document_synthesis']) assert.doesNotThrow(() => assertFunctionAvailableInRelease(id));
});
{
    test('Web, GPUI and headless local dispatch: saved enabled cannot reach a transport', async () => {
        let launches = 0;
        const handler = createFunctionModelDispatch({ authenticate: async () => 'synthetic-session', readSources: () => sources })('treatment_reasoning', async () => { launches++; return Response.json({}); });
        const response = await handler(new Request('http://localhost/api/ai/treatment-reasoning/preview', { method: 'POST' }));
        assert.equal(response.status, 403); assert.equal((await response.json()).code, 'treatment_reasoning_unavailable_in_release');
        assert.equal(launches, 0);
    });
}

for (const channel of ['web', 'native'] as const) test(`ordinary ${channel}: no consent, resource or remote process is acquired`, async () => {
    let effects = 0;
    const session = new Proxy({}, { get() { effects++; throw new Error('authority acquired'); } });
    await assert.rejects(beginOrdinaryFunction(new Request('http://localhost/'), 'treatment_reasoning', session as never, async () => { effects++; return Response.json({}); }), denied);
    assert.equal(effects, 0);
});


test('local and ChatGPT preferences are never rewritten by presets; direct changes are denied', () => {
    const before = JSON.stringify(sources);
    const view = readFunctionModelPreferences(sources, 'v2');
    // the saved switch is shown as saved; availability, not the switch, keeps the function closed.
    assert.equal(view.functions[3].enabled, true);
    assert.deepEqual(view.functions[3].options, []);
    assert.equal(view.functions[3].bindingState, 'unsupported');
    assert.ok(buildFunctionModelCatalog(sources).bindings.filter(b => b.functions.includes('treatment_reasoning')).every(b => !b.available));
    for (const action of ['set', 'set_activation'] as const) assert.throws(() => planFunctionModelUpdate(sources, {
        schemaVersion: 'mediflow.function-preferences-command.v2', commandId: 'synthetic-release-change', expectedRevision: view.revision, expectedCatalogRevision: view.catalogRevision,
        action, functionId: 'treatment_reasoning', enabled: true, ...(action === 'set' ? { defaultModelOptionId: null } : {}),
    }), denied);
    for (const presetId of ['all_off', 'host_defaults']) {
        const plan = planFunctionModelUpdate(sources, { schemaVersion: 'mediflow.function-preferences-command.v2', commandId: 'synthetic-release-preset', expectedRevision: view.revision,
            expectedCatalogRevision: view.catalogRevision, action: 'preset', presetId });
        assert.equal(plan.writes[FUNCTION_SWITCH_KEYS.treatment_reasoning], undefined);
        assert.equal(plan.view.functions[3].enabled, true);
    }
    assert.equal(JSON.stringify(sources), before);
});
