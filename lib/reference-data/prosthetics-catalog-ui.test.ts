/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test, { after } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';
import { syntheticExemptionSession } from '../../scripts/fixtures/exemption-import-session';
import { retireForUser } from '../security/web-auth-lifecycle-owner-adapter';
import { PROSTHETICS_COLUMNS } from './prosthetics-catalog-contract';
assert.ok(process.env.MEDIFLOW_DATA_DIR, 'synthetic directory must precede runtime imports');
const directory = fs.mkdtempSync(path.join(process.env.MEDIFLOW_DATA_DIR!, 'prosthetics-ui-'));
process.env.MEDIFLOW_DATA_DIR = directory;
const { dbServer } = await import('../db-server.ts');
const { prostheticsCatalogRequest } = await import('./prosthetics-catalog-http.ts');
const requireCurrent = createRequire(import.meta.url);
const auth = requireCurrent('../security/server-auth') as { requireSession: () => Promise<unknown> };
const original = auth.requireSession, session = syntheticExemptionSession();
auth.requireSession = async () => session;
const db = dbServer.$client;
after(() => { auth.requireSession = original; retireForUser(session); db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
const file = (codes: string[]) => ({ name: 'inventato-ui.csv', mimeType: 'text/csv', buffer: Buffer.from([
    PROSTHETICS_COLUMNS.join(','), ...codes.map(code => `Codifica inventata,${code},Descrizione ausilio inventata,v-test,Fonte inventata,Dimostrazione,,`),
].join('\r\n') + '\r\n') });

test('real component and routes: preview, acceptance, invalid rows, CAS, lost response replay, reload and description-only copy', async () => {
    // No listener, Next build, provider, patient fixtures or existing app instance.
    const bundle = await build({ stdin: {
        contents: "import React from 'react'; import {createRoot} from 'react-dom/client'; import Manager from './components/prosthetics-catalog-manager'; createRoot(document.getElementById('root')).render(React.createElement(Manager));",
        resolveDir: process.cwd(), loader: 'tsx',
    }, bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } });
    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
        const page = await context.newPage(), errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        let commits = 0, loseResponse = false;
        await page.route('**/*', async route => {
            const req = route.request(), url = new URL(req.url());
            if (url.origin !== 'http://127.0.0.1:48973') { await route.abort(); return; }
            if (url.pathname === '/') { await route.fulfill({ contentType: 'text/html', body: '<html lang="it"><body><div id="root"></div><script src="/bundle.js"></script></body></html>' }); return; }
            if (url.pathname === '/bundle.js') { await route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }); return; }
            const action = url.pathname.split('/').at(-1);
            if (!['preview', 'commit', 'status', 'search', 'template'].includes(action!)) { await route.abort(); return; }
            const request = new Request(req.url(), { method: req.method(), headers: req.headers(), body: req.method() === 'POST' ? req.postData() : undefined });
            const response = await prostheticsCatalogRequest(action as 'preview', request);
            if (action === 'commit') { commits++; if (loseResponse) { loseResponse = false; await route.abort('failed'); return; } }
            await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
        });
        await page.goto('http://127.0.0.1:48973');
        await expect(page.getByText('0 voci nel repertorio protesica', { exact: true })).toBeVisible();
        const upload = page.getByLabel('File repertorio protesica (.csv)', { exact: true });
        await upload.setInputFiles(file(['DEMO-A']));
        await expect(page.getByText('Anteprima pronta', { exact: true })).toBeVisible();
        assert.equal(commits, 0); assert.equal((db.prepare('SELECT count(*) n FROM prosthetics_catalog_entries').get() as { n: number }).n, 0);
        const confirm = page.getByRole('button', { name: 'Conferma importazione protesica', exact: true });
        await expect(confirm).toBeDisabled(); await page.getByRole('checkbox').check(); await confirm.click();
        await expect(page.getByText('Import registrato e stato del repertorio riletto.', { exact: true })).toBeVisible();
        await expect(page.getByText('1 voce nel repertorio protesica', { exact: true })).toBeVisible();
        assert.equal(commits, 1);
        await upload.setInputFiles(file(['DUP', 'DUP']));
        await expect(page.getByText('Import bloccato', { exact: true })).toBeVisible(); await expect(confirm).toHaveCount(0);
        await expect(page.getByLabel('Anteprima protesica')).toContainText('Duplicati: 2');
        await upload.setInputFiles(file(['DEMO-CAS']));
        await expect(page.getByText('Anteprima pronta', { exact: true })).toBeVisible();
        // Simulate a competing catalog edit only, never a clinical table.
        db.prepare('UPDATE prosthetics_catalog_entries SET description = ? WHERE code = ?').run('Modifica concorrente inventata', 'DEMO-A');
        await page.getByRole('checkbox').check(); await confirm.click();
        await expect(page.getByText('Il repertorio è cambiato: genera una nuova anteprima.', { exact: true })).toBeVisible();
        await expect(confirm).toHaveCount(0);
        await page.getByRole('button', { name: 'Genera nuova anteprima', exact: true }).click();
        await expect(page.getByText('Anteprima pronta', { exact: true })).toBeVisible();
        await page.getByRole('checkbox').check(); loseResponse = true; await confirm.click();
        await expect(page.getByText(/Connessione interrotta\. Rileggi stato/u)).toBeVisible();
        const receipts = (db.prepare('SELECT count(*) n FROM prosthetics_catalog_receipts').get() as { n: number }).n;
        await confirm.click();
        await expect(page.getByText('Import registrato e stato del repertorio riletto.', { exact: true })).toBeVisible();
        assert.equal((db.prepare('SELECT count(*) n FROM prosthetics_catalog_receipts').get() as { n: number }).n, receipts);
        await page.reload(); await expect(page.getByText('2 voci nel repertorio protesica', { exact: true })).toBeVisible();
        await expect(page.getByLabel('Ricevuta protesica')).toContainText('Fonte inventata');
        await page.getByLabel('Codice, descrizione o codifica', { exact: true }).fill('DEMO-CAS');
        await page.getByRole('button', { name: 'Cerca nel repertorio', exact: true }).click();
        const lookup = page.getByLabel('Consulta repertorio protesica');
        await expect(lookup).toContainText('Codifica: Codifica inventata · Codice: DEMO-CAS');
        await lookup.getByRole('button', { name: 'Copia solo descrizione', exact: true }).click();
        await expect(lookup).toContainText('Sola descrizione copiata.');
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Descrizione ausilio inventata');
        for (const button of await page.getByRole('button').all()) {
            const box = await button.boundingBox(); if (box) assert.ok(box.height >= 44);
        }
        assert.equal(await page.getByLabel('Import repertorio protesica', { exact: true }).evaluate(el => getComputedStyle(el).borderRadius), '12px');
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
