import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { chromium, expect } from '@playwright/test';
import { archiveBrowserPort } from './local-ui-runtime.mjs';
import { localUiArchiveLock } from './launcher-state.mjs';

const real = process.env.MEDIFLOW_PRESERVATION_REAL === '1';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, budget = 25000) {
    const deadline = Date.now() + budget;
    while (!await check()) { assert.ok(Date.now() < deadline, 'Preservation deadline'); await pause(100); }
}
const terminal = child => child.exitCode !== null || child.signalCode !== null;

test('real browser and plugin launcher: UI owns lease, encrypted draft survives final exit and restart', { skip: !real, timeout: 180000 }, async t => {
    const data = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mf-preservation-')));
    const env = { ...process.env, MEDIFLOW_DATA_DIR: data, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', PATH: [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter) };
    const seed = spawnSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], { env, encoding: 'utf8' });
    assert.equal(seed.status, 0, seed.stderr);
    const port = await archiveBrowserPort(data); env.PORT = String(port);
    const url = `http://127.0.0.1:${port}`;
    const children = [];
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ baseURL: url });
    let output = '';
    const evidence = process.env.MEDIFLOW_PRESERVATION_EVIDENCE;
    const launch = async () => {
        const child = spawn(process.execPath, ['scripts/mediflow.mjs', '--riusa', '--scelta', 'web', '--senza-browser'], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
        children.push(child);
        let current = ''; child.stdout.on('data', chunk => { current += chunk; output += chunk; }); child.stderr.on('data', chunk => { current += chunk; output += chunk; });
        await until(() => { if (terminal(child)) throw new Error(current); return current.includes('Pronto:'); }, 45000);
        return child;
    };
    t.after(async () => {
        await browser.close();
        for (const child of children) if (child.connected) child.disconnect();
        for (const child of children) if (!terminal(child)) child.kill('SIGTERM');
        await until(() => children.every(terminal));
        if (evidence) fs.writeFileSync(path.join(evidence, 'preservation-runtime.log'), output);
        const archiveConfig = path.dirname(localUiArchiveLock(data));
        fs.rmSync(archiveConfig, { recursive: true, force: true });
        fs.rmSync(data, { recursive: true, force: true });
    });
    const login = async page => {
        await page.goto('/');
        const input = page.getByLabel('PIN operatore').first();
        await input.waitFor({ timeout: 15000 });
        const renew = page.getByRole('button', { name: 'Rinnova accesso', exact: true });
        if (await renew.isVisible()) await renew.click();
        await expect(input).toBeEnabled(); await input.fill('1234');
        await page.getByRole('button', { name: 'Sblocca', exact: true }).click();
        await expect(input).toBeHidden({ timeout: 10000 });
    };
    const first = await launch();
    let page = await context.newPage();
    await login(page);
    const patient = await page.evaluate(async () => {
        const result = await fetch('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ firstName: 'Sintetico', lastName: 'Conservazione', taxCode: 'CNS757SYNTHETIC01', birthDate: '1980-01-01' }) });
        if (result.status !== 201) throw new Error(`Patient ${result.status}`);
        return result.json();
    });
    await page.goto(`/patients/${patient.id}/entries/new`);
    const editor = page.locator('[contenteditable="true"]').first();
    await editor.fill('Resoconto sintetico non registrato 757');
    await until(() => page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('mediflow:entry-draft:') && localStorage.getItem(key)?.startsWith('ENC:'))));
    // Wait for a server acknowledgement from the actual root component.
    await page.waitForResponse(response => response.url().endsWith('/api/plugin-local-ui/lease') && response.status() === 204, { timeout: 10000 });
    for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => { document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(theme); }, theme);
        if (evidence) await page.screenshot({ path: path.join(evidence, `draft-before-${theme}.png`), fullPage: true });
    }
    const headers = { Origin: url, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' };
    assert.equal((await context.request.post('/api/plugin-local-ui/lease', { headers: { ...headers, Origin: 'http://evil.example' }, data: { tab: crypto.randomUUID(), action: 'renew' } })).status(), 403);
    first.disconnect();
    await pause(17000);
    assert.equal(terminal(first), false, 'Last host exit killed a browser-held runtime');
    assert.equal((await page.request.get('/api/auth/check')).status(), 200);
    const closedAt = Date.now(); await page.close();
    await until(() => terminal(first), 18000);
    assert.ok(Date.now() - closedAt < 18000, 'UI lease did not expire');
    assert.equal(await archiveBrowserPort(data), port, 'Archive origin changed');
    const second = await launch(); page = await context.newPage(); await login(page);
    await page.goto(`/patients/${patient.id}/entries/new`);
    await expect(page.locator('[contenteditable="true"]').first()).toContainText('Resoconto sintetico non registrato 757');
    await expect(page.getByTestId('local-draft-status')).toContainText('Bozza recuperata');
    for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => { document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(theme); }, theme);
        if (evidence) await page.screenshot({ path: path.join(evidence, `draft-after-${theme}.png`), fullPage: true });
    }
    const entries = await page.request.get(`/api/entries?patientId=${patient.id}`);
    assert.equal(entries.status(), 200); assert.deepEqual(await entries.json(), []);
    // Missing pagehide: the server must also stop with a silently lost document.
    await page.route('**/api/plugin-local-ui/lease', route => route.abort());
    second.disconnect(); await page.close(); await until(() => terminal(second), 18000);
    t.diagnostic(JSON.stringify({ stablePort: port, uiSurvivedHostMs: 17000, noClinicalEntries: true, encryptedDraftRecovered: true, silentUiExpiry: true }));
});
