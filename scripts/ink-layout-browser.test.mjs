import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';

const root = path.resolve(import.meta.dirname, '..');

test('le ricette del piano e delle sezioni funzionano senza il foglio globale', async () => {
    const bundle = await build({
        absWorkingDir: root,
        stdin: { contents: `import layout from './components/ink-layout.module.css';
            import section from './components/ink-section.module.css';
            import workspace from './components/kree8/kree8-workspace-shell.module.css';
            import secondary from './components/ink-secondary.module.css';
            import foundation from './components/kree8/kree8-clinical-cockpit-foundation.module.css';
            import models from './app/settings/ai/modelli/models-composition.module.css';
            globalThis.recipes = {layout, section, workspace, secondary, foundation, models};`, resolveDir: root },
        bundle: true, write: false, outfile: '/fixture.js', format: 'iife', logLevel: 'silent',
    });
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
        await page.setContent('<html data-runtime-twin-design="proposal"><head></head><body></body></html>');
        await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
        await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
        await page.evaluate(() => {
            const {layout, section, workspace, secondary, foundation, models} = globalThis.recipes;
            document.body.style.margin = '0';
            document.body.innerHTML = `<main class="${layout.container} ${workspace.overviewShell}" style="width:1236px">
                <header class="${layout.plane} ${workspace.chrome}"><h1>Analisi</h1></header>
                <div class="${layout.plane} ${workspace.workspaceBody} ${section.sections} ${secondary.surface}">
                    <div data-runtime-settings class="${layout.columns}" style="display:grid"><aside>Indice</aside><div>Contenuto</div></div>
                    <section><h2 class="${workspace.sectionTitle}">Profilo della popolazione</h2><p>9 schede</p></section>
                    <section><h3><span class="${section.heading}">Archivio documenti</span><span class="${section.count}">3 file</span></h3><article class="${secondary.record}"><h3>Referto</h3></article></section>
                    <section><h2 class="${foundation.panelTitle}">AIFA · AIC farmaci</h2></section>
                    <section class="${models.page}"><section><h3 id="local-onboarding-title">4. Prepara e attiva il collegamento locale</h3></section></section>
                </div></main>`;
        });
        assert.equal(await page.locator('[data-runtime-settings]').evaluate(element => getComputedStyle(element).columnGap), '40px');
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
        assert.deepEqual(metrics, Array.from({length: 4}, () => ['12px', '600', '0.6px', 'uppercase']));
        assert.equal(await page.getByText('Archivio documenti', {exact: true}).evaluate(element => getComputedStyle(element).fontSize), '12px');
        assert.equal(await page.getByText('3 file', {exact: true}).evaluate(element => getComputedStyle(element).textTransform), 'none');
        const recordFont = await page.locator('article h3').evaluate(element => getComputedStyle(element).fontSize);
        await page.locator('main > div').evaluate(element => element.classList.remove(globalThis.recipes.section.sections));
        assert.equal(await page.locator('article h3').evaluate(element => getComputedStyle(element).fontSize), recordFont);
    } finally { await browser.close(); }
});

test('il focus comune resta visibile sui preset selezionati', async () => {
    const bundle = await build({ absWorkingDir: root,
        stdin: { contents: `import styles from './components/settings/guided-local-models.module.css'; globalThis.styles = styles;`, resolveDir: root },
        bundle: true, write: false, outfile: '/fixture.js', format: 'iife', logLevel: 'silent' });
    const globalStyles = postcss.parse(await readFile(path.join(root, 'app/globals.css'), 'utf8'));
    const focus = globalStyles.nodes.find(node => node.type === 'rule' && node.selector.startsWith(':root :focus-visible'));
    assert.ok(focus);
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<style>:root { --lume-ink-fresh: blue; --lume-accent: blue; }</style>');
        await page.addStyleTag({ content: focus.toString() });
        await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
        await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
        await page.evaluate(() => { document.body.innerHTML = `<div class="${globalThis.styles.surface}"><button class="${globalThis.styles.preset}" aria-pressed="true">Profilo selezionato</button></div>`; });
        await page.keyboard.press('Tab');
        const outline = await page.getByRole('button').evaluate(element => {
            const style = getComputedStyle(element);
            return [style.outlineWidth, style.outlineStyle, style.outlineOffset];
        });
        assert.deepEqual(outline, ['2px', 'solid', '2px']);
    } finally { await browser.close(); }
});
