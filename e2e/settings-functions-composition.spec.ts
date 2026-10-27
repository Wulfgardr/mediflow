import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { functionScenarios, installFunctionsMocks, installFunctionsEgressGuard } from './fixtures/settings-functions';
import { bootstrapUnlockedSession, assertNoHorizontalOverflow } from './utils';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';

function requireSynthetic(baseURL?: string): asserts baseURL is string {
    if (process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR || !baseURL) throw Error('Owned synthetic runtime and data directory required');
}
const region = (page: Page) => page.getByTestId('settings-ai-functions-section');
const baseline = process.env.FUNCTIONS_COMPOSITION_BASELINE === '1';
const targeted = process.env.FUNCTIONS_COMPOSITION_TARGETED === '1';

async function captureTarget(page: Page, target: Locator, name: string, frames: unknown[], visualRole?: 'primary' | 'secondary') {
    const directory = process.env.FUNCTIONS_COMPOSITION_SCREENSHOTS;
    if (!directory) throw Error('Targeted capture directory required');
    const before = await target.evaluate(element => {
        const owners = [];
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            if (parent.scrollHeight > parent.clientHeight && /auto|scroll/u.test(getComputedStyle(parent).overflowY))
                owners.push({ tag: parent.tagName, className: parent.className, scrollTop: parent.scrollTop });
        }
        return owners;
    });
    await target.scrollIntoViewIfNeeded();
    await expect(target).toBeVisible();
    const probe = await target.evaluate(element => {
        const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
        const inset = Math.min(12, rect.width / 4, rect.height / 4);
        const points = [[rect.x + rect.width / 2, rect.y + rect.height / 2],
            [rect.x + inset, rect.y + inset], [rect.right - inset, rect.y + inset],
            [rect.x + inset, rect.bottom - inset], [rect.right - inset, rect.bottom - inset]].map(([x, y]) => {
                const hit = document.elementFromPoint(x, y);
                return { x, y, insideTarget: hit === element || !!hit && element.contains(hit), hitTag: hit?.tagName ?? null };
            });
        const scrollOwners = [];
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            if (parent.scrollHeight > parent.clientHeight && /auto|scroll/u.test(getComputedStyle(parent).overflowY))
                scrollOwners.push({ tag: parent.tagName, className: parent.className, scrollTop: parent.scrollTop });
        }
        return { rect: { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
            viewport: { width: innerWidth, height: innerHeight, devicePixelRatio }, points, scrollOwners,
            text: element.textContent?.trim().slice(0, 500), className: element.className,
            disabled: element.matches(':disabled'), background: style.backgroundColor, color: style.color };
    });
    await mkdir(directory, { recursive: true });
    const path = `${directory}/targeted-${name}.png`;
    await page.screenshot({ path, fullPage: false });
    frames.push({ name, path, visualRole, before, ...probe });
    await writeFile(`${directory}/targeted-${name.startsWith('configured-') ? 'configured' : 'workflow'}-manifest.json`, JSON.stringify(frames, null, 2));
    expect(probe.rect.width, name).toBeGreaterThan(0);
    expect(probe.rect.x, name).toBeGreaterThanOrEqual(-1);
    expect(probe.rect.y, name).toBeGreaterThanOrEqual(-1);
    expect(probe.rect.right, name).toBeLessThanOrEqual(probe.viewport.width + 1);
    expect(probe.rect.bottom, name).toBeLessThanOrEqual(probe.viewport.height + 1);
    expect(probe.points.every(point => point.insideTarget), `${name}: target hit at center and inset corners`).toBe(true);
    expect(probe.scrollOwners.length, `${name}: real scroll container`).toBeGreaterThan(0);
    if (visualRole) {
        await expect(target).toBeEnabled();
        await expect(target).toHaveClass(visualRole === 'primary' ? /primaryAction/u : /secondaryAction/u);
    }
}

for (const scenario of functionScenarios) test(`Funzioni baseline: ${scenario}`, async ({ baseURL }) => {
    test.setTimeout(120_000);
    requireSynthetic(baseURL);
    const zoom = await openBrowserZoomFixture(baseURL), page = zoom.page;
    const egress = await installFunctionsEgressGuard(page, baseURL);
    let mock: Awaited<ReturnType<typeof installFunctionsMocks>> | undefined;
    const errors: string[] = [], frames: unknown[] = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        mock = await installFunctionsMocks(page, baseURL, scenario);
        await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
        await page.goto('/settings/ai/funzioni');
        await expect(page).toHaveURL(new URL('/settings/ai/funzioni', baseURL).href);
        await expect(region(page)).toBeVisible();
        if (scenario === 'pending') {
            await expect(region(page).getByTestId('ai-settings-controls')).toHaveJSProperty('disabled', true);
        } else if (scenario === 'auth-error' || scenario === 'read-error') {
            await expect(region(page).getByTestId('function-preferences').getByRole('alert')).toBeVisible();
        } else {
            await expect(region(page).getByRole('switch')).toHaveCount(4);
            if (scenario === 'off' || scenario === 'configured') for (const toggle of await region(page).getByRole('switch').all()) await expect(toggle).toHaveAttribute('aria-checked', String(scenario === 'configured'));
            if (scenario === 'unavailable') await expect(region(page).getByText(/non disponibile/, { exact: false }).first()).toBeVisible();
            if (!baseline && ['off', 'configured', 'unavailable'].includes(scenario)) {
                const status = region(page).locator(`span[data-state="${scenario}"]`);
                const label = scenario === 'off' ? 'Disattivata' : scenario === 'configured'
                    ? 'Configurazione locale presente' : 'Configurazione locale non disponibile';
                await expect(status).toHaveText([label, label, label, label]);
                await expect(region(page).getByText('La configurazione non prova la disponibilità del modello: viene verificata alla richiesta.', { exact: true })).toBeVisible();
            }
        }
        const directory = process.env.FUNCTIONS_COMPOSITION_SCREENSHOTS;
        if (targeted && scenario === 'configured') {
            const card = region(page).locator('article').filter({ has: page.getByRole('heading', { name: 'Quadro paziente', exact: true }) });
            await region(page).getByRole('button', { name: 'Regola contesto e lunghezza delle sintesi', exact: true }).click();
            const targets: { id: string; locator: Locator; role?: 'primary' | 'secondary' }[] = [
                { id: 'row', locator: card.getByRole('heading', { name: 'Quadro paziente', exact: true }).locator('..') },
                { id: 'model', locator: card.getByRole('combobox', { name: 'Modello predefinito · Quadro paziente', exact: true }) },
                { id: 'actions', locator: card.getByRole('switch', { name: 'Quadro paziente nella proposta', exact: true }).locator('..') },
                { id: 'advanced-output', locator: region(page).getByRole('spinbutton', { name: 'Output max token', exact: true }) },
                { id: 'advanced-save', locator: region(page).getByRole('button', { name: 'Salva parametri avanzati', exact: true }), role: 'primary' },
            ];
            for (const theme of ['giorno', 'grafite']) for (const size of [320, 'zoom-400'] as const) {
                await page.setViewportSize({ width: 1440, height: 1000 });
                await zoom.setZoom(size === 'zoom-400' ? 4 : 1);
                if (size === 320) await page.setViewportSize({ width: 320, height: 1000 });
                await page.evaluate(theme => { document.documentElement.classList.toggle('dark', theme === 'grafite'); document.documentElement.classList.toggle('light', theme === 'giorno'); }, theme);
                for (const target of targets) await captureTarget(page, target.locator, `configured-${theme}-${size}-${target.id}`, frames, target.role);
            }
            await writeFile(`${directory}/configured-targeted-calls.json`, JSON.stringify({ calls: mock.calls.map(({ path, method }) => ({ path, method })), settingsWrites: mock.settingsWrites,
                preferenceWrites: mock.preferenceWrites, mockedUiWrites: mock.mockedUiWrites, blocked: mock.blocked, errors }, null, 2));
        }
        if (directory && !targeted) {
            await mkdir(directory, { recursive: true });
            for (const theme of ['giorno', 'grafite']) for (const size of [1440, 768, 320, 'zoom-200', 'zoom-400'] as const) {
                await page.setViewportSize({ width: 1440, height: 1000 });
                await zoom.setZoom(size === 'zoom-200' ? 2 : size === 'zoom-400' ? 4 : 1);
                if (typeof size === 'number') await page.setViewportSize({ width: size, height: 1000 });
                await page.evaluate(theme => { document.documentElement.classList.toggle('dark', theme === 'grafite'); document.documentElement.classList.toggle('light', theme === 'giorno'); }, theme);
                await region(page).getByRole('heading', { name: 'Funzioni cliniche', exact: true }).scrollIntoViewIfNeeded();
                frames.push({ scenario, theme, size, ...await region(page).evaluate(element => ({ viewport: innerWidth,
                    width: element.getBoundingClientRect().width, overflow: element.scrollWidth - element.clientWidth,
                    documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                    palette: { ink: getComputedStyle(document.documentElement).getPropertyValue('--lume-ink'), surface: getComputedStyle(document.documentElement).getPropertyValue('--lume-surface-field') },
                    disclosureCount: element.querySelectorAll('[data-disclosure]').length,
                })) });
                if (!baseline) await assertNoHorizontalOverflow(page, [{ label: 'pagina', selector: 'document' }, { label: 'funzioni', selector: '[data-testid="settings-ai-functions-section"]' }]);
                await page.screenshot({ path: `${directory}/${scenario}-${theme}-${size}.png`, fullPage: true });
            }
            await writeFile(`${directory}/${scenario}-calls.json`, JSON.stringify({ frames, errors, calls: mock.calls, blocked: mock.blocked,
                settingsWrites: mock.settingsWrites, preferenceWrites: mock.preferenceWrites, mockedUiWrites: mock.mockedUiWrites }, null, 2));
        }
        expect(mock.settingsWrites).toEqual([]); expect(mock.preferenceWrites).toEqual([]); expect(mock.blocked).toEqual([]); expect(egress.blocked).toEqual([]);
        expect(errors).toEqual([]);
        if (scenario === 'pending') { mock.releasePending(); await expect(region(page).getByRole('switch')).toHaveCount(4); }
    } finally { await mock?.close(); await egress.close(); await zoom.close(); }
});

test('Funzioni: anteprima, applicazione e salvataggio avanzato restano distinti; errore conserva bozza', async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    requireSynthetic(baseURL);
    if (targeted) await page.setViewportSize({ width: 1440, height: 1000 });
    const egress = await installFunctionsEgressGuard(page, baseURL);
    const mock = await installFunctionsMocks(page, baseURL, 'off');
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    try {
        await page.goto('/settings/ai/funzioni');
        const preferences = region(page).getByTestId('function-preferences');
        await expect(preferences.getByRole('switch')).toHaveCount(4);
        const allOff = preferences.getByRole('button', { name: 'Spegni tutte', exact: true });
        const explanation = preferences.getByText('Ripristina predefiniti usa i modelli del computer senza cambiare gli interruttori. Spegni tutte conserva i modelli. I preset hardware restano separati.', { exact: true });
        expect(await explanation.evaluate((element, button) => Boolean(button && (element.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING)), await allOff.elementHandle())).toBe(true);
        await expect(preferences.getByRole('button', { name: 'Rileggi impostazioni', exact: true })).toHaveClass(/mf-button-text/u);
        await allOff.click();
        await expect(preferences.getByRole('region', { name: 'Anteprima impostazioni' })).toBeVisible();
        expect(mock.preferenceWrites).toEqual([]); expect(mock.settingsWrites).toEqual([]);
        await preferences.getByRole('button', { name: 'Annulla proposta', exact: true }).click();
        const commonDisclosure = region(page).getByRole('button', { name: 'Regola contesto e lunghezza delle sintesi', exact: true });
        const advancedToggle = await commonDisclosure.count() ? commonDisclosure : region(page).locator('summary', { hasText: 'Regola contesto e lunghezza delle sintesi' });
        await advancedToggle.click();
        const draft = region(page).getByRole('spinbutton', { name: 'Documenti massimi', exact: true, includeHidden: true });
        await draft.fill('9');
        await advancedToggle.click();
        await expect(draft).toBeHidden();
        const save = region(page).getByRole('button', { name: /^(Salva Configurazione|Salva parametri avanzati)$/u });
        const toggle = preferences.getByRole('switch', { name: 'Quadro paziente nella proposta', exact: true });
        await toggle.click();
        await toggle.locator('..').getByRole('button', { name: 'Anteprima modifica', exact: true }).click();
        await expect(preferences.getByRole('region', { name: 'Anteprima impostazioni' })).toBeVisible();
        if (!baseline) await expect(region(page).locator('button[class*="primaryAction"]:visible')).toHaveCount(1);
        if (!baseline) await expect(save).toHaveClass(/secondaryAction/u);
        await expect(draft).toHaveValue('9');
        if (targeted) {
            const frames: unknown[] = [];
            for (const theme of ['giorno', 'grafite']) {
                await page.evaluate(theme => { document.documentElement.classList.toggle('dark', theme === 'grafite'); document.documentElement.classList.toggle('light', theme === 'giorno'); }, theme);
                await captureTarget(page, preferences.getByRole('button', { name: 'Applica alle impostazioni', exact: true }), `workflow-${theme}-1440-apply`, frames, 'primary');
                await captureTarget(page, save, `workflow-${theme}-1440-save-secondary`, frames, 'secondary');
            }
        }
        expect(mock.preferenceWrites).toEqual([]); expect(mock.settingsWrites).toEqual([]);
        await preferences.getByRole('button', { name: 'Annulla proposta', exact: true }).click();
        await expect(preferences.getByRole('heading', { name: 'Preferenze per esperienza', exact: true })).toBeFocused();
        if (!baseline) await expect(save).toHaveClass(/primaryAction/u);
        await expect(draft).toHaveValue('9');
        expect(mock.preferenceWrites).toEqual([]);
        await toggle.locator('..').getByRole('button', { name: 'Anteprima modifica', exact: true }).click();
        await preferences.getByRole('button', { name: 'Applica alle impostazioni', exact: true }).click();
        await expect(preferences.getByRole('status')).toContainText('Impostazioni salvate');
        expect(mock.preferenceWrites).toHaveLength(1); expect(mock.settingsWrites).toEqual([]);
        await advancedToggle.click();
        await expect(draft).toHaveValue('9');
        mock.state.failSave = true;
        await region(page).getByRole('button', { name: /^(Salva Configurazione|Salva parametri avanzati)$/u }).click();
        await expect(page.getByText('Salvataggio non riuscito', { exact: true })).toBeVisible();
        await expect(draft).toHaveValue('9'); expect(mock.preferenceWrites).toHaveLength(1);
        mock.state.failSave = false;
        await region(page).getByRole('button', { name: /^(Salva Configurazione|Salva parametri avanzati)$/u }).click();
        await expect(page.getByText('Configurazione AI salvata', { exact: true })).toBeVisible();
        expect(JSON.parse(mock.config.aiInsightManualConfig).maxDocuments).toBe(9);
        expect(mock.config.aiPatientInsightKillSwitch).toBe('enabled');
        expect(mock.blocked).toEqual([]); expect(egress.blocked).toEqual([]);
    } finally {
        try {
            if (targeted && process.env.FUNCTIONS_COMPOSITION_SCREENSHOTS) {
                await mkdir(process.env.FUNCTIONS_COMPOSITION_SCREENSHOTS, { recursive: true });
                await writeFile(`${process.env.FUNCTIONS_COMPOSITION_SCREENSHOTS}/workflow-targeted-calls.json`, JSON.stringify({
                    calls: mock.calls.map(({ path, method }) => ({ path, method })), settingsWrites: mock.settingsWrites.length,
                    preferenceWrites: mock.preferenceWrites.length, mockedUiWrites: mock.mockedUiWrites.length, blocked: mock.blocked,
                }, null, 2));
            }
        } finally { await mock.close(); await egress.close(); }
    }
});
