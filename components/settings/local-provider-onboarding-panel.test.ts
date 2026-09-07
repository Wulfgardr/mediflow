/* @Codex */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { buildSync } from 'esbuild';
import { chromium, expect } from '@playwright/test';

// Mount the real component with React DOM in a browser and synthetic HTTP fixtures.
// No Next server, user session, Ollama, inference or external request is involved.
test('mounted panel: inert initial read, single explicit click, refresh, recoverable failure and terminal revocation', async () => {
    const bundle = buildSync({ stdin: { contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
        import { LocalProviderOnboardingPanel } from './components/settings/local-provider-onboarding-panel';
        createRoot(document.getElementById('root')).render(<LocalProviderOnboardingPanel />);`,
        resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, outfile: 'onboarding-mount.js', format: 'iife', platform: 'browser',
        define: { 'process.env.NODE_ENV': '"test"' }, tsconfig: path.resolve('tsconfig.json') }).outputFiles[0].text;
    let status = { provider: 'ollama', credentialClass: 'local_model', model: 'synthetic-local', state: 'missing', revision: 'a'.repeat(64),
        version: 0, receipt: null as string | null, canActivate: true, inference: 'not_run', qualification: 'not_assessed' };
    let posts = 0; let functions = 0; let fail = false;
    const server = createServer(async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle); return; }
        if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<div id="root"></div><script src="/bundle.js"></script>'); return; }
        if (req.url === '/api/system/function-status') { functions++; res.end(JSON.stringify({ functions: [{ id: 'patient_insight', provider: 'Ollama', state: 'unverified', reason: 'Prerequisiti presenti. Esecuzione non ancora osservata.' }] })); return; }
        if (req.url === '/api/ai/local-provider/onboarding') {
            if (req.method === 'POST') {
                posts++; let body = ''; for await (const chunk of req) body += chunk;
                assert.deepEqual(JSON.parse(body), { intent: 'verify_and_activate', expectedRevision: status.revision });
                // Keep the request pending long enough to verify the button cannot double-submit.
                await new Promise(resolve => setTimeout(resolve, 100));
                if (fail) { res.statusCode = 503; res.end(JSON.stringify({ error: 'provider_unreachable' })); return; }
                status = { ...status, state: 'available_unqualified', version: status.version + 1, receipt: 'receipt_' + 'a'.repeat(32) };
            }
            res.end(JSON.stringify(status)); return;
        }
        res.statusCode = 404; res.end('{}');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
        await page.goto(`http://127.0.0.1:${address.port}`);
        const activate = page.getByRole('button', { name: 'Verifica e attiva locale', exact: true });
        await expect(activate).toBeEnabled(); assert.equal(posts, 0);
        await expect(page.getByRole('status')).toContainText('da attivare');
        await activate.click();
        await expect(page.getByRole('button', { name: 'Verifica in corso…', exact: true })).toBeDisabled();
        await expect(page.getByRole('status')).toContainText('caricamento');
        await expect(page.getByText('Stato delle funzioni riletto.', { exact: false })).toBeVisible();
        assert.equal(posts, 1); assert.equal(functions, 1);
        await expect(page.getByText('Quadro paziente: Da provare', { exact: true })).toBeVisible();
        await expect(page.getByText('Ricevuta di attivazione · versione 1')).toBeVisible();
        status = { ...status, state: 'degraded' }; fail = true;
        await page.getByRole('button', { name: 'Aggiorna stato' }).click();
        await page.getByRole('button', { name: 'Verifica e recupera locale' }).click();
        await expect(page.getByRole('status')).toContainText('Apri Ollama');
        await expect(page.getByRole('button', { name: 'Verifica e recupera locale' })).toBeEnabled(); assert.equal(posts, 2);
        fail = false; status = { ...status, state: 'revoked', canActivate: false };
        await page.getByRole('button', { name: 'Aggiorna stato' }).click();
        await expect(page.getByRole('status')).toContainText('non può riattivarlo');
        await expect(activate).toBeDisabled(); assert.equal(posts, 2);
    } finally { await browser.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
