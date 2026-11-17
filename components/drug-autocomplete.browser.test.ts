import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, expect, type Browser } from '@playwright/test';
import { build } from 'esbuild';
import { secureLaunch } from '../e2e/fixtures/secure-browser';

let browser: Browser;
let script: string;
before(async () => {
    const bundle = await build({
        stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';
import DrugAutocomplete from './components/drug-autocomplete';
import {PrivacyProvider} from './components/privacy-provider';
import {Kree8WorkspaceShell} from './components/kree8/kree8-workspace-shell';
createRoot(document.getElementById('root')).render(<PrivacyProvider><Kree8WorkspaceShell variant="clinical" eyebrow="Scheda" title="Paziente sintetico" subtitle="" backHref="/" backLabel="Pazienti" navItems={[{href:'#terapie',label:'Terapie'}]}><section id="terapie"><h3>Terapie farmacologiche</h3><DrugAutocomplete onSelect={drug=>window.selected=drug} autoFocus /></section></Kree8WorkspaceShell></PrivacyProvider>);`, resolveDir: process.cwd(), loader: 'tsx' },
        bundle: true, write: false, outfile: 'fixture/bundle.js', platform: 'browser', format: 'iife',
        plugins: [{ name: 'pathname', setup(b) { b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'pathname', namespace: 'fixture' })); b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: "export const usePathname=()=>'/patients/synthetic/modules';" })); } }],
        jsx: 'automatic', loader: { '.css': 'empty' },
        define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"' },
    });
    script = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
    browser = await chromium.launch(secureLaunch({ headless: true }));
});
after(async () => { await browser?.close(); });

test('therapy hash navigation preserves fast drug typing and keyboard selection', { timeout: 15_000 }, async t => {
    const page = await browser.newPage();
    page.setDefaultTimeout(3000);
    t.after(() => page.close());
    await page.route('http://127.0.0.1/**', async route => {
        if (new URL(route.request().url()).pathname === '/api/drugs') {
            await route.fulfill({ json: [{ aic: 'SYN-1', name: 'MISURASTATINA 20 mg', activePrinciple: 'Sintetico' }], headers: { 'x-mediflow-aifa-catalog': 'ready' } });
        } else await route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script>${script}</script>` });
    });
    await page.goto('http://127.0.0.1/');
    const input = page.getByRole('combobox');
    await input.focus();
    await page.keyboard.type('Misur');
    await page.evaluate(() => { history.replaceState(null, '', '#terapie'); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.keyboard.type('astatina');
    await expect(input).toHaveValue('Misurastatina');
    await expect(input).toBeFocused();
    await expect(page.getByRole('option')).toHaveCount(1);
    await page.keyboard.press('ArrowDown');
    assert.ok(await input.getAttribute('aria-activedescendant'));
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('MISURASTATINA 20 mg');
    await expect(page.getByRole('option')).toHaveCount(0);
    await input.evaluate(element => element.blur());
    await page.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    await expect(page.getByRole('heading', { name: 'Terapie farmacologiche' })).toBeFocused();
});
