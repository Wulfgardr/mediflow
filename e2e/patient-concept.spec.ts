import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createConceptPatient } from './fixtures/concept-patient';
import { assertNoHorizontalOverflow, bootstrapUnlockedSession } from './utils';

test('Scheda desktop del concept con identità, tre colonne e ritorno alle sezioni', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1320, height: 880 });
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234', { displayName: 'Dott. Sintetico', ambulatoryName: 'Ambulatorio di prova' });
    const id = await createConceptPatient(page);
    await page.goto(`/patients/${id}/modules`);
    const record = page.getByTestId('lume-scheda-surface');
    await expect(record.getByText('Scompenso cardiaco').first()).toBeVisible();
    await page.getByRole('link', { name: 'Nuova voce', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'Resoconto clinico', exact: true });
    const draft = 'Bozza sintetica per il prossimo accesso della squadra ADI.';
    await editor.fill(draft);
    await expect(page.getByTestId('local-draft-status')).toContainText('conservati cifrati');
    await page.getByRole('link', { name: 'Chiudi la voce', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Torna alla bozza', exact: true })).toBeVisible();
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
        if (await page.locator('html').evaluate(el => el.classList.contains('dark')) !== (theme === 'dark')) {
            await page.getByRole('button', { name: 'Cambia tema', exact: true }).click();
        }
        await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`));
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
        for (const [bounds, left, width] of [[stable, 269, 307], [changed, 592, 374], [context, 982, 307]] as const) {
            expect(Math.abs(bounds.x - left)).toBeLessThanOrEqual(4);
            expect(Math.abs(bounds.y - 235)).toBeLessThanOrEqual(5);
            expect(Math.abs(bounds.width - width)).toBeLessThanOrEqual(4);
        }
    }
    const prescribe = page.getByRole('button', { name: 'Prescrivi', exact: true });
    const exposed = await prescribe.evaluate(button => {
        const box = button.getBoundingClientRect();
        return [3, box.height / 2, box.height - 3].every(dy => button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + dy)));
    });
    expect(exposed).toBe(true);
    await prescribe.click();
    await page.getByRole('menuitem', { name: 'Prescrizione di una prestazione' }).click();
    await expect(page.locator('#prestazioni')).toBeVisible();
    await page.getByRole('link', { name: 'Riepilogo', exact: true }).click();
    await expect(change).toBeVisible();
    await page.getByRole('link', { name: 'Torna alla bozza', exact: true }).click();
    await expect(editor).toHaveText(draft);
    await page.getByRole('link', { name: 'Chiudi la voce', exact: true }).click();
    await page.getByRole('link', { name: 'Cerca pazienti', exact: true }).click();
    await expect(page.getByRole('searchbox', { name: 'Cerca nella lista pazienti' })).toBeFocused();
});
