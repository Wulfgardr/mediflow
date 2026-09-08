/* @Codex */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test, { type TestContext } from 'node:test';
import { attestLocalOllamaModel } from '../ollama-locality';
import { createLocalProviderBindingReader } from '../local-provider-binding-reader';
import { localProviderRegistry } from '../registry';
import { buildFunctionModelCatalog, FUNCTION_SWITCH_KEYS, planFunctionModelUpdate, readFunctionModelPreferences,
    type FunctionModelSources } from './function-model-preferences';
import { createFunctionModelDispatch, FUNCTION_MODEL_CHOICE_HEADER, functionModelBindingSettings,
    guardFunctionModelResolution } from './function-model-dispatch';

// Real loopback HTTP + unchanged attestor/adapter. The server and all metadata,
// authentication and lifecycle inputs are synthetic: no Ollama process, weights,
// canonical Web owner, database, clinical result or runtime qualification.
async function transportFixture(t: TestContext, options: { version?: string; mismatchDigest?: boolean; stallPreload?: boolean } = {}) {
    const models = ['synthetic-clinical:1', 'synthetic-reasoning:1'].map((model, index) => ({
        name: model, model, size: 4096, digest: (index === 0 ? 'a' : 'b').repeat(64),
    }));
    const seen: Array<{ path: string; method: string; body: Record<string, unknown> | null }> = [];
    const errors: unknown[] = [];
    let markPreload!: () => void;
    const preloadStarted = new Promise<void>(resolve => { markPreload = resolve; });
    const server = createServer((request, response) => {
        void (async () => {
            const chunks: Buffer[] = [];
            for await (const chunk of request) chunks.push(Buffer.from(chunk));
            const raw = Buffer.concat(chunks).toString('utf8');
            const body = raw ? JSON.parse(raw) as Record<string, unknown> : null;
            seen.push({ path: request.url!, method: request.method!, body });
            let reply: unknown;
            switch (request.url) {
                case '/api/version': reply = { version: options.version ?? '0.33.3' }; break;
                case '/api/tags': reply = { models }; break;
                case '/api/show': reply = { details: { family: 'synthetic' } }; break;
                case '/api/generate':
                    assert.deepEqual(body, { model: body?.model, keep_alive: '30m' });
                    assert.ok(models.some(model => model.model === body?.model));
                    markPreload();
                    if (options.stallPreload) return;
                    reply = { model: body?.model, done: true }; break;
                case '/api/ps': reply = { models: options.mismatchDigest ? models.map(model => ({ ...model, digest: 'c'.repeat(64) })) : models }; break;
                case '/api/chat': reply = { model: body?.model, message: { content: 'synthetic transport response' }, done: true }; break;
                default: throw new Error(`Unexpected synthetic operation: ${request.url}`);
            }
            response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(reply));
        })().catch(error => { errors.push(error); response.writeHead(500); response.end(); });
    });
    t.after(async () => {
        await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
        assert.deepEqual(errors, []);
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    return { url: `http://127.0.0.1:${address.port}`, seen, preloadStarted };
}

function sourcesAt(url: string): FunctionModelSources {
    return { settings: { aiProvider: 'ollama', aiUrl: url,
        aiModel_clinical: 'synthetic-clinical:1', aiModel_reasoning: 'synthetic-reasoning:1',
        ...Object.fromEntries(Object.values(FUNCTION_SWITCH_KEYS).map(key => [key, 'enabled'])) },
    ollamaLifecycle: { status: 'available', record: { version: 1,
        lifecycle: { provider: 'ollama', credentialClass: 'local_model', status: 'available_unqualified' } } },
    athenaLifecycle: { status: 'denied', reason: 'missing' }, athenaIdentity: 'synthetic', athenaAvailable: false };
}

for (const id of ['patient_insight', 'smart_import', 'document_synthesis'] as const) {
    for (const mode of ['host_configuration', 'saved_preference', 'request_override'] as const) {
        test(`${id}: ${mode} reaches the unchanged adapter as exactly the cataloged HTTP model`, async t => {
            const fixture = await transportFixture(t); let sources = sourcesAt(fixture.url);
            const role = id === 'document_synthesis' ? 'reasoning' : 'clinical';
            const catalog = buildFunctionModelCatalog(sources);
            const host = catalog.bindings.find(binding => binding.modelOptionId === catalog.hostDefaults[id]); assert.ok(host);
            const other = catalog.bindings.find(binding => binding.provider === 'ollama' && binding.modelOptionId !== host.modelOptionId); assert.ok(other);
            const chosen = mode === 'host_configuration' ? host : other;
            if (mode === 'saved_preference') {
                const view = readFunctionModelPreferences(sources);
                const plan = planFunctionModelUpdate(sources, { schemaVersion: 'mediflow.function-preferences-command.v1',
                    commandId: randomUUID(), expectedRevision: view.revision, expectedCatalogRevision: view.catalogRevision,
                    action: 'set', functionId: id, enabled: true, defaultModelOptionId: chosen.modelOptionId });
                sources = { ...sources, settings: { ...sources.settings, ...plan.writes } };
            }
            const settingsBefore = JSON.stringify(sources.settings);
            const handler = createFunctionModelDispatch({ authenticate: async () => 'synthetic-session', readSources: () => sources })(id, async request => {
                const projected = await functionModelBindingSettings({ aiProvider: sources.settings.aiProvider!, aiUrl: fixture.url,
                    [`aiModel_${role}`]: sources.settings[`aiModel_${role}`]! }, role);
                // Clinical uses the actual host reader. Reasoning uses its registry task;
                // this test does not replace or claim the separate sealed synthesis binder.
                const resolution = role === 'clinical'
                    ? await createLocalProviderBindingReader({ readSettings: async () => projected }).readClinical().then(binding => {
                        assert.equal(binding.status, 'available');
                        if (binding.status !== 'available') throw new Error('Synthetic clinical binding denied');
                        return binding.resolution;
                    })
                    : localProviderRegistry.resolve({ task: role, provider: 'ollama', models: { reasoning: projected.aiModel_reasoning },
                        endpoint: fixture.url, chatTimeoutMs: 300_000 });
                assert.equal(resolution.receipt.model, chosen.model); assert.equal(resolution.fallback.strategy, 'none');
                const result = await guardFunctionModelResolution(resolution).adapter.chat([{ role: 'user', content: 'SYNTHETIC TRANSPORT CHECK' }], request.signal, 8);
                return Response.json({ model: resolution.receipt.model, content: result.content });
            });
            const response = await handler(new Request(`http://localhost/api/ai/${id}/preview`, { method: 'POST', headers: mode === 'request_override'
                ? { [FUNCTION_MODEL_CHOICE_HEADER]: JSON.stringify({ modelOptionId: chosen.modelOptionId, expectedCatalogRevision: catalog.revision }) } : {} }));
            assert.equal(response.status, 200);
            assert.deepEqual(await response.json(), { model: chosen.model, content: 'synthetic transport response' });
            assert.equal(response.headers.get('x-mediflow-model-option'), chosen.modelOptionId);
            assert.equal(response.headers.get('x-mediflow-model-source'), mode);
            assert.equal(response.headers.get('cache-control'), 'no-store');
            assert.deepEqual(fixture.seen.map(call => call.path), ['/api/version', '/api/tags', '/api/show', '/api/generate', '/api/ps', '/api/chat']);
            assert.deepEqual(fixture.seen[3].body, { model: chosen.model, keep_alive: '30m' });
            assert.equal(fixture.seen[5].body?.model, chosen.model);
            assert.equal(JSON.stringify(sources.settings), settingsBefore);
        });
    }
}

test('unchanged canonical attestor stops at unsupported synthetic version, before preload', async t => {
    const fixture = await transportFixture(t, { version: '0.0.0-synthetic' });
    await assert.rejects(attestLocalOllamaModel(fixture.url, 'synthetic-clinical:1'), /provider_unready/);
    assert.deepEqual(fixture.seen.map(call => call.path), ['/api/version']);
});

test('unchanged canonical attestor rejects running digest mismatch after prompt-free preload', async t => {
    const fixture = await transportFixture(t, { mismatchDigest: true });
    await assert.rejects(attestLocalOllamaModel(fixture.url, 'synthetic-clinical:1'), /model_not_local/);
    assert.deepEqual(fixture.seen.map(call => call.path), ['/api/version', '/api/tags', '/api/show', '/api/generate', '/api/ps']);
});

test('caller cancellation terminates real HTTP waiting for synthetic preload, with no running check or inference', async t => {
    const fixture = await transportFixture(t, { stallPreload: true });
    const controller = new AbortController();
    const operation = attestLocalOllamaModel(fixture.url, 'synthetic-clinical:1', controller.signal);
    const rejected = assert.rejects(operation, error => error instanceof DOMException && error.name === 'AbortError');
    await fixture.preloadStarted; controller.abort(); await rejected;
    assert.deepEqual(fixture.seen.map(call => call.path), ['/api/version', '/api/tags', '/api/show', '/api/generate']);
});
