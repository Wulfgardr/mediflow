import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { bootstrapUnlockedSession, assertNoHorizontalOverflow, assertNotClippedInViewport } from './utils';

const longName = 'Modello sintetico con nome completo molto lungo per la revisione clinica e la verifica della scelta conservata';
const optionId = `model_option_${'2'.repeat(32)}`;
const baseline = process.env.E2E_CHOICE_BASELINE === '1';
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

async function fixture(page: Page) {
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    let writes = 0;
    await page.route('**/api/settings/ai/functions', route => {
        if (route.request().method() !== 'GET') { writes++; return route.abort(); }
        return route.fulfill({ json: { schemaVersion: 'mediflow.function-preferences.v2',
            revision: `sha256_${'a'.repeat(64)}`, catalogRevision: `sha256_${'b'.repeat(64)}`,
            check: 'configuration_only', presets: ['host_defaults', 'all_off'], apply: 'denied',
            functions: ['patient_insight', 'smart_import', 'document_synthesis', 'treatment_reasoning'].map(id => ({
                id, enabled: true, defaultModelOptionId: `model_option_${'1'.repeat(32)}`,
                defaultSource: 'saved_preference', bindingState: 'current', options: [
                    { modelOptionId: `model_option_${'1'.repeat(32)}`, label: 'Modello sintetico predefinito', provider: 'ollama', state: 'available_unqualified' },
                    { modelOptionId: optionId, label: longName, provider: 'ollama', state: 'available_unqualified' },
                    { modelOptionId: `model_option_${'3'.repeat(32)}`, label: 'Modello sintetico assente', provider: 'ollama', state: 'unavailable' },
                ],
            })),
        } });
    });
    await page.goto('/mockups/choices');
    await expect(page.getByTestId('choice-fixture')).toBeVisible();
    return () => expect(writes, 'montaggio e render non salvano preferenze').toBe(0);
}

async function chooseLongName(page: Page) {
    const picker = page.getByTestId('model-picker-patient_insight');
    const select = picker.getByRole('combobox', { name: 'Modello per questa proposta' });
    if (!baseline) await picker.getByRole('button', { name: 'Cambia', exact: true }).click();
    else await select.focus();
    await expect(select.locator(`option[value="${optionId}"]`)).toHaveCount(1);
    await select.selectOption(optionId);
    return { picker, select };
}

test('scelta finita comune: apertura esplicita, nome completo, render, errore e disabilitazione', async ({ page }) => {
    const noWrites = await fixture(page);
    const picker = page.getByTestId('model-picker-patient_insight');
    await expect(picker).toContainText('Modello: predefinito');
    await expect(picker.getByRole('combobox')).toBeHidden();
    const { select } = await chooseLongName(page);
    await expect(select.locator('xpath=..')).toHaveAttribute('data-choice-field');
    await expect(select).toHaveAccessibleName('Modello per questa proposta');
    await expect(select.locator('option:checked')).toContainText(longName);
    await expect(select).toHaveAttribute('title', new RegExp(longName));
    await expect(select.locator('option').last()).toBeDisabled();
    await select.focus();
    await page.keyboard.press('Tab');
    await select.focus();
    await expect(select).toHaveCSS('outline-width', '2px');
    await expect(select).toHaveCSS('outline-offset', '2px');
    await expect(select).toHaveCSS('height', '40px');
    await page.getByRole('button', { name: 'Aggiorna vista' }).click();
    await expect(select).toHaveValue(optionId);
    await page.getByRole('button', { name: 'Cambia', exact: true }).click();
    await expect(select).toBeHidden();
    await expect(picker).toContainText(longName);
    await page.getByRole('button', { name: 'Cambia', exact: true }).click();
    await expect(select).toHaveValue(optionId);
    await page.getByRole('button', { name: 'Cambia errore' }).click();
    await expect(select).toHaveAttribute('aria-invalid', 'true');
    await expect(select).toHaveAccessibleDescription(/Errore sintetico/);
    await expect(picker.getByRole('alert')).toContainText('Errore sintetico');
    await expect(select).toHaveValue(optionId);
    await page.getByRole('button', { name: 'Cambia disabilitazione' }).click();
    await expect(select).toBeDisabled();
    await expect(picker.getByText('Sblocca MediFlow per scegliere il modello.')).toBeVisible();
    await expect(select).toHaveAccessibleDescription(/Sblocca MediFlow/);
    await expect(select).toHaveValue(optionId);
    await page.getByRole('button', { name: 'Aggiorna vista' }).click();
    await page.getByRole('button', { name: 'Cambia disabilitazione' }).click();
    await expect(select).toBeEnabled();
    await expect(select).toHaveValue(optionId);
    noWrites();
});

for (const theme of ['giorno', 'grafite']) for (const size of ['1440', '768', '390', '320', 'zoom-200', 'zoom-400']) {
    test(`cattura scelta ${theme} ${size}`, async ({ page }) => {
        await page.setViewportSize({ width: size.startsWith('zoom') ? 1440 : Number(size), height: 1000 });
        const noWrites = await fixture(page);
        await page.evaluate(({ theme, size }) => {
            document.documentElement.classList.toggle('dark', theme === 'grafite');
            document.documentElement.classList.toggle('light', theme === 'giorno');
            if (size.startsWith('zoom')) document.documentElement.style.zoom = size === 'zoom-200' ? '2' : '4';
        }, { theme, size });
        const { picker, select } = await chooseLongName(page);
        await page.getByRole('button', { name: 'Cambia errore' }).click();
        await select.focus();
        await assertNotClippedInViewport(select, 'Scelta del modello');
        await assertNoHorizontalOverflow(page, [{ label: 'documento', selector: 'document' }]);
        if (!baseline) {
            await expect(picker.locator('[data-choice-field]')).toContainText(new RegExp(longName));
            await expect(select).toHaveAttribute('aria-invalid', 'true');
        }
        const screenshot = test.info().outputPath(`choice-${theme}-${size}.png`);
        await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' });
        await test.info().attach(`choice-${sha}`, { path: screenshot, contentType: 'image/png' });
        await test.info().attach('revisione', { body: `${sha}\n${baseline ? 'prima' : 'dopo'}\nCSS zoom con viewport 1440 per 200% e 400%.`, contentType: 'text/plain' });
        noWrites();
    });
}
