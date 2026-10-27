import type { Page, Route } from '@playwright/test';
import { createFunctionModelPreferencesService, FUNCTION_SWITCH_KEYS, type FunctionModelSources } from '../../lib/ai-providers/fabric/function-model-preferences';

export type FunctionsScenario = 'list' | 'off' | 'unavailable' | 'configured' | 'pending' | 'auth-error' | 'read-error';
export const functionScenarios: readonly FunctionsScenario[] = ['list', 'off', 'unavailable', 'configured', 'pending', 'auth-error', 'read-error'];
const model = 'synthetic-long-model-name-for-functions-composition:latest';
const ids = Object.keys(FUNCTION_SWITCH_KEYS) as (keyof typeof FUNCTION_SWITCH_KEYS)[];
const admitted = (provider: string) => ({ status: 'available', record: { lifecycle: { status: 'available_unqualified', provider, credentialClass: 'local_model' } } });
const forbidden = (path: string) => /^\/api\/(?:ai|icd|who|ollama|mlx|providers?)(?:\/|$)/iu.test(path)
    || path.startsWith('/api/settings/ai/') || path.startsWith('/api/system/ai-')
    || path === '/api/system/native' || path === '/api/auth/reset';
const uiDefaults: Record<string, boolean> = { uiReduceMotion: false, uiReduceTransparency: false };
async function mockUiPreference(route: Route, writes: unknown[]) {
    const request = route.request(), path = new URL(request.url()).pathname;
    const key = path.startsWith('/api/settings/') ? path.slice('/api/settings/'.length) : undefined;
    if (request.method() === 'GET' && key && Object.hasOwn(uiDefaults, key)) {
        await route.fulfill({ json: { key, value: false } }); return true;
    }
    if (request.method() === 'POST' && path === '/api/settings') {
        const body = request.postDataJSON();
        if (body && Object.keys(body).length === 2 && Object.hasOwn(uiDefaults, body.key) && body.value === false) {
            writes.push({ key: body.key, value: false });
            await route.fulfill({ json: { key: body.key, value: false } }); return true;
        }
    }
    return false;
}

export async function installFunctionsEgressGuard(page: Page, baseURL: string) {
    const origin = new URL(baseURL).origin;
    const blocked: string[] = [];
    const mockedUiWrites: unknown[] = [];
    const handler: Parameters<Page['route']>[1] = async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin) { blocked.push(`${request.method()} ${url.href}`); return route.abort(); }
        if (await mockUiPreference(route, mockedUiWrites)) return;
        if (url.pathname === '/api/siss/session-status' && request.method() === 'GET') return route.fulfill({ json: { status: 'unavailable', source: 'fixture', checkpoints: [] } });
        if (forbidden(url.pathname) || (url.pathname.startsWith('/api/') && request.method() !== 'GET' && !url.pathname.startsWith('/api/auth/'))) {
            blocked.push(`${request.method()} ${url.href}`); return route.abort();
        }
        return route.continue();
    };
    await page.route('**/*', handler);
    return { blocked, mockedUiWrites, close: () => page.unroute('**/*', handler) };
}

export async function installFunctionsMocks(page: Page, baseURL: string, scenario: FunctionsScenario = 'list') {
    const origin = new URL(baseURL).origin;
    if (new URL(baseURL).hostname !== '127.0.0.1' || new URL(baseURL).port === '3000') throw Error('Isolated synthetic loopback required');
    const config: Record<string, string> = {
        aiModelDefaultVersion: 'qwen35-default-v1', aiProvider: 'ollama', hardwareProfile: 'custom',
        aiModel_clinical: model, aiModel_reasoning: model, aiModel: model,
        aiUrl: 'http://127.0.0.1:11434/v1', ollamaUrl: 'http://127.0.0.1:11434/v1',
        aiInsightMode: 'manual', documentRouterControlFlow: 'off',
        aiInsightManualConfig: JSON.stringify({ maxDocuments: 7, maxDocumentSummaryChars: 300, maxDocumentContextChars: 2400, outputMaxTokens: 600 }),
        ...Object.fromEntries(ids.map((id, index) => [FUNCTION_SWITCH_KEYS[id], scenario === 'off' || (scenario === 'list' && index % 2) ? 'disabled' : 'enabled'])),
    };
    const initialConfig = structuredClone(config);
    const state = { pending: scenario === 'pending', preferenceStatus: scenario === 'auth-error' ? 401 : scenario === 'read-error' ? 503 : 200,
        failedSettingKeys: new Set<string>(), failSave: false, failApply: false, failPreview: false };
    const calls: { path: string; method: string; body?: unknown }[] = [];
    const settingsWrites: unknown[] = [], preferenceWrites: unknown[] = [], mockedUiWrites: unknown[] = [], blocked: string[] = [];
    let releasePending: () => void = () => {};
    const gate = new Promise<void>(resolve => { releasePending = () => { state.pending = false; resolve(); }; });
    const sources = (): FunctionModelSources => ({ settings: config,
        ollamaLifecycle: scenario === 'unavailable' ? { status: 'denied', reason: 'missing' } : admitted('ollama'),
        athenaLifecycle: scenario === 'unavailable' ? { status: 'denied', reason: 'missing' } : admitted('athena_mlx'),
        athenaAvailable: scenario !== 'unavailable', athenaIdentity: 'synthetic-no-runtime' });
    const service = createFunctionModelPreferencesService({ readSources: sources, immediate: work => work(),
        writeSettings(writes) { preferenceWrites.push(structuredClone(writes)); Object.assign(config, writes); } });
    const handler: Parameters<Page['route']>[1] = async route => {
        const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
        const deny = () => { blocked.push(`${method} ${url.origin === origin ? path : url.href}`); return route.abort(); };
        if (url.origin !== origin) return deny();
        if (!path.startsWith('/api/')) return route.continue();
        if (await mockUiPreference(route, mockedUiWrites)) return;
        if (path.startsWith('/api/auth/') && path !== '/api/auth/reset') return route.continue();
        let body: Record<string, unknown> | undefined;
        try {
            if (method !== 'GET') {
                const parsed: unknown = request.postDataJSON();
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return deny();
                body = parsed as Record<string, unknown>;
            }
        } catch { return deny(); }
        calls.push({ path, method, ...(body === undefined ? {} : { body }) });
        if (path === '/api/settings/ai/functions' || path === '/api/settings/ai/functions/preview') {
            if (state.pending) await gate;
            if (state.preferenceStatus !== 200) return route.fulfill({ status: state.preferenceStatus, json: { error: 'Synthetic unavailable' } });
            if (path.endsWith('/preview') && method !== 'POST') return deny();
            if (method === 'GET') return route.fulfill({ json: service.read('v2') });
            if (method !== 'POST') return deny();
            if (path.endsWith('/preview') ? state.failPreview : state.failApply) return route.fulfill({ status: 503, json: { error: 'Synthetic write not confirmed' } });
            try { return await route.fulfill({ json: path.endsWith('/preview') ? service.preview(body) : service.apply(body) }); }
            catch { return route.fulfill({ status: 409, json: { error: 'Synthetic command rejected' } }); }
        }
        if (path === '/api/settings/ai/chatgpt/status' && method === 'GET') return route.fulfill({ json: {
            state: 'disconnected', notice: null, plan: null, loginExpiresAt: null, actions: ['connect'],
            inferenceEnabled: false, executionBlock: 'data_boundary_unqualified',
        } });
        if (path === '/api/settings' || path.startsWith('/api/settings/')) {
            if (path.startsWith('/api/settings/ai/')) return deny();
            const key = method === 'GET' ? decodeURIComponent(path.slice('/api/settings/'.length)) : body?.key;
            if (typeof key !== 'string') return deny();
            if (state.pending && Object.hasOwn(initialConfig, key)) await gate;
            if (method === 'GET') return state.failedSettingKeys.has(key)
                ? route.fulfill({ status: 503, json: { error: 'Synthetic setting read failed' } })
                : route.fulfill({ json: { key, value: config[key] ?? null } });
            if (path !== '/api/settings' || method !== 'POST' || !Object.hasOwn(initialConfig, key) || typeof body?.value !== 'string') return deny();
            settingsWrites.push(structuredClone(body));
            if (state.failSave) return route.fulfill({ status: 503, json: { error: 'Synthetic save not confirmed' } });
            config[key] = body.value;
            return route.fulfill({ json: { key, value: body.value } });
        }
        if (path === '/api/plugin-local-ui/pairing' && method === 'GET') return route.fulfill({ json: { available: false, pending: [], active: [] } });
        if (path === '/api/siss/session-status' && method === 'GET') return route.fulfill({ json: { status: 'unavailable', source: 'fixture', checkpoints: [] } });
        if (method !== 'GET' || forbidden(path) || /(?:ai|ollama|mlx|model|provider|download|runtime)/iu.test(path)) return deny();
        return route.continue();
    };
    await page.route('**/*', handler);
    return { config, initialConfig, state, calls, settingsWrites, preferenceWrites, mockedUiWrites, blocked, releasePending,
        close: async () => { releasePending(); await page.unroute('**/*', handler); } };
}
