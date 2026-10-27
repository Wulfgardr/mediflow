import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { functionScenarios, installFunctionsMocks, installFunctionsEgressGuard } from './fixtures/settings-functions';
import { bootstrapUnlockedSession, assertNoHorizontalOverflow } from './utils';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';

function requireSynthetic(baseURL?: string): asserts baseURL is string {
    if (process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR || !baseURL) throw Error('Owned synthetic runtime and data directory required');
}
const region = (page: Page) => page.getByTestId('settings-ai-functions-section');
const baseline = process.env.FUNCTIONS_COMPOSITION_BASELINE === '1';

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
                await expect(region(page).locator(`span[data-state="${scenario}"]`)).toHaveCount(4);
                await expect(region(page).getByText('La configurazione non prova la disponibilità del modello: viene verificata alla richiesta.', { exact: true })).toBeVisible();
            }
        }
        const directory = process.env.FUNCTIONS_COMPOSITION_SCREENSHOTS;
        if (directory) {
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
    requireSynthetic(baseURL);
    const egress = await installFunctionsEgressGuard(page, baseURL);
    const mock = await installFunctionsMocks(page, baseURL, 'off');
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    try {
        await page.goto('/settings/ai/funzioni');
        const preferences = region(page).getByTestId('function-preferences');
        await expect(preferences.getByRole('switch')).toHaveCount(4);
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
    } finally { await mock.close(); await egress.close(); }
});
