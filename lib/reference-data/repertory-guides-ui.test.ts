/* @Codex: real React components, ConfirmProvider and client functions in an isolated Chromium fixture.
 * Local HTTP responses below are INVENTED UI fixtures, not the real backend, authentication or a live AIFA feed.
 * Host commands are displayed/copied only. No WHO installation or provider call takes place.
 * Run with the repository's Node24 loader and locked esbuild/Playwright/React dependencies.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, expect, type Page, type Route } from '@playwright/test';
import { build } from 'esbuild';
import type { AifaCatalogClientStatus, AifaImportClientResult } from '../aifa-importer';

const ORIGIN = 'http://127.0.0.1:48974';
const status = (version = 'synthetic-old', count = 3): AifaImportClientResult => ({
    state: 'ready', count, rejectedRecords: 0, totalRecords: count,
    manifest: { format: 'mediflow.aifa-catalog-manifest.v1', source: 'Agenzia Italiana del Farmaco (AIFA)',
        sourceUrl: 'https://example.invalid/invented.csv', downloadedAt: '2026-09-01', version,
        reuseTermsUrl: 'https://www.aifa.gov.it/copyright', reuseStatus: 'source-artifact-review-required',
        sha256: (version === 'synthetic-old' ? 'a' : 'b').repeat(64), fileName: 'synthetic.csv', rowCount: count,
        importedAt: '2026-09-01T12:00:00.000Z' },
});
const csv = { name: 'synthetic.csv', mimeType: 'text/csv', buffer: Buffer.from('CODICE_AIC;DENOMINAZIONE\n000000701;CONFEZIONE INVENTATA') };

async function fixture(entry: string, width: number, api: (route: Route) => Promise<void>) {
    assert.ok(process.env.MEDIFLOW_DATA_DIR?.trim(), 'dedicated synthetic directory required');
    const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' },
        bundle: true, write: false, outfile: 'fixture/bundle.js', platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } });
    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext({ viewport: { width, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
        const page = await context.newPage(); const errors: string[] = []; const external: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.origin !== ORIGIN) { external.push(url.origin); await route.abort(); return; }
            if (url.pathname === '/') {
                // Fixture shell, not the application's Tailwind/Next layout or a visual-parity claim.
                await route.fulfill({ contentType: 'text/html', body: '<html lang="it"><head><title>Repertory guide fixture</title><link rel="stylesheet" href="/bundle.css"><style>.hidden{display:none}button,input{font:inherit}body{margin:16px;font-family:sans-serif}code{overflow-wrap:anywhere}.mf-modal-backdrop{position:fixed;inset:0;background:white;overflow:auto;z-index:100}.absolute.inset-0{display:none}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>' }); return;
            }
            if (url.pathname === '/bundle.js') { await route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text }); return; }
            if (url.pathname === '/bundle.css') { await route.fulfill({ contentType: 'text/css', body: bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '' }); return; }
            await api(route);
        });
        await page.goto(ORIGIN);
        assert.equal(await page.title(), 'Repertory guide fixture'); assert.equal(new URL(page.url()).origin, ORIGIN);
        return { page, errors, external, close: () => browser.close() };
    } catch (error) { await browser.close(); throw error; }
}
const aifaEntry = `import React from 'react'; import {createRoot} from 'react-dom/client';
import Aifa from './components/settings/aifa-catalog-manager'; import {ConfirmProvider} from './components/ui/confirm-dialog';
const root = createRoot(document.getElementById('root')); root.render(<ConfirmProvider><Aifa /></ConfirmProvider>);
window.unmountFixture = () => root.unmount();`;
const isRead = (route: Route) => new URL(route.request().url()).pathname === '/api/drugs' && route.request().method() === 'GET';
async function viewCatalog(page: Page, version: string) {
    await expect(page.getByTestId('aifa-catalog-guide')).toContainText(version);
}

test('AIFA UI: no write on mount, abort, explicit read recovery, successful update and no blind repeat after failed readback', { timeout: 30_000 }, async () => {
    let catalog: AifaCatalogClientStatus = status(); let updates = 0; let reads = 0; let mode: 'hold' | 'success' = 'hold';
    let readFailure = false; let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const f = await fixture(aifaEntry, 390, async route => {
        if (isRead(route)) { reads++; await route.fulfill({ status: readFailure ? 503 : 200, json: readFailure ? { error: 'synthetic read failure' } : catalog }); return; }
        assert.equal(new URL(route.request().url()).pathname, '/api/drugs/update');
        assert.equal(route.request().method(), 'POST'); assert.equal(route.request().postData(), null); updates++;
        if (mode === 'hold') { await hold; try { await route.abort('aborted'); } catch { /* Browser request already cancelled. */ } return; }
        catalog = status('synthetic-new', 4); await route.fulfill({ json: catalog });
    });
    try {
        const p = f.page; const update = p.getByRole('button', { name: 'Aggiorna da AIFA', exact: true });
        await viewCatalog(p, 'synthetic-old'); assert.equal(updates, 0); assert.equal(reads, 1);
        await update.click(); await expect.poll(() => updates).toBe(1);
        await expect(update).toBeDisabled(); await viewCatalog(p, 'synthetic-old');
        await p.getByRole('button', { name: 'Annulla', exact: true }).click();
        await expect(p.getByText(/L’esito sul server non è confermato/u)).toBeVisible(); release();
        await expect(update).toBeDisabled(); await viewCatalog(p, 'synthetic-old');
        await p.getByRole('button', { name: 'Rileggi stato', exact: true }).click();
        await expect(update).toBeEnabled(); assert.equal(updates, 1);
        mode = 'success'; await update.click();
        await expect(p.getByText(/Aggiornamento confermato: 4 confezioni/u)).toBeVisible(); await viewCatalog(p, 'synthetic-new');
        readFailure = true; await update.click();
        await expect(p.getByText(/Importazione confermata dal server; rilettura non riuscita/u)).toBeVisible();
        await expect(update).toBeDisabled(); assert.equal(updates, 3);
        readFailure = false; await p.getByRole('button', { name: 'Rileggi stato', exact: true }).click();
        await expect(update).toBeEnabled(); assert.equal(updates, 3);
        assert.deepEqual(f.errors, []); assert.deepEqual(f.external, []);
    } finally { release(); await f.close(); }
});

test('AIFA UI: manual CSV reselect after declined confirmation; failed clear preserves the observation', { timeout: 30_000 }, async () => {
    let imports = 0; let deletes = 0;
    const f = await fixture(aifaEntry, 1280, async route => {
        if (isRead(route)) { await route.fulfill({ json: status() }); return; }
        if (route.request().method() === 'DELETE') { deletes++; await route.fulfill({ status: 503, json: { error: 'synthetic clear failure' } }); return; }
        imports++; await route.fulfill({ status: 500, json: { error: 'unexpected write' } });
    });
    try {
        const p = f.page; await viewCatalog(p, 'synthetic-old');
        await p.getByText('Carica un CSV già scaricato', { exact: true }).click();
        await p.getByLabel('Versione dataset (caricamento manuale)', { exact: true }).fill('synthetic-manual');
        await p.getByLabel('Data di scarico', { exact: true }).fill('2026-09-01');
        const upload = p.getByLabel('Carica file CSV AIFA', { exact: true });
        for (let attempt = 0; attempt < 2; attempt++) {
            await upload.setInputFiles(csv);
            const dialog = p.getByRole('dialog', { name: 'Importare il file AIFA?', exact: true });
            await expect(dialog).toBeVisible(); await expect(p.getByRole('button', { name: 'Aggiorna da AIFA', exact: true })).toBeDisabled();
            await dialog.getByRole('button', { name: 'Annulla', exact: true }).click();
            await expect(dialog).toHaveCount(0); await expect(p.getByRole('button', { name: 'Aggiorna da AIFA', exact: true })).toBeEnabled();
        }
        assert.equal(imports, 0);
        await p.getByRole('button', { name: 'Svuota catalogo', exact: true }).click();
        let dialog = p.getByRole('dialog', { name: 'Svuotare il database farmaci?', exact: true });
        await dialog.getByRole('button', { name: 'Annulla', exact: true }).click(); assert.equal(deletes, 0);
        await p.getByRole('button', { name: 'Svuota catalogo', exact: true }).click();
        dialog = p.getByRole('dialog', { name: 'Svuotare il database farmaci?', exact: true });
        await dialog.getByRole('button', { name: 'Svuota', exact: true }).click();
        await expect(p.getByText(/Svuotamento catalogo AIFA non riuscito/u)).toBeVisible();
        await viewCatalog(p, 'synthetic-old'); assert.equal(deletes, 1); assert.equal(imports, 0);
        await expect(p.getByRole('button', { name: 'Svuota catalogo', exact: true })).toBeDisabled();
        assert.deepEqual(f.errors, []); assert.deepEqual(f.external, []);
    } finally { await f.close(); }
});

test('WHO UI: consent is fresh and required for install instructions, navigation performs no requests, cancel resets and restores focus', { timeout: 30_000 }, async () => {
    let calls = 0;
    const f = await fixture(`import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
import {WhoLocalSetupGuide} from './components/settings/who-local-setup-guide';
function Fixture(){const [reads,setReads]=useState(0);return <><output aria-label="Fixture WHO reads">{reads}</output><WhoLocalSetupGuide status="configured" onRefresh={()=>setReads(x=>x+1)}/></>}
createRoot(document.getElementById('root')).render(<Fixture/>);`, 390, async route => { calls++; await route.abort(); });
    try {
        const p = f.page; const guide = p.getByTestId('who-local-setup-guide'); const summary = guide.locator('summary');
        await summary.click(); await expect(guide).toContainText('Questa pagina guida i passaggi');
        const install = guide.getByRole('button', { name: '3. Installa e avvia', exact: true });
        await expect(install).toBeDisabled(); await guide.getByRole('button', { name: '2. Licenza', exact: true }).click();
        const consent = guide.getByRole('checkbox'); await expect(consent).not.toBeChecked();
        await expect(guide.getByRole('button', { name: 'Avanti', exact: true })).toBeDisabled();
        await consent.check(); await install.click(); await expect(guide.getByText('./Setup_WHO.command', { exact: true })).toBeVisible();
        await guide.getByRole('button', { name: 'Copia ./Setup_WHO.command', exact: true }).click();
        await expect(guide.getByText('Comando copiato. Non è stato eseguito.', { exact: true })).toBeVisible();
        assert.equal(await p.evaluate(() => navigator.clipboard.readText()), './Setup_WHO.command');
        await guide.getByRole('button', { name: '4. Verifica', exact: true }).click();
        await expect(guide).toContainText('non conferma una risposta del servizio');
        await guide.getByRole('button', { name: 'Rileggi stato WHO', exact: true }).click();
        await expect(p.getByLabel('Fixture WHO reads')).toHaveText('1');
        await guide.getByRole('button', { name: 'Annulla guida', exact: true }).click();
        await expect(summary).toBeFocused(); await expect(guide).not.toHaveAttribute('open', '');
        await summary.click(); await expect(install).toBeDisabled();
        await guide.getByRole('button', { name: '2. Licenza', exact: true }).click(); await expect(consent).not.toBeChecked();
        assert.equal(calls, 0); assert.deepEqual(f.external, []); assert.deepEqual(f.errors, []);
        for (const button of await guide.getByRole('button').all()) { const box = await button.boundingBox(); if (box) assert.ok(box.height >= 44); }
    } finally { await f.close(); }
});
