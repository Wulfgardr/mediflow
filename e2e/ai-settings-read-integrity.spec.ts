import { expect, test, type Route } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';
import { readFunctionModelPreferences } from '../lib/ai-providers/fabric/function-model-preferences';

const forbiddenRuntimePath = (path: string) => /^\/api\/(?:ai|icd|who|ollama|mlx|providers?)(?:\/|$)/iu.test(path)
    || path.startsWith('/api/settings/ai/') || path.startsWith('/api/system/ai-')
    || path === '/api/system/native' || path === '/api/auth/reset';

for (const view of ['funzioni', 'modelli']) test(`AI settings ${view}: one failed router read blocks saving`, async ({ page, baseURL }) => {
    if (process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR || !baseURL
        || new URL(baseURL).hostname !== '127.0.0.1' || new URL(baseURL).port === '3000') throw Error('Owned isolated synthetic runtime required');
    const origin = new URL(baseURL).origin, blocked: string[] = [], writes: string[] = [], failedReads: string[] = [];
    const mockedUiWrites: { key: string; value: boolean }[] = [];
    const uiDefaults: Record<string, boolean> = { uiReduceMotion: false, uiReduceTransparency: false };
    const mockUiPreference = async (route: Route) => {
        const request = route.request(), path = new URL(request.url()).pathname;
        const key = path.startsWith('/api/settings/') ? path.slice('/api/settings/'.length) : undefined;
        if (request.method() === 'GET' && key && Object.hasOwn(uiDefaults, key)) {
            await route.fulfill({ json: { key, value: uiDefaults[key] } }); return true;
        }
        if (request.method() === 'POST' && path === '/api/settings') {
            const body = request.postDataJSON();
            if (body && Object.keys(body).length === 2 && Object.hasOwn(uiDefaults, body.key) && body.value === false) {
                mockedUiWrites.push({ key: body.key, value: false });
                await route.fulfill({ json: { key: body.key, value: false } }); return true;
            }
        }
        return false;
    };
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin) { blocked.push(url.href); return route.abort(); }
        if (await mockUiPreference(route)) return;
        if (url.origin === origin && url.pathname === '/api/siss/session-status' && request.method() === 'GET')
            return route.fulfill({ json: { status: 'unavailable', source: 'fixture', checkpoints: [] } });
        if (url.origin !== origin || forbiddenRuntimePath(url.pathname)
            || (url.pathname.startsWith('/api/') && request.method() !== 'GET' && !url.pathname.startsWith('/api/auth/'))) {
            blocked.push(url.href); return route.abort();
        }
        return route.continue();
    });
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const settings: Record<string, string> = {
        aiModelDefaultVersion: 'qwen35-default-v1', hardwareProfile: 'custom', aiProvider: 'ollama',
        aiModel_clinical: 'synthetic:clinical', aiModel_reasoning: 'synthetic:reasoning', aiModel: 'synthetic:clinical',
        aiUrl: 'http://127.0.0.1:11434/v1', ollamaUrl: 'http://127.0.0.1:11434/v1', documentRouterControlFlow: 'active',
        aiPatientInsightKillSwitch: 'disabled', aiSmartImportKillSwitch: 'disabled', aiDocumentSynthesisKillSwitch: 'disabled', aiTreatmentReasoningKillSwitch: 'disabled',
    };
    const preferences = readFunctionModelPreferences({ settings, ollamaLifecycle: { status: 'denied', reason: 'missing' },
        athenaLifecycle: { status: 'denied', reason: 'missing' }, athenaAvailable: false, athenaIdentity: 'synthetic' }, 'v2');
    await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url()), path = url.pathname;
        if (url.origin !== origin) { blocked.push(url.href); return route.abort(); }
        if (!path.startsWith('/api/')) return route.continue();
        if (await mockUiPreference(route)) return;
        if (request.method() !== 'GET') { writes.push(`${request.method()} ${path}`); return route.abort(); }
        if (path === '/api/settings/ai/functions') return route.fulfill({ json: preferences });
        if (path === '/api/settings/ai/chatgpt/status') return route.fulfill({ json: { state: 'disconnected', notice: null, plan: null,
            loginExpiresAt: null, actions: ['connect'], inferenceEnabled: false, executionBlock: 'data_boundary_unqualified' } });
        if (path.startsWith('/api/settings/')) {
            const key = decodeURIComponent(path.slice('/api/settings/'.length));
            if (key === 'documentRouterControlFlow') { failedReads.push(key); return route.fulfill({ status: 503, json: { error: 'Synthetic single-key failure' } }); }
            return Object.hasOwn(settings, key) ? route.fulfill({ json: { key, value: settings[key] } }) : route.fulfill({ status: 404, json: {} });
        }
        if (path === '/api/ai/models') return route.fulfill({ json: { models: [] } });
        if (path === '/api/ai/local-provider/onboarding') return route.fulfill({ json: { provider: 'ollama', credentialClass: 'local_model',
            model: settings.aiModel_clinical, state: 'missing', revision: 'a'.repeat(64), version: 0, receipt: null, canActivate: true, inference: 'not_run', qualification: 'not_assessed' } });
        if (path === '/api/system/ai-rollout-readiness') return route.fulfill({ json: { lanes: [], localControls: [] } });
        if (path === '/api/plugin-local-ui/pairing') return route.fulfill({ json: { available: false, pending: [], active: [] } });
        if (path === '/api/siss/session-status') return route.fulfill({ json: { status: 'unavailable', source: 'fixture', checkpoints: [] } });
        if (forbiddenRuntimePath(path) || /(?:ai|ollama|mlx|model|provider|download)/iu.test(path)) { blocked.push(path); return route.abort(); }
        return route.continue();
    });
    await page.goto(`/settings/ai/${view}`);
    const controls = page.getByTestId('ai-settings-controls');
    const error = page.getByText('Impossibile leggere le impostazioni.', { exact: false });
    const save = controls.getByRole('button', { name: /^Salva configurazione$/iu });
    await expect.poll(() => failedReads.length).toBe(1);
    await expect(controls).toHaveAttribute('aria-busy', 'false');
    await test.info().attach('read-integrity-observation', { contentType: 'application/json', body: JSON.stringify({
        view, baselineExpectedFailure: process.env.AI_SETTINGS_BASELINE === '1', failedReads, writes, mockedUiWrites, blocked,
        errorVisible: await error.isVisible(), controlsDisabled: await controls.evaluate(element => (element as HTMLFieldSetElement).disabled), saveDisabled: await save.isDisabled(),
        syntheticStoredRouter: settings.documentRouterControlFlow,
    }, null, 2) });
    await page.screenshot({ path: test.info().outputPath(`${view}-read-failure.png`), fullPage: true });
    await expect(error).toBeVisible();
    await expect(controls).toHaveJSProperty('disabled', true);
    await expect(save).toBeDisabled();
    await save.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`${view}-save-disabled.png`), fullPage: true });
    expect(failedReads).toEqual(['documentRouterControlFlow']);
    expect(writes).toEqual([]); expect(blocked).toEqual([]);
    expect(settings.documentRouterControlFlow).toBe('active');
});
