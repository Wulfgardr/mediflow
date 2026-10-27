import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';
import { readFunctionModelPreferences } from '../lib/ai-providers/fabric/function-model-preferences';

for (const view of ['funzioni', 'modelli']) test(`AI settings ${view}: one failed router read blocks saving`, async ({ page, baseURL }) => {
    if (process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR || !baseURL
        || new URL(baseURL).hostname !== '127.0.0.1' || new URL(baseURL).port === '3000') throw Error('Owned isolated synthetic runtime required');
    const origin = new URL(baseURL).origin, blocked: string[] = [], writes: string[] = [], failedReads: string[] = [];
    await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin || url.pathname.startsWith('/api/ai/') || url.pathname.startsWith('/api/settings/ai/')) {
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
        if (/(?:ai|ollama|mlx|model|provider|download)/iu.test(path)) { blocked.push(path); return route.abort(); }
        return route.continue();
    });
    await page.goto(`/settings/ai/${view}`);
    await expect(page.getByText('Impossibile leggere le impostazioni.', { exact: false })).toBeVisible();
    const controls = page.getByTestId('ai-settings-controls');
    await expect(controls).toBeDisabled();
    await expect(controls.getByRole('button', { name: /^Salva configurazione$/iu })).toBeDisabled();
    expect(failedReads).toEqual(['documentRouterControlFlow']);
    expect(writes).toEqual([]); expect(blocked).toEqual([]);
    expect(settings.documentRouterControlFlow).toBe('active');
});
