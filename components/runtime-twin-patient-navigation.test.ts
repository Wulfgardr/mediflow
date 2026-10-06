// Real React navigation and its CSS in Chromium; fixture controls replace only
// the asynchronous count producer. No app server, clinical data or API writes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';

const origin = 'http://127.0.0.1:48975';
const entry = `import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {RuntimeTwinPatientNavigation} from './components/runtime-twin-workspace';
function Fixture() {
  const [count, setCount] = useState(undefined);
  const items = [
    {href:'#quadro',label:'Quadro'}, {href:'#diario',label:'Diario'},
    {href:'#attenzione',label:'Attenzione'}, {href:'#identita',label:'Anagrafica'},
    {href:'#clinica',label:'Diagnosi'}, {href:'#amministrazione',label:'Amministrazione'},
    {href:'#parametri',label:'Parametri',meta:'0'},
    {href:'#terapie',label:'Terapie',meta:count},
    {href:'#prestazioni',label:'Prestazioni'}, {href:'#protesica',label:'Protesica'},
    {href:'#scale',label:'Scale'}, {href:'#documenti',label:'Documenti',meta:'0'},
    {href:'#siss',label:'SISS/FSE'}, {href:'#timeline',label:'Timeline'},
    {href:'#follow-up',label:'Follow-up'}
  ];
  return <>
    <div className="fixtureNavigation"><RuntimeTwinPatientNavigation items={items} active="terapie" /></div>
    <section className="fixtureForm" id="terapie">
      <label><input type="checkbox" />Farmaco manuale o galenico</label>
    </section>
    <button className="fixtureCounts" onClick={() => setCount('2')}>Carica conteggi sintetici</button>
  </>;
}
createRoot(document.getElementById('root')).render(<Fixture />);`;

test('patient section menu closes when navigation selects a primary or secondary link', { timeout: 30_000 }, async t => {
    assert.ok(process.env.MEDIFLOW_DATA_DIR?.trim(), 'explicit synthetic directory required');
    const bundle = await build({
        stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' },
        bundle: true, write: false, outfile: 'fixture/bundle.js',
        platform: 'browser', format: 'iife', jsx: 'automatic',
        define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"' },
    });
    const javascript = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
    const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text;
    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());

    async function fixture(width: number) {
        const context = await browser.newContext({ viewport: { width, height: 720 } });
        const page = await context.newPage();
        const errors: string[] = [], unexpected: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.origin !== origin) { unexpected.push(url.origin); await route.abort(); return; }
            if (url.pathname === '/') {
                await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="it"><head>
                  <link rel="stylesheet" href="/bundle.css"><style>
                  body{margin:0;font-family:Arial,sans-serif}.fixtureNavigation{margin:72px 0 0 210px;width:560px}
                  .fixtureForm{margin:246px 0 0 242px}.fixtureForm label{display:inline-flex;align-items:center;min-height:40px}
                  .fixtureCounts{position:fixed;right:15px;bottom:15px;z-index:50}
                  @media(max-width:700px){.fixtureNavigation{margin:20px 0 0;width:100%}.fixtureForm{margin:80px 14px}}
                  </style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>` });
            } else if (url.pathname === '/bundle.js') await route.fulfill({ contentType: 'text/javascript', body: javascript });
            else if (url.pathname === '/bundle.css') await route.fulfill({ contentType: 'text/css', body: css });
            else { unexpected.push(url.pathname); await route.abort(); }
        });
        await page.goto(origin);
        const navigation = page.getByRole('navigation', { name: 'Sezioni della vista', exact: true });
        try {
            await expect(navigation).toBeVisible({ timeout: 1500 });
            assert.deepEqual(errors, [], 'fixture rendered without browser errors');
        } catch (error) {
            await context.close();
            throw new Error(`navigation fixture failed to render: ${errors.join('; ')}`, { cause: error });
        }
        const menu = navigation.locator('details'), summary = navigation.locator('summary');
        return { page, navigation, menu, summary, close: async () => {
            try { assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); }
            finally { await context.close(); }
        } };
    }

    for (const width of [1280, 390]) {
        await t.test(`a count update promotes therapy while the open menu still closes on its click at ${width}px`, async () => {
            const f = await fixture(width);
            try {
                await f.summary.click();
                await expect(f.menu).toHaveJSProperty('open', true);
                await expect(f.menu.locator('a[href="#terapie"]')).toBeVisible();
                await f.page.getByRole('button', { name: 'Carica conteggi sintetici', exact: true }).click();
                const therapy = f.navigation.locator(':scope > a[href="#terapie"]');
                await expect(therapy).toBeVisible();
                await expect(f.menu).toHaveJSProperty('open', true);
                await therapy.click();
                await expect(f.page).toHaveURL(/#terapie$/);
                await expect(f.menu).toHaveJSProperty('open', false, { timeout: 500 });
                await f.page.getByText('Farmaco manuale o galenico', { exact: true }).click();
                await expect(f.page.getByRole('checkbox')).toBeChecked();
            } finally { await f.close(); }
        });

        await t.test(`keyboard selection of an existing primary link closes the menu at ${width}px`, async () => {
            const f = await fixture(width);
            try {
                await f.summary.click();
                await expect(f.menu).toHaveJSProperty('open', true);
                await f.navigation.locator(':scope > a[href="#quadro"]').focus();
                await f.page.keyboard.press('Enter');
                await expect(f.page).toHaveURL(/#quadro$/);
                await expect(f.menu).toHaveJSProperty('open', false, { timeout: 500 });
            } finally { await f.close(); }
        });

        await t.test(`secondary selection, summary toggle and Escape focus remain native at ${width}px`, async () => {
            const f = await fixture(width);
            try {
                await f.summary.click();
                await expect(f.menu).toHaveJSProperty('open', true);
                await f.menu.locator('a[href="#protesica"]').click();
                await expect(f.page).toHaveURL(/#protesica$/);
                await expect(f.menu).toHaveJSProperty('open', false);
                await f.summary.click();
                await expect(f.menu).toHaveJSProperty('open', true);
                await f.summary.click();
                await expect(f.menu).toHaveJSProperty('open', false);
                await f.summary.click();
                await expect(f.menu).toHaveJSProperty('open', true);
                await f.page.keyboard.press('Escape');
                await expect(f.menu).toHaveJSProperty('open', false);
                await expect(f.summary).toBeFocused();
                await f.summary.click();
                await expect(f.menu).toHaveJSProperty('open', true);
            } finally { await f.close(); }
        });
    }
});
