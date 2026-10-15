import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

test('salvataggio riuscito rilegge il passo 4 senza attivare; errore di salvataggio non rilegge', async () => {
    const result = await build({
        stdin: { contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
            import Page from './app/settings/ai/modelli/page';
            import { ToastProvider } from './components/ui/toast-provider';
            createRoot(document.getElementById('root')).render(<ToastProvider><Page /></ToastProvider>);`,
            resolveDir: process.cwd(), loader: 'tsx' },
        bundle: true, write: false, outfile: 'models-mount.js', format: 'iife', platform: 'browser',
        define: { 'process.env.NODE_ENV': '"test"' }, tsconfig: path.resolve('tsconfig.json'),
        plugins: [{
            name: 'synthetic-settings-boundary',
            setup(bundle) {
                bundle.onResolve({ filter: /^(?:@\/lib\/db|\.\/db)$/ }, () => ({ path: 'settings', namespace: 'fixture' }));
                bundle.onResolve({ filter: /chatgpt-account-panel$/ }, () => ({ path: 'account', namespace: 'fixture' }));
                bundle.onResolve({ filter: /^@\/lib\/ai-service$/ }, () => ({ path: 'ai-service', namespace: 'fixture' }));
                bundle.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({
                    contents: name === 'account' ? 'export function ChatGptAccountPanel() { return null; }'
                        : name === 'ai-service' ? `export const AIService = { fromLocalTaskConfig() { return {
                            getHealth: async () => ({ status: 'ok', models: ['synthetic-local'] }) }; } };`
                            : `export const db = { settings: {
                                async get(key) { const response = await fetch('/fixture/settings/' + key); return response.json(); },
                                async put(setting) { const response = await fetch('/fixture/settings/' + setting.key, {
                                    method: 'PUT', body: JSON.stringify(setting) });
                                    if (!response.ok) throw new Error('Synthetic save failure');
                                    return setting.key;
                                }
                            } };`,
                }));
            },
        }],
    });
    const bundle = result.outputFiles.find(file => file.path.endsWith('.js'))!.text;
    const settings = new Map(Object.entries({ aiModelDefaultVersion: 'qwen35-default-v1' }));
    let failSave = false; let reads = 0; let posts = 0; let pulls = 0;
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
        const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', async route => {
            const request = route.request(); const url = new URL(request.url());
            if (url.origin !== 'http://127.0.0.1:4396') { await route.abort(); return; }
            if (url.pathname === '/') {
                await route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script src="/bundle.js"></script>' }); return;
            }
            if (url.pathname === '/bundle.js') { await route.fulfill({ contentType: 'text/javascript', body: bundle }); return; }
            if (url.pathname.startsWith('/fixture/settings/')) {
                const key = url.pathname.split('/').pop()!;
                if (request.method() === 'PUT') {
                    if (failSave) { await route.fulfill({ status: 500, json: {} }); return; }
                    settings.set(key, request.postDataJSON().value);
                }
                await route.fulfill({ json: settings.has(key) ? { key, value: settings.get(key) } : null }); return;
            }
            if (url.pathname === '/api/ai/models') {
                await route.fulfill({ json: { models: [{ name: 'synthetic-local' }] } }); return;
            }
            if (url.pathname === '/api/ai/pull') { pulls++; await route.fulfill({ status: 403, json: {} }); return; }
            if (url.pathname === '/api/ai/local-provider/onboarding') {
                if (request.method() === 'POST') posts++; else reads++;
                const configured = settings.has('aiProvider');
                await route.fulfill({ json: { provider: 'ollama', credentialClass: 'local_model',
                    model: configured ? settings.get('aiModel_clinical') : null,
                    state: configured ? 'missing' : 'configuration_missing', revision: (configured ? 'b' : 'a').repeat(64),
                    version: 0, receipt: null, canActivate: configured, inference: 'not_run', qualification: 'not_assessed' } }); return;
            }
            await route.fulfill({ status: 404, json: {} });
        });
        await page.goto('http://127.0.0.1:4396');
        const panel = page.locator('#local-provider-admission');
        await expect(panel.getByRole('status')).toContainText('Scegli un modello Ollama');
        await expect(page.getByRole('button', { name: 'Salva configurazione', exact: true })).toBeEnabled();
        const selector = page.getByTestId('ai-model-selector-clinical');
        await expect(selector.getByRole('status')).toHaveText('1 modello presente in Ollama.');
        await selector.getByRole('combobox').selectOption('synthetic-local');
        await page.getByTestId('ai-model-selector-reasoning').getByRole('combobox').selectOption('synthetic-local');
        await page.getByRole('button', { name: 'Verifica connessione', exact: true }).click();
        await expect(page.getByText('Ollama è raggiungibile: 1 modello presente.', { exact: false })).toBeVisible();
        await selector.getByText('Altri modelli e installazione', { exact: true }).click();
        await expect(selector.getByText('ollama pull qwen3.5:35b-a3b', { exact: true })).toBeVisible();
        await expect(selector.getByRole('button', { name: /^Scarica/ })).toHaveCount(0);
        const before = reads;
        await page.getByRole('button', { name: 'Salva configurazione', exact: true }).click();
        await expect(panel.getByText('Modello salvato:', { exact: false })).toContainText('synthetic-local');
        await expect(panel.getByRole('button', { name: 'Verifica e attiva locale', exact: true })).toBeEnabled();
        assert.equal(reads, before + 1); assert.equal(posts, 0); assert.equal(pulls, 0);
        failSave = true;
        await page.getByRole('button', { name: 'Salva configurazione', exact: true }).click();
        await expect(page.getByText('Salvataggio non riuscito', { exact: true })).toBeVisible();
        assert.equal(reads, before + 1); assert.equal(posts, 0); assert.equal(pulls, 0);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
