import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

test('le ricette del piano e delle sezioni funzionano senza il foglio globale', async () => {
    const bundle = await build({
        absWorkingDir: root,
        stdin: { contents: `import layout from './components/ink-layout.module.css';
            import section from './components/ink-section.module.css';
            import workspace from './components/kree8/kree8-workspace-shell.module.css';
            import secondary from './components/ink-secondary.module.css';
            globalThis.recipes = {layout, section, workspace, secondary};`, resolveDir: root },
        bundle: true, write: false, outfile: '/fixture.js', format: 'iife', logLevel: 'silent',
    });
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
        await page.setContent('<html data-runtime-twin-design="proposal"><head></head><body></body></html>');
        await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
        await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
        await page.evaluate(() => {
            const {layout, section, workspace, secondary} = globalThis.recipes;
            document.body.style.margin = '0';
            document.body.innerHTML = `<main class="${layout.container} ${workspace.overviewShell}" style="width:1236px">
                <header class="${layout.plane} ${workspace.chrome}"><h1>Analisi</h1></header>
                <div class="${layout.plane} ${workspace.workspaceBody} ${section.sections} ${secondary.surface}">
                    <section><h2>Profilo della popolazione</h2><p>9 schede</p></section>
                    <section><h3>Archivio documenti</h3><article class="${secondary.record}"><h3>Referto</h3></article></section>
                </div></main>`;
        });
        for (const [width, inset] of [[1236, 28], [596, 16], [390, 16]]) {
            await page.locator('main').evaluate((element, value) => { element.style.width = `${value}px`; }, width);
            const boxes = await page.locator('main > *').evaluateAll(elements => elements.map(element => {
                const style = getComputedStyle(element);
                return [parseFloat(style.paddingLeft), parseFloat(style.paddingRight)];
            }));
            assert.deepEqual(boxes, [[inset, inset], [inset, inset]], `piano largo ${width}px`);
        }
        const metrics = await page.locator('section > h2,section > h3').evaluateAll(elements => elements.map(element => {
            const style = getComputedStyle(element);
            return [style.fontSize, style.fontWeight, style.letterSpacing, style.textTransform];
        }));
        assert.deepEqual(metrics, [['12px', '600', '0.6px', 'uppercase'], ['12px', '600', '0.6px', 'uppercase']]);
        const recordFont = await page.locator('article h3').evaluate(element => getComputedStyle(element).fontSize);
        await page.locator('main > div').evaluate(element => element.classList.remove(globalThis.recipes.section.sections));
        assert.equal(await page.locator('article h3').evaluate(element => getComputedStyle(element).fontSize), recordFont);
    } finally { await browser.close(); }
});
