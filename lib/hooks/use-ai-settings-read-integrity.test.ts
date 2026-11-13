import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { harness } from './ai-settings-controller.test-support.ts';

const initialSettings = {
    aiModelDefaultVersion: 'qwen35-default-v1', hardwareProfile: 'high', aiProvider: 'ollama',
    aiModel_clinical: 'synthetic:clinical', aiModel_reasoning: 'synthetic:reasoning', aiModel: 'synthetic:clinical',
    aiUrl: 'http://127.0.0.1:11434/v1', ollamaUrl: 'http://127.0.0.1:11434/v1',
    documentRouterControlFlow: 'active', aiInsightMode: 'manual',
    aiInsightManualConfig: JSON.stringify({ maxDocuments: 7, maxDocumentSummaryChars: 300, maxDocumentContextChars: 2400, outputMaxTokens: 600 }),
    aiPatientInsightKillSwitch: 'disabled', aiDocumentSynthesisKillSwitch: 'disabled',
    aiSmartImportKillSwitch: 'disabled', aiTreatmentReasoningKillSwitch: 'enabled',
};


async function scenario(t: TestContext, failure?: { key: string; status: number; gate?: Promise<void> }) {
    const settings = new Map<string, string>(Object.entries(initialSettings));
    if (failure?.status === 404) settings.delete(failure.key);
    const writes: { key: string; value: string }[] = [];
    const events = new EventTarget();
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: events });
    t.after(() => { if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window'); });
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, options?: RequestInit) => {
        const url = String(input);
        if (url === '/api/settings/ai/configuration' && options?.method === 'PUT') {
            const { values } = JSON.parse(String(options.body));
            for (const [key, value] of Object.entries(values)) {
                assert.notEqual(key, 'aiTreatmentReasoningKillSwitch');
                const row = { key, value: value as string };
                writes.push(row); settings.set(key, row.value);
            }
            return Response.json({ success: true, values });
        }
        if (url === '/api/settings' && options?.method === 'POST') {
            const row = JSON.parse(String(options.body));
            assert.notEqual(row.key, 'aiTreatmentReasoningKillSwitch');
            writes.push(row); settings.set(row.key, row.value);
            return Response.json(row);
        }
        assert.ok(url.startsWith('/api/settings/'), `Unexpected network: ${url}`);
        const key = decodeURIComponent(url.slice('/api/settings/'.length));
        if (failure?.key === key) {
            await failure.gate;
            if (failure.status !== 200) return Response.json({ error: 'synthetic failure' }, { status: failure.status });
        }
        return settings.has(key) ? Response.json({ key, value: settings.get(key) }) : Response.json({}, { status: 404 });
    });
    const controller = harness(events);
    t.after(controller.close);
    controller.render();
    await new Promise<void>(resolve => setImmediate(resolve));
    return { ...controller, settings, writes, events };
}

test('a single router read failure blocks saving without replacing the stored active mode', async t => {
    const fixture = await scenario(t, { key: 'documentRouterControlFlow', status: 503 });
    const controller = fixture.render();
    assert.equal(controller.aiSettingsLoadState, 'failed');
    await controller.saveAiConfig();
    assert.equal(fixture.settings.get('documentRouterControlFlow'), 'active');
    assert.deepEqual(fixture.writes, []);
    assert.equal(fixture.toasts.length, 0);
});

test('genuine missing router key retains its documented default and remains saveable', async t => {
    const fixture = await scenario(t, { key: 'documentRouterControlFlow', status: 404 });
    const ready = fixture.render();
    assert.equal(ready.aiSettingsLoadState, 'ready');
    assert.equal(ready.documentRouterControlFlowMode, 'shadow');
    await ready.saveAiConfig();
    assert.equal(fixture.settings.get('documentRouterControlFlow'), 'shadow');
    assert.equal(fixture.toasts.at(-1)?.tone, 'success');
});

test('successful reads preserve the stored mode and model configuration on save', async t => {
    const fixture = await scenario(t);
    const ready = fixture.render();
    assert.equal(ready.aiSettingsLoadState, 'ready');
    assert.equal(ready.documentRouterControlFlowMode, 'active');
    assert.equal(ready.aiConfig.model_clinical, 'synthetic:clinical');
    await ready.saveAiConfig();
    assert.equal(fixture.settings.get('documentRouterControlFlow'), 'active');
    assert.equal(fixture.settings.get('aiModel_clinical'), 'synthetic:clinical');
    assert.equal(fixture.settings.get('aiTreatmentReasoningKillSwitch'), 'enabled');
    assert.ok(fixture.writes.some(row => row.key === 'aiInsightManualConfig'));
    assert.equal(fixture.toasts.at(-1)?.tone, 'success');
});

for (const status of [200, 503]) test(`unmount retires a pending read before HTTP ${status} can publish its result`, async t => {
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const fixture = await scenario(t, { key: 'documentRouterControlFlow', status, gate });
    assert.equal(fixture.render().aiSettingsLoadState, 'loading');
    fixture.close();
    release();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(fixture.render().aiSettingsLoadState, 'loading');
    await fixture.render().saveAiConfig();
    assert.deepEqual(fixture.writes, []);
});
