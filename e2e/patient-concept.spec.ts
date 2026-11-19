import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createConceptPatient } from './fixtures/concept-patient';
import { assertNoHorizontalOverflow, bootstrapUnlockedSession } from './utils';

test('Scheda desktop del concept con identità, tre colonne e ritorno alle sezioni', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1320, height: 880 });
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const id = await createConceptPatient(page);
    await page.goto(`/patients/${id}/modules`);
    const record = page.getByTestId('lume-scheda-surface');
    await expect(record.getByText('Scompenso cardiaco').first()).toBeVisible();
    const change = record.getByRole('region', { name: 'Variazioni dall’ultima visita' });
    const medication = change.locator('details').filter({ has: page.locator('summary', { hasText: 'Spironolattone' }) });
    await expect(medication).toHaveCount(1);
    if (!await medication.evaluate(el => (el as HTMLDetailsElement).open)) await medication.locator('summary').click();
    await expect(page.getByText('ADI attiva', { exact: true })).toBeVisible();
    await expect(page.getByText('Ritorno dopo 15 giorni', { exact: true })).toBeVisible();
    const out = process.env.MEDIFLOW_CONCEPT_SCREENSHOTS;
    const rect = (selector: string) => page.locator(selector).first().evaluate(element => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
    });
    for (const theme of ['light', 'dark']) {
        await page.evaluate(value => {
            document.documentElement.classList.toggle('light', value === 'light');
            document.documentElement.classList.toggle('dark', value === 'dark');
        }, theme);
        await assertNoHorizontalOverflow(page, [{ label: 'Scheda', selector: '#quadro' }]);
        const rail = await rect('aside[aria-label="MediFlow"]');
        const main = await rect('[data-testid="lume-scheda-header"]');
        const stable = await rect('#riepilogo-problemi');
        const changed = await rect('[aria-label="Variazioni dall’ultima visita"]');
        const context = await rect('[data-record-tray="contesto"] > div');
        if (out) {
            mkdirSync(out, { recursive: true });
            await page.screenshot({ path: join(out, `scheda-${theme}.png`), animations: 'disabled' });
            writeFileSync(join(out, `misure-${theme}.json`), JSON.stringify({ rail, main, stable, changed, context }, null, 2));
        }
        expect(Math.abs(rail.width - 232)).toBeLessThanOrEqual(3);
        expect(Math.abs(main.x - 244)).toBeLessThanOrEqual(4);
        expect(stable.x).toBeLessThan(changed.x);
        expect(changed.x).toBeLessThan(context.x);
    }
    await page.getByRole('button', { name: 'Prescrivi', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Prescrizione di una prestazione' }).click();
    await expect(page.locator('#prestazioni')).toBeVisible();
    await page.getByRole('link', { name: 'Riepilogo', exact: true }).click();
    await expect(change).toBeVisible();
    await page.getByRole('link', { name: 'Cerca pazienti', exact: true }).click();
    await expect(page.getByRole('searchbox', { name: 'Cerca nella lista pazienti' })).toBeFocused();
});
