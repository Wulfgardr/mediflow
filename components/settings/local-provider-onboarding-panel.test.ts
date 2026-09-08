/* @Codex */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { buildSync } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { buildFunctionStatus } from '../../lib/function-status';

function syntheticFunctions() {
    return buildFunctionStatus({ platform: 'synthetic', enabled: { patient_insight: true, smart_import: false,
        document_synthesis: false, treatment_reasoning: false }, ollamaLifecycle: 'available_unqualified', athenaLifecycle: 'missing',
    clinicalBinding: { state: 'configured', model: 'synthetic-local' }, athenaArtifact: false, who: 'disabled' }, '2026-09-08T00:00:00.000Z');
}

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
        if (req.url === '/api/system/function-status') { functions++; res.end(JSON.stringify(syntheticFunctions())); return; }
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
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
        browser = await chromium.launch({ headless: true });
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
        await expect(page.getByText('Ricevuta del collegamento · versione 1')).toBeVisible();
        status = { ...status, state: 'degraded' }; fail = true;
        await page.getByRole('button', { name: 'Aggiorna stato' }).click();
        await page.getByRole('button', { name: 'Verifica e recupera locale' }).click();
        await expect(page.getByRole('status')).toContainText('Apri Ollama');
        await expect(page.getByRole('button', { name: 'Verifica e attiva locale', exact: true })).toBeDisabled();
        await page.getByRole('button', { name: 'Riprendi dalla lettura dello stato' }).click();
        await expect(page.getByRole('button', { name: 'Verifica e recupera locale' })).toBeEnabled(); assert.equal(posts, 2);
        fail = false; status = { ...status, state: 'revoked', canActivate: false };
        await page.getByRole('button', { name: 'Aggiorna stato' }).click();
        await expect(page.getByRole('status')).toContainText('non può riattivarlo');
        await expect(activate).toBeDisabled(); assert.equal(posts, 2);
    } finally { await browser?.close(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

/* @Codex: same production component, with delayed synthetic HTTP and StrictMode. */
test('mounted guide: cancel, explicit read-only resume, new confirmation, conflict, lock, revocation and unmount', async () => {
    const bundle = buildSync({ stdin: { contents: `import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
        import {LocalProviderOnboardingPanel} from './components/settings/local-provider-onboarding-panel';
        function Fixture(){const [shown,setShown]=useState(true);return <><button onClick={()=>setShown(!shown)}>Toggle fixture</button>
            {shown && <LocalProviderOnboardingPanel/>}</>};
        createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`,
    resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, outfile: 'onboarding-guide-mount.js', format: 'iife',
    platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' }, tsconfig: path.resolve('tsconfig.json') }).outputFiles[0].text;
    let status = { provider: 'ollama', credentialClass: 'local_model', model: 'synthetic-local', state: 'missing', revision: 'a'.repeat(64),
        version: 0, receipt: null as string | null, canActivate: true, inference: 'not_run', qualification: 'not_assessed' };
    let mode: 'pending' | 'success' | 'conflict' | 'locked' = 'pending';
    const posts: unknown[] = [];
    const completions: Array<() => void> = [];
    const server = createServer(async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<title>Local onboarding synthetic fixture</title><div id="root"></div><script src="/bundle.js"></script>'); return; }
        if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle); return; }
        if (req.url === '/api/system/function-status') { res.end(JSON.stringify(syntheticFunctions())); return; }
        if (req.url !== '/api/ai/local-provider/onboarding') { res.statusCode = 404; res.end('{}'); return; }
        if (mode === 'locked') { res.statusCode = 401; res.end('{}'); return; }
        if (req.method !== 'POST') { res.end(JSON.stringify(status)); return; }
        let body = ''; for await (const chunk of req) body += chunk; posts.push(JSON.parse(body));
        if (mode === 'pending') {
            // The old handler is deliberately allowed to finish after browser abort.
            const captured = { ...status, state: 'available_unqualified', version: 99, receipt: 'receipt_' + 'd'.repeat(32) };
            completions.push(() => res.end(JSON.stringify(captured))); return;
        }
        if (mode === 'conflict') { res.statusCode = 409; res.end(JSON.stringify({ error: 'configuration_changed' })); return; }
        status = { ...status, state: 'available_unqualified', revision: 'b'.repeat(64), version: 1, receipt: 'receipt_' + 'b'.repeat(32) };
        res.end(JSON.stringify(status));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
        let interrupted = 0; page.on('requestfailed', request => {
            if (request.url().endsWith('/api/ai/local-provider/onboarding') && request.method() === 'POST') interrupted++;
        });
        await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
        await page.goto(`http://127.0.0.1:${address.port}`);
        await expect(page).toHaveTitle('Local onboarding synthetic fixture');
        const activate = page.getByRole('button', { name: 'Verifica e attiva locale', exact: true });
        await expect(activate).toBeEnabled(); assert.equal(posts.length, 0);
        await expect(page.getByRole('list', { name: 'Fasi del collegamento locale' })).toBeVisible();
        await activate.click();
        await expect(page.getByRole('button', { name: 'Verifica in corso…', exact: true })).toBeDisabled();
        await expect(page.locator('[aria-current="step"]')).toContainText('Verifica locale');
        await expect(page.getByRole('progressbar')).toHaveCount(0);
        await expect.poll(() => posts.length).toBe(1);
        await page.getByRole('button', { name: 'Annulla operazione' }).click();
        await expect(page.getByRole('status')).toContainText('non annulla un’attivazione già conclusa');
        await expect.poll(() => interrupted).toBeGreaterThan(0);
        await expect(activate).toBeDisabled();
        status = { ...status, revision: 'c'.repeat(64) };
        await page.getByRole('button', { name: 'Riprendi dalla lettura dello stato' }).click();
        await expect(activate).toBeEnabled(); assert.equal(posts.length, 1);
        completions.splice(0).forEach(complete => complete());
        mode = 'success'; await activate.click();
        await expect(page.getByText('Ricevuta del collegamento · versione 1')).toBeVisible();
        await expect(page.getByText('Stato delle funzioni riletto.', { exact: false })).toBeVisible();
        assert.deepEqual(posts[1], { intent: 'verify_and_activate', expectedRevision: 'c'.repeat(64) });
        await expect(page.getByText('Ricevuta del collegamento · versione 99')).toHaveCount(0);
        mode = 'conflict'; await activate.click();
        await expect(page.getByRole('status')).toContainText('sono cambiati');
        await expect(activate).toBeDisabled();
        await expect(page.getByText('Stato delle funzioni riletto.', { exact: false })).toHaveCount(0);
        assert.equal(posts.length, 3);
        mode = 'locked'; await page.getByRole('button', { name: 'Riprendi dalla lettura dello stato' }).click();
        await expect(page.getByRole('status')).toContainText('Accedi di nuovo'); await expect(activate).toBeDisabled();
        mode = 'success'; status = { ...status, state: 'revoked', canActivate: false };
        await page.getByRole('button', { name: 'Aggiorna stato' }).click();
        await expect(page.getByRole('status')).toContainText('non può riattivarlo'); await expect(activate).toBeDisabled();
        assert.equal(posts.length, 3);
        mode = 'pending'; status = { ...status, state: 'missing', canActivate: true };
        await page.getByRole('button', { name: 'Aggiorna stato' }).click(); await activate.click();
        await expect.poll(() => posts.length).toBe(4);
        await page.getByRole('button', { name: 'Toggle fixture' }).click();
        completions.splice(0).forEach(complete => complete());
        await page.getByRole('button', { name: 'Toggle fixture' }).click();
        await expect(activate).toBeEnabled(); assert.equal(posts.length, 4);
        assert.deepEqual(errors, []);
    } finally {
        completions.splice(0).forEach(complete => complete());
        await browser?.close(); server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});
