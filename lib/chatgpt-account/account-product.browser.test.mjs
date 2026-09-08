/* @Codex: isolated Next/React fixture mounting the REAL account card.
 * Run: MEDIFLOW_DATA_DIR=/absolute/empty/synthetic-dir node --test --test-concurrency=1 lib/chatgpt-account/account-product.browser.test.mjs
 * Requires the repository's locked Next/React/Playwright dependencies and a locally installed Playwright Chromium.
 * Account HTTP is synthetic; no production auth route, DB, provider, login or inference is contacted.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, symlink, rm, copyFile, access } from 'node:fs/promises';
import { isAbsolute, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
const root = fileURLToPath(new URL('../../', import.meta.url));
const requireFromRoot = createRequire(join(root, 'package.json'));
const dataDir = process.env.MEDIFLOW_DATA_DIR;
assert.ok(dataDir && isAbsolute(dataDir), 'An absolute synthetic MEDIFLOW_DATA_DIR is required');
const connected = { state: 'connected', notice: null, plan: 'pro', loginExpiresAt: null,
    actions: ['logout', 'read_models', 'read_rate_limits', 'refresh_account'], inferenceEnabled: false, executionBlock: 'data_boundary_unqualified' };
const disconnected = { ...connected, state: 'disconnected', plan: null, actions: ['connect'] };
const waiting = { ...disconnected, state: 'awaiting_login', actions: ['cancel_login'], loginExpiresAt: 2_000_000_000_000 };
const verifying = { ...waiting, state: 'verifying', actions: ['cancel_login', 'complete_login'] };
const models = [{ id: 'synthetic-model', model: 'synthetic-model', isDefault: true }];
async function freePort() {
    const server = createServer(); await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    await new Promise(done => server.close(done)); return address.port;
}
async function stop(child) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise(done => {
        const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
        child.once('exit', () => { clearTimeout(timeout); done(); }); child.kill('SIGTERM');
    });
}

test('real Next/React account card: explicit controls, stale catalog, error, logout and lock', { timeout: 180_000 }, async t => {
    // Resolve dependencies before creating any server. Missing dependencies fail, never skip or substitute React.
    const { chromium, expect } = requireFromRoot('@playwright/test');
    const next = requireFromRoot.resolve('next/dist/bin/next');
    const logo = join(root, 'public/brand/openai/chatgpt-mark.png'); await access(logo);
    await mkdir(dataDir, { recursive: true }); const fixture = await mkdtemp(join(dataDir, 'account-product-ui-'));
    let child; let browser; const output = [];
    t.after(async () => {
        await browser?.close(); if (child) await stop(child);
        if (process.env.MEDIFLOW_UI_EVIDENCE_DIR) {
            await mkdir(process.env.MEDIFLOW_UI_EVIDENCE_DIR, { recursive: true });
            await writeFile(join(process.env.MEDIFLOW_UI_EVIDENCE_DIR, 'next-fixture.log'), output.join(''));
        }
        await rm(fixture, { recursive: true, force: true });
    });
    await mkdir(join(fixture, 'app'), { recursive: true }); await mkdir(join(fixture, 'home'));
    await mkdir(join(fixture, 'public/brand/openai'), { recursive: true });
    await copyFile(logo, join(fixture, 'public/brand/openai/chatgpt-mark.png'));
    await symlink(join(root, 'node_modules'), join(fixture, 'node_modules'), 'dir');
    await writeFile(join(fixture, 'package.json'), JSON.stringify({ private: true }));
    await writeFile(join(fixture, 'next.config.mjs'), `export default { experimental: { externalDir: true }, devIndicators: false, webpack(config) { config.resolve.alias['@'] = ${JSON.stringify(root)}; return config; } };\n`);
    await writeFile(join(fixture, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
        target: 'ES2017', lib: ['dom', 'dom.iterable', 'esnext'], strict: true, noEmit: true,
        esModuleInterop: true, module: 'esnext', moduleResolution: 'bundler', jsx: 'react-jsx',
        resolveJsonModule: true, skipLibCheck: true, baseUrl: root, paths: { '@/*': [resolve(root, '*')] },
    } }));
    await writeFile(join(fixture, 'app/layout.tsx'), `import type { ReactNode } from 'react';
export const metadata = { title: 'Synthetic account product fixture' };
export default function Layout({children}: {children:ReactNode}) { return <html lang="it"><body>{children}</body></html>; }`);
    await writeFile(join(fixture, 'app/page.tsx'), `'use client';
import { useState } from 'react';
import { ChatGptAccountCard } from '@/components/settings/chatgpt-account-card';
export default function Fixture() { const [active,setActive]=useState(true); return <main>
<button type="button" onClick={()=>setActive(value=>!value)}>{active?'Blocca fixture':'Sblocca fixture'}</button>
<ChatGptAccountCard active={active}/></main>; }`);
    const port = await freePort(); const base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [next, 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], {
        cwd: fixture, stdio: ['ignore', 'pipe', 'pipe'], env: {
            PATH: process.env.PATH, HOME: join(fixture, 'home'), NODE_ENV: 'development', CI: '1',
            NEXT_TELEMETRY_DISABLED: '1', MEDIFLOW_DATA_DIR: fixture,
        },
    });
    let startupError; child.once('error', error => { startupError = error; });
    child.stdout.on('data', value => output.push(value.toString())); child.stderr.on('data', value => output.push(value.toString()));
    const deadline = Date.now() + 90_000;
    for (;;) {
        if (startupError) throw startupError;
        assert.equal(child.exitCode, null, output.join(''));
        try { if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).ok) break; } catch { /* only retry fixture startup */ }
        assert.ok(Date.now() < deadline, `Fixture did not start: ${output.join('')}`);
        await new Promise(done => setTimeout(done, 250));
    }
    browser = await chromium.launch({ headless: true });
    async function scenario(name, run, initial = connected, viewport = { width: 1280, height: 900 }) {
        const context = await browser.newContext({ viewport }); const page = await context.newPage();
        const errors = []; const calls = []; let status = initial; let modelError = false; let remoteLogoutConfirmed = true;
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error' && !message.text().includes('503 (Service Unavailable)')) errors.push(message.text()); });
        await page.route('**/*', async route => {
            const request = route.request(); const url = new URL(request.url());
            if (url.origin !== base) { errors.push(`Unexpected external request: ${url.origin}`); await route.abort(); return; }
            if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
            assert.ok(url.pathname.startsWith('/api/settings/ai/chatgpt/'), 'No preferences, clinical or execution request is permitted');
            const operation = url.pathname.slice('/api/settings/ai/chatgpt/'.length); calls.push(operation);
            assert.equal(request.method(), operation === 'status' ? 'GET' : 'POST');
            assert.equal(request.postData(), operation === 'status' ? null : '{}');
            let payload = status; let statusCode = 200;
            if (operation === 'models') { payload = { status, models }; if (modelError) { statusCode = 503; payload = { error: 'protocol_error' }; } }
            else if (operation === 'rate-limits') payload = { status, primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: null }, secondary: null };
            else if (operation === 'logout') { status = { ...disconnected, notice: remoteLogoutConfirmed ? null : 'logout_unconfirmed' }; payload = status; }
            else if (operation === 'login/start') { status = waiting; payload = { status, authUrl: 'https://auth.openai.com/oauth/authorize?state=synthetic-fixture' }; }
            else if (operation === 'login/complete') { status = connected; payload = status; }
            else if (operation === 'login/cancel') { status = disconnected; payload = status; }
            await route.fulfill({ status: statusCode, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(payload) });
        });
        try {
            if (name === 'stale-catalog') await page.clock.install();
            await page.goto(base); await expect(page).toHaveTitle('Synthetic account product fixture');
            await expect(page.getByTestId('chatgpt-account-panel')).toBeVisible();
            await expect(page.getByTestId('chatgpt-execution-state')).toHaveText('Uso nelle funzioni sospeso');
            await run({ page, calls, setStatus: value => { status = value; }, failModels: value => { modelError = value; }, unconfirmLogout: () => { remoteLogoutConfirmed = false; } });
            await expect(page.getByTestId('chatgpt-execution-state')).toHaveText('Uso nelle funzioni sospeso');
            await expect(page.locator('nextjs-dialog')).toHaveCount(0); assert.deepEqual(errors, []);
            if (process.env.MEDIFLOW_UI_EVIDENCE_DIR) {
                await mkdir(process.env.MEDIFLOW_UI_EVIDENCE_DIR, { recursive: true });
                await page.screenshot({ path: join(process.env.MEDIFLOW_UI_EVIDENCE_DIR, `${name}.png`), fullPage: true });
            }
        } finally { await context.close(); }
    }
    await t.test('catalog is read-only, quota unavailable is not zero, logout erases both', () => scenario('catalog-logout', async ({page, calls}) => {
        await expect(page.getByTestId('chatgpt-account-state')).toHaveText('Account collegato'); assert.ok(calls.length > 0 && calls.every(operation => operation === 'status')); // Strict Mode may mount twice.
        await page.getByText('Modelli e utilizzo dell’account', { exact: true }).click();
        await page.getByRole('button', {name:'Mostra modelli'}).click();
        await expect(page.getByTestId('chatgpt-catalog')).toContainText('synthetic-model'); await expect(page.locator('select')).toHaveCount(0);
        await page.getByRole('button', {name:'Controlla utilizzo'}).click(); await expect(page.getByTestId('chatgpt-limits')).toContainText('25%');
        await expect(page.getByTestId('chatgpt-limits')).toContainText('dato non disponibile');
        await page.getByRole('button', {name:'Scollega ChatGPT'}).click();
        await expect(page.getByTestId('chatgpt-account-state')).toHaveText('Non collegato'); await expect(page.getByTestId('chatgpt-catalog')).toHaveCount(0);
    }));
    await t.test('catalog expiry is not extended by local status polling', () => scenario('stale-catalog', async ({page, calls}) => {
        await page.getByText('Modelli e utilizzo dell’account', {exact:true}).click();
        await page.getByRole('button', {name:'Mostra modelli'}).click(); await expect(page.getByTestId('chatgpt-catalog')).toContainText('synthetic-model');
        await page.clock.runFor(60_001); await expect(page.getByTestId('chatgpt-catalog')).toContainText('Catalogo da rileggere');
        assert.equal(calls.filter(op=>op==='models').length, 1); await expect(page.getByTestId('chatgpt-catalog')).not.toContainText('synthetic-model');
    }));
    await t.test('error remains visible until manual reread and never restores old metadata', () => scenario('error-recovery', async ({page, failModels}) => {
        await page.getByText('Modelli e utilizzo dell’account', {exact:true}).click(); await page.getByRole('button', {name:'Mostra modelli'}).click();
        await expect(page.getByTestId('chatgpt-catalog')).toContainText('synthetic-model'); failModels(true);
        await page.getByRole('button', {name:'Rileggi modelli'}).click(); await expect(page.getByTestId('chatgpt-account-panel').getByRole('alert')).toBeVisible();
        await expect(page.getByTestId('chatgpt-catalog')).not.toContainText('synthetic-model');
        failModels(false); await page.getByRole('button', {name:'Rileggi stato',exact:true}).click(); await expect(page.getByTestId('chatgpt-account-panel').getByRole('alert')).toHaveCount(0);
        await expect(page.getByTestId('chatgpt-catalog')).toContainText('Catalogo da rileggere');
    }));
    await t.test('unconfirmed logout is explicit on a mobile viewport', () => scenario('mobile-unconfirmed', async ({page, unconfirmLogout}) => {
        unconfirmLogout(); await page.getByRole('button', {name:'Scollega ChatGPT'}).click();
        await expect(page.getByText('Account scollegato da MediFlow. Il servizio non ha confermato il logout remoto.')).toBeVisible();
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth), true);
    }, connected, {width:390,height:844}));
    await t.test('lock erases catalog and unlock does not automatically refetch it', () => scenario('lock-unlock', async ({page, calls}) => {
        await page.getByText('Modelli e utilizzo dell’account', {exact:true}).click(); await page.getByRole('button', {name:'Mostra modelli'}).click();
        await page.getByRole('button', {name:'Blocca fixture'}).click(); await expect(page.getByTestId('chatgpt-catalog')).toHaveCount(0);
        await page.getByRole('button', {name:'Sblocca fixture'}).click(); await expect(page.getByTestId('chatgpt-account-state')).toHaveText('Account collegato');
        await page.getByText('Modelli e utilizzo dell’account', {exact:true}).click(); await expect(page.getByTestId('chatgpt-catalog')).toContainText('Catalogo non ancora letto');
        assert.equal(calls.filter(op=>op==='models').length,1);
    }));
    await t.test('official login link is presented only after a gesture and never visited', () => scenario('synthetic-login', async ({page, calls, setStatus}) => {
        await expect(page.getByRole('link', {name:'Apri accesso ufficiale'})).toHaveCount(0);
        await page.getByRole('button', {name:'Collega ChatGPT'}).click();
        await expect(page.getByRole('link', {name:'Apri accesso ufficiale'})).toHaveAttribute('rel','noopener noreferrer');
        setStatus(verifying); await page.getByRole('button', {name:'Rileggi stato',exact:true}).click();
        await page.getByRole('button', {name:'Verifica accesso'}).click(); await expect(page.getByTestId('chatgpt-account-state')).toHaveText('Account collegato');
        assert.ok(!calls.includes('models') && !calls.includes('rate-limits'));
    }, disconnected));
});
