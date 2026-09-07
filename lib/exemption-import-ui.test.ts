/* @Codex */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';
import { EXEMPTION_COLUMNS } from './exemption-import-contract';
import { syntheticExemptionSession } from '../scripts/fixtures/exemption-import-session';
import { retireForUser } from './security/web-auth-lifecycle-owner-adapter';

// Component + actual route/writer integration without a listener or user server.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-exemptions-ui-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = directory;
const { dbServer } = await import('./db-server.ts');
const previewRoute = await import('../app/api/exemptions/import/preview/route.ts');
const commitRoute = await import('../app/api/exemptions/import/commit/route.ts');
const statusRoute = await import('../app/api/exemptions/import/status/route.ts');
const requireCurrent = createRequire(import.meta.url);
const auth = requireCurrent('./security/server-auth') as { requireSession: () => Promise<unknown> };
const original = auth.requireSession;
const session = syntheticExemptionSession();
auth.requireSession = async () => session;
after(() => { retireForUser(session); auth.requireSession = original; dbServer.$client.close(); fs.rmSync(directory, { recursive: true, force: true }); });

const inventedFile = (codes: string[]) => ({ name: 'inventato-ui.txt', mimeType: 'text/plain', buffer: Buffer.from([
    EXEMPTION_COLUMNS.join('|'), ...codes.map((code) => [code, 'Descrizione interamente inventata', '\\N', '\\N', '\\N', 'S', 'N', '\\N'].join('|')),
].join('\r\n') + '\r\n') });

test('UI selects, previews without writing, confirms, rereads, reports invalid rows/conflicts and retries a lost response', async () => {
    const bundle = await build({
        stdin: { contents: "import React from 'react'; import { createRoot } from 'react-dom/client'; import Manager from './components/settings/exemption-db-manager'; createRoot(document.getElementById('root')).render(React.createElement(Manager));", resolveDir: process.cwd(), loader: 'tsx' },
        bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' },
    });
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        let commits = 0, loseNextResponse = false;
        await page.route('**/*', async (route) => {
            const req = route.request(), url = new URL(req.url());
            if (url.origin !== 'http://127.0.0.1:48969') { await route.abort(); return; }
            if (url.pathname === '/') {
                await route.fulfill({ contentType: 'text/html', body: '<html lang="it"><body><div id="root"></div><script src="/bundle.js"></script></body></html>' }); return;
            }
            if (url.pathname === '/bundle.js') {
                await route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }); return;
            }
            const request = new Request(req.url(), { method: req.method(), headers: req.headers(), body: req.method() === 'POST' ? req.postData() : undefined });
            let response: Response;
            if (url.pathname === '/api/exemptions/import/status') response = await statusRoute.GET();
            else if (url.pathname === '/api/exemptions/import/preview') response = await previewRoute.POST(request);
            else if (url.pathname === '/api/exemptions/import/commit') { commits++; response = await commitRoute.POST(request); }
            else { await route.abort(); return; }
            if (url.pathname.endsWith('/commit') && loseNextResponse) { loseNextResponse = false; await route.abort('failed'); return; }
            await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
        });
        await page.goto('http://127.0.0.1:48969');
        await expect(page.getByText('0 codici nel repertorio', { exact: true })).toBeVisible();
        const upload = page.getByLabel('File esenzioni (.txt o .csv delimitato da |)', { exact: true });
        await upload.setInputFiles(inventedFile(['ZZ_UI_1']));
        await expect(page.getByText('Anteprima pronta', { exact: true })).toBeVisible();
        assert.equal(commits, 0);
        assert.equal((dbServer.$client.prepare('SELECT count(*) n FROM exemptions').get() as { n: number }).n, 0);
        const confirm = page.getByRole('button', { name: 'Conferma importazione', exact: true });
        await expect(confirm).toBeDisabled();
        await page.getByRole('checkbox').check();
        await confirm.click();
        await expect(page.getByText('Import registrato e stato del repertorio riletto.', { exact: true })).toBeVisible();
        await expect(page.getByLabel('Ricevuta import')).toContainText('Rilettura confermata.');
        assert.equal(commits, 1);
        await upload.setInputFiles(inventedFile(['ZZ_DUP', 'ZZ_DUP']));
        await expect(page.getByText('Import bloccato', { exact: true })).toBeVisible();
        await expect(confirm).toHaveCount(0);
        assert.equal(commits, 1);
        await upload.setInputFiles(inventedFile(['ZZ_CONFLICT']));
        await expect(page.getByText('Anteprima pronta', { exact: true })).toBeVisible();
        dbServer.$client.prepare('UPDATE exemptions SET description = ? WHERE code = ?').run('Manuale inventata concorrente', 'ZZ_UI_1');
        await page.getByRole('checkbox').check(); await confirm.click();
        await expect(page.getByRole('status')).toContainText('Il repertorio è cambiato');
        assert.equal(dbServer.$client.prepare('SELECT 1 FROM exemptions WHERE code = ?').get('ZZ_CONFLICT'), undefined);
        await expect(confirm).toHaveCount(0);
        await page.getByRole('button', { name: 'Genera nuova anteprima', exact: true }).click();
        await expect(page.getByText('Anteprima pronta', { exact: true })).toBeVisible();
        await page.getByRole('checkbox').check(); await confirm.click();
        await expect(page.getByLabel('Ricevuta import')).toContainText('Rilettura confermata.');
        await upload.setInputFiles(inventedFile(['ZZ_RETRY']));
        await expect(page.getByText('Anteprima pronta', { exact: true })).toBeVisible();
        await page.getByRole('checkbox').check();
        loseNextResponse = true; await confirm.click();
        await expect(page.getByRole('status')).toContainText('Connessione interrotta');
        const receiptsBeforeRetry = (dbServer.$client.prepare('SELECT count(*) n FROM exemption_import_receipts').get() as { n: number }).n;
        await confirm.click();
        await expect(page.getByLabel('Ricevuta import')).toContainText('Rilettura confermata.');
        assert.equal((dbServer.$client.prepare('SELECT count(*) n FROM exemption_import_receipts').get() as { n: number }).n, receiptsBeforeRetry);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
