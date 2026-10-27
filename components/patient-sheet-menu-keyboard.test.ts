import assert from 'node:assert/strict';
import { after, before, test, type TestContext } from 'node:test';
import { chromium, expect, type Browser } from '@playwright/test';
import { build } from 'esbuild';

let browser: Browser;
let script: string;
before(async () => {
    assert.ok(process.env.MEDIFLOW_DATA_DIR?.trim());
    const bundle = await build({
        stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';
import {PatientSheetMenu} from './components/patient-sheet-menu';
createRoot(document.getElementById('root')).render(<PatientSheetMenu label="Azioni documento" trigger={props=><button {...props}>Altro</button>}>
<button role="menuitem" disabled>Estrai testo</button>
<button role="menuitem" tabIndex={-1}>Prepara sintesi</button>
<button role="menuitem" tabIndex={-1}>Elimina</button>
<button role="menuitem" disabled>Non disponibile</button>
</PatientSheetMenu>);`, resolveDir: process.cwd(), loader: 'tsx' },
        bundle: true, write: false, outfile: 'fixture/bundle.js', platform: 'browser', format: 'iife',
        jsx: 'automatic', define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"' },
    });
    script = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
    browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); });

async function fixture(t: TestContext) {
    const page = await browser.newPage();
    t.after(() => page.close());
    await page.route('http://menu.test/**', route => route.fulfill({ contentType: 'text/html',
        body: `<!doctype html><html lang="it"><body><div id="root"></div><button>Fuori</button><script>${script}</script></body></html>` }));
    await page.goto('http://menu.test/');
    const trigger = page.getByRole('button', { name: 'Altro', exact: true });
    const menu = page.getByRole('menu', { name: 'Azioni documento', exact: true });
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Prepara sintesi' })).toBeFocused();
    return { page, trigger, menu };
}

for (const key of ['Escape', 'Tab', 'Shift+Tab']) {
    test(`document menu: ${key} closes, restores trigger and permits both arrow entries`, async t => {
        const { page, trigger, menu } = await fixture(t);
        await page.keyboard.press(key);
        await expect(menu).toHaveCount(0, { timeout: 1000 });
        await expect(trigger).toBeFocused();
        for (const [arrow, label] of [['ArrowDown', 'Prepara sintesi'], ['ArrowUp', 'Elimina']]) {
            await page.keyboard.press(arrow);
            await expect(menu.getByRole('menuitem', { name: label })).toBeFocused();
            await page.keyboard.press('Escape');
            await expect(trigger).toBeFocused();
        }
    });
}

for (const [key, label] of [['ArrowDown', 'Prepara sintesi'], ['ArrowUp', 'Elimina']]) {
    test(`document menu: ${key} on an already open trigger returns to its edge item`, async t => {
        const { page, trigger, menu } = await fixture(t);
        await trigger.focus();
        await page.keyboard.press(key);
        await expect(menu.getByRole('menuitem', { name: label })).toBeFocused({ timeout: 1000 });
    });
}

for (const [key, label] of [['ArrowDown', 'Elimina'], ['ArrowUp', 'Elimina'], ['Home', 'Prepara sintesi'], ['End', 'Elimina']]) {
    test(`document menu: ${key} navigates enabled items`, async t => {
        const { page, menu } = await fixture(t);
        if (key === 'Home') await page.keyboard.press('End');
        await page.keyboard.press(key);
        await expect(menu.getByRole('menuitem', { name: label })).toBeFocused();
        if (key === 'ArrowDown' || key === 'ArrowUp') {
            await page.keyboard.press(key);
            await expect(menu.getByRole('menuitem', { name: 'Prepara sintesi' })).toBeFocused();
        }
    });
}
