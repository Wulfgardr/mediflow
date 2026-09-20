/* @Codex — public/synthetic configuration + browser seams, not runtime admission. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createFunctionModelPreferencesService, readFunctionModelPreferences, planFunctionModelUpdate,
    resolveFunctionModelDispatch, parseFunctionModelCommand, FUNCTION_MODEL_IDS, FUNCTION_SWITCH_KEYS,
    FUNCTION_PREFERENCES_KEY, type FunctionModelSources, type FunctionModelCommand } from '../ai-providers/fabric/function-model-preferences';
import { createPreferencesClient } from './browser';
import { createModelPreviewClient } from './preview-client';
import { ORDINARY_FLOW_SCHEMA, ORDINARY_SELECTION_SCHEMA } from '../chatgpt-product/ordinary-wire';

function sources(): FunctionModelSources {
    return { settings: { aiProvider: 'ollama', aiUrl: 'http://127.0.0.1:11434',
        aiModel_clinical: 'synthetic-clinical:1', aiModel_reasoning: 'synthetic-reasoning:1',
        ...Object.fromEntries(Object.values(FUNCTION_SWITCH_KEYS).map(key => [key, 'disabled'])) },
        ollamaLifecycle: { status: 'denied', reason: 'missing' }, athenaLifecycle: { status: 'denied', reason: 'missing' },
        athenaAvailable: false, athenaIdentity: 'synthetic-not-installed' };
}
function activation(source: FunctionModelSources, enabled = true): FunctionModelCommand {
    const dto = readFunctionModelPreferences(source, 'v2');
    return { schemaVersion: 'mediflow.function-preferences-command.v2', commandId: randomUUID(),
        expectedRevision: dto.revision, expectedCatalogRevision: dto.catalogRevision,
        action: 'set_activation', functionId: 'patient_insight', enabled };
}
async function until(check: () => boolean) {
    for (let i = 0; i < 50; i++) { if (check()) return; await new Promise<void>(resolve => setImmediate(resolve)); }
    assert.ok(check(), 'synthetic browser transition');
}

// One matrix: all four unavailable local lanes -> explicit activation -> remote
// prepare only. Consent/login/generate matrices stay in ordinary-browser.test.ts.
for (const functionId of FUNCTION_MODEL_IDS) test(`${functionId}: explicit OpenAI activation reuses the switch, no local admission or fallback`, async t => {
    let source = sources(), settingsWrites = 0, prepareCalls = 0, providerCalls = 0, clinicalWrites = 0;
    const service = createFunctionModelPreferencesService({ readSources: () => source, immediate: fn => fn(),
        writeSettings(writes) { settingsWrites += Object.keys(writes).length; source = { ...source, settings: { ...source.settings, ...writes } }; } });
    const before = service.read('v2');
    const settings = () => ({ schema: 'mediflow.chatgpt-ordinary-settings.v1', revision: 'sha256_' + 'a'.repeat(64),
        enabled: true, retention: 'chatgpt_service_terms_apply',
        preferences: Object.fromEntries(FUNCTION_MODEL_IDS.map(id => [id, { use: 'local', model: null, effort: null }])),
        lanes: Object.fromEntries(FUNCTION_MODEL_IDS.map(id => [id, source.settings[FUNCTION_SWITCH_KEYS[id]]])) });
    const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === '/api/settings/ai/functions') return Response.json(service.read('v2'));
        if (path.endsWith('/ordinary/settings')) return Response.json(settings());
        if (path.endsWith('/ordinary/cancel')) return Response.json({});
        if (path === `/api/ai/${functionId.replaceAll('_', '-')}/preview`) {
            assert.deepEqual(JSON.parse(new Headers(init?.headers).get('x-mediflow-function-model')!),
                { schema: ORDINARY_SELECTION_SCHEMA, expectedPreferenceRevision: settings().revision });
            prepareCalls++;
            return Response.json({ schema: ORDINARY_FLOW_SCHEMA, functionId, attemptId: 'synthetic-attempt', phase: 'needs_consent',
                expiresAt: Date.now() + 60000, disclosure: { schema: 'mediflow.chatgpt-ordinary-disclosure.v1', revision: 'synthetic-disclosure',
                    operation: functionId, profileVersion: 'mediflow.ordinary-redacted-profile.v1', contextRevision: 'synthetic-context',
                    attemptRevision: 'synthetic-attempt', qualificationRevision: 'synthetic-qualification', sourceSha256: 'sha256_' + 'b'.repeat(64),
                    payloadSha256: 'c'.repeat(64), payloadBytes: 100, egress: ['auth.openai.com:443', 'chatgpt.com:443'], proposalOnly: true, clinicalWrites: 0 } }, { status: 202 });
        }
        // Any unintended provider/writer dispatch is observable, not a no-op.
        if (/apply|commit/u.test(path)) clinicalWrites++; else providerCalls++;
        throw new Error('unexpected synthetic dispatch');
    }) as typeof fetch;
    const picker = createModelPreviewClient(functionId, transport); t.after(() => picker.reset(false)); picker.reset(true);
    picker.chooseRemote(); await until(() => !picker.remote.getSnapshot().loading);
    await assert.rejects(picker.begin());
    assert.deepEqual([prepareCalls, providerCalls, clinicalWrites], [0, 0, 0]);
    const command = { ...activation(source), functionId };
    assert.equal(service.preview(command).writesPerformed, 0); assert.equal(settingsWrites, 0);
    const applied = service.apply(command); assert.equal(applied.functions.find(row => row.id === functionId)!.enabled, true);
    assert.deepEqual(applied.functions.map(row => row.defaultModelOptionId), before.functions.map(row => row.defaultModelOptionId));
    assert.deepEqual(JSON.parse(source.settings[FUNCTION_PREFERENCES_KEY]!).defaults,
        Object.fromEntries(FUNCTION_MODEL_IDS.map(id => [id, null])));
    assert.equal(settingsWrites, 2); assert.deepEqual(service.apply(command), applied); assert.equal(settingsWrites, 2);
    assert.throws(() => resolveFunctionModelDispatch(source, functionId), /provider_unavailable/u);
    // An explicit unavailable local selection still denies, never choosing OpenAI.
    await picker.read(); await assert.rejects(picker.begin(), /provider_unavailable/u);
    assert.equal(prepareCalls, 0); assert.match(picker.getSnapshot().error!, /provider_unavailable/u);
    picker.chooseRemote(); await until(() => !picker.remote.getSnapshot().loading); await picker.begin();
    const output = picker.fetch(`/api/ai/${functionId.replaceAll('_', '-')}/preview`, { method: 'POST', body: '{}' });
    const denied = assert.rejects(output); await until(() => picker.remote.getSnapshot().state?.phase === 'needs_consent');
    assert.deepEqual([prepareCalls, providerCalls, clinicalWrites], [1, 0, 0]);
    picker.cancel(); await denied;
    service.apply({ ...activation(source, false), functionId });
    picker.chooseRemote(); await until(() => !picker.remote.getSnapshot().loading); await assert.rejects(picker.begin());
    assert.deepEqual([prepareCalls, providerCalls, clinicalWrites], [1, 0, 0]);
});

test('activation retains stale saved binding and enforces revision/catalog CAS and closed v2 shape', () => {
    let source = sources();
    const admitted = { ...source, athenaAvailable: true, athenaLifecycle: { status: 'available', record: { lifecycle: {
        status: 'available_unqualified', provider: 'athena_mlx', credentialClass: 'local_model' } } } };
    const view = readFunctionModelPreferences(admitted, 'v2');
    const saved = planFunctionModelUpdate(admitted, { ...activation(admitted), action: 'set', functionId: 'treatment_reasoning', enabled: true,
        defaultModelOptionId: view.functions[3].defaultModelOptionId });
    source = { ...source, settings: { ...source.settings, ...saved.writes } };
    const before = JSON.parse(source.settings[FUNCTION_PREFERENCES_KEY]!).defaults;
    const command = { ...activation(source), functionId: 'treatment_reasoning' };
    const plan = planFunctionModelUpdate(source, command);
    assert.deepEqual(JSON.parse(plan.writes[FUNCTION_PREFERENCES_KEY]).defaults, before);
    assert.equal(plan.view.functions[3].bindingState, 'stale');
    assert.throws(() => parseFunctionModelCommand({ ...command, defaultModelOptionId: null }), /input_invalid/u);
    assert.throws(() => parseFunctionModelCommand({ ...command, schemaVersion: 'mediflow.function-preferences-command.v1' }), /input_invalid/u);
    assert.throws(() => planFunctionModelUpdate(source, { ...command, expectedRevision: 'sha256_' + '0'.repeat(64) }), /revision_conflict/u);
    assert.throws(() => planFunctionModelUpdate(source, { ...command, expectedCatalogRevision: 'sha256_' + '0'.repeat(64) }), /catalog_stale/u);
    const after = { ...source, settings: { ...source.settings, ...plan.writes } };
    assert.throws(() => planFunctionModelUpdate(after, { ...command, enabled: false }), /command_conflict/u);
    assert.throws(() => resolveFunctionModelDispatch(after, 'treatment_reasoning'), /catalog_stale/u);
});

test('unavailable local preview is guarded before dispatch; prior list survives client and server denials', async () => {
    const source = sources(); let calls = 0; let serverDenial = false;
    let dto = readFunctionModelPreferences(source, 'v2');
    const client = createPreferencesClient((async (_input, init) => {
        calls++;
        if (init?.method === 'POST') {
            assert.equal(serverDenial, true);
            return Response.json({ code: 'provider_unavailable', error: 'PRIVATE_PROVIDER_SENTINEL' }, { status: 503 });
        }
        return Response.json(dto);
    }) as typeof fetch);
    await client.read(); const previous = client.getSnapshot().dto;
    for (const defaultModelOptionId of [null, dto.functions[0].defaultModelOptionId]) {
        await client.preview({ action: 'set', functionId: 'patient_insight', enabled: true, defaultModelOptionId });
        assert.equal(calls, 1); assert.equal(client.getSnapshot().dto, previous);
        assert.equal(client.getSnapshot().proposed, null); assert.match(client.getSnapshot().error!, /provider_unavailable/u);
    }
    // Lifecycle can disappear after a valid read: the server denial is equally precise.
    dto = { ...dto, functions: dto.functions.map(row => ({ ...row, options: row.options.map(option => ({ ...option, state: 'available_unqualified' as const })) })) } as typeof dto;
    await client.read(); const available = client.getSnapshot().dto; serverDenial = true;
    await client.preview({ action: 'set', functionId: 'patient_insight', enabled: true, defaultModelOptionId: null });
    assert.equal(calls, 3); assert.equal(client.getSnapshot().dto, available);
    assert.match(client.getSnapshot().error!, /provider_unavailable/u); assert.doesNotMatch(client.getSnapshot().error!, /PRIVATE/u);
    await client.apply(); assert.equal(calls, 3, 'failed preview cannot be applied');
});

test('browser activation requires preview/apply/reread and never changes local preference or host opt-in', async () => {
    let source = sources(), writes = 0; const paths: string[] = [];
    const service = createFunctionModelPreferencesService({ readSources: () => source, immediate: fn => fn(),
        writeSettings(next) { writes++; source = { ...source, settings: { ...source.settings, ...next } }; } });
    const client = createPreferencesClient((async (input, init) => {
        const path = String(input); paths.push(path);
        assert.equal(new Headers(init?.headers).get('x-mediflow-function-preferences'), '2');
        if (init?.method !== 'POST') return Response.json(service.read('v2'));
        const command = JSON.parse(String(init.body)); assert.equal(command.action, 'set_activation');
        return Response.json(path.endsWith('/preview') ? service.preview(command) : service.apply(command));
    }) as typeof fetch);
    await client.read();
    await client.preview({ action: 'set_activation', functionId: 'treatment_reasoning', enabled: true });
    assert.equal(writes, 0); assert.ok(client.getSnapshot().proposed); assert.equal(client.getSnapshot().error, null);
    await client.apply(); assert.equal(writes, 1); assert.equal(client.getSnapshot().saved, true);
    assert.equal(client.getSnapshot().dto!.functions[3].enabled, true);
    assert.equal(client.getSnapshot().dto!.functions[3].options[0].state, 'unavailable');
    assert.deepEqual(paths, ['/api/settings/ai/functions', '/api/settings/ai/functions/preview', '/api/settings/ai/functions', '/api/settings/ai/functions']);
    assert.equal(source.settings['ai.fabric.chatgptOrdinary'], undefined, 'activation cannot grant OpenAI policy');
});
