import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test, { type TestContext } from 'node:test';
import ts from 'typescript';
import { db } from '../db';
import * as formatCount from '../format-count';
import * as installedOllamaModels from '../installed-ollama-models';
import * as aiModels from '../ai-models';
import * as aiInsightSettings from '../ai-insight-settings';
import * as patientInsightKillSwitch from '../ai-patient-insight-kill-switch';
import * as documentSynthesisKillSwitch from '../ai-document-synthesis-kill-switch';
import * as smartImportKillSwitch from '../ai-smart-import-kill-switch';
import * as treatmentReasoningKillSwitch from '../ai-treatment-reasoning-kill-switch';
import * as documentRouterControlFlow from '../domain/documents/document-router-control-flow';
import type { useAiSettingsController } from './use-ai-settings-controller';

type Controller = ReturnType<typeof useAiSettingsController>;
type Effect = { dependencies?: readonly unknown[]; cleanup?: () => void };
const filename = resolve('lib/hooks/use-ai-settings-controller.ts');
const initialSettings = {
    aiModelDefaultVersion: 'qwen35-default-v1', hardwareProfile: 'high', aiProvider: 'ollama',
    aiModel_clinical: 'synthetic:clinical', aiModel_reasoning: 'synthetic:reasoning', aiModel: 'synthetic:clinical',
    aiUrl: 'http://127.0.0.1:11434/v1', ollamaUrl: 'http://127.0.0.1:11434/v1',
    documentRouterControlFlow: 'active', aiInsightMode: 'manual',
    aiInsightManualConfig: JSON.stringify({ maxDocuments: 7, maxDocumentSummaryChars: 300, maxDocumentContextChars: 2400, outputMaxTokens: 600 }),
    aiPatientInsightKillSwitch: 'disabled', aiDocumentSynthesisKillSwitch: 'disabled',
    aiSmartImportKillSwitch: 'disabled', aiTreatmentReasoningKillSwitch: 'disabled',
};

function harness(events: EventTarget) {
    const states: unknown[] = [], refs: { current: unknown }[] = [], effects: Effect[] = [], pending: (() => void)[] = [];
    let stateIndex = 0, refIndex = 0, effectIndex = 0;
    const toasts: { tone: string; title: string }[] = [];
    const effect = (callback: () => void | (() => void), dependencies?: readonly unknown[]) => {
        const index = effectIndex++, previous = effects[index];
        if (!previous || !dependencies || dependencies.some((value, i) => !Object.is(value, previous.dependencies?.[i]))) {
            pending.push(() => { previous?.cleanup?.(); effects[index] = { dependencies, cleanup: callback() || undefined }; });
        }
    };
    const react = {
        useState(initial: unknown) {
            const index = stateIndex++;
            if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
            return [states[index], (next: unknown) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
        },
        useRef(initial: unknown) { return refs[refIndex++] ?? (refs[refIndex - 1] = { current: initial }); },
        useEffect: effect, useLayoutEffect: effect,
    };
    const testModule = { exports: {} as { useAiSettingsController: () => Controller } };
    const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
    const imports: Record<string, unknown> = {
        react,
        '../format-count': formatCount,
        '@/lib/installed-ollama-models': installedOllamaModels,
        '@/lib/db': { db },
        '@/components/ui/toast-provider': { useToast: () => ({ showToast: (value: typeof toasts[number]) => toasts.push(value) }) },
        '@/lib/ai-models': aiModels,
        '@/lib/ai-insight-settings': aiInsightSettings,
        '@/lib/ai-patient-insight-kill-switch': patientInsightKillSwitch,
        '@/lib/ai-document-synthesis-kill-switch': documentSynthesisKillSwitch,
        '@/lib/ai-smart-import-kill-switch': smartImportKillSwitch,
        '@/lib/ai-treatment-reasoning-kill-switch': treatmentReasoningKillSwitch,
        '@/lib/domain/documents/document-router-control-flow': documentRouterControlFlow,
    };
    runInNewContext(compiled.outputText, { module: testModule, exports: testModule.exports, window: events,
        console: { error() {} }, setTimeout, clearTimeout,
        require(specifier: string) {
            if (!Object.hasOwn(imports, specifier)) throw new Error(`Unexpected hook dependency: ${specifier}`);
            return imports[specifier];
        },
    }, { filename });
    const render = () => {
        stateIndex = refIndex = effectIndex = 0;
        const result = testModule.exports.useAiSettingsController();
        while (pending.length) pending.shift()!();
        return result;
    };
    return { render, toasts, close: () => effects.forEach(value => value.cleanup?.()) };
}

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
        if (url === '/api/settings' && options?.method === 'POST') {
            const row = JSON.parse(String(options.body)); writes.push(row); settings.set(row.key, row.value);
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
