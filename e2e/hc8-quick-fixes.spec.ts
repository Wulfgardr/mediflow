import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession, assertNotClippedInViewport } from './utils';

test.beforeEach(async ({ page }) => {
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
});

test('indice desktop: destinazione corrente in vista e focus conservato al ridimensionamento', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto('/settings/zona-pericolo');
    const nav = page.getByTestId('settings-nav-sidebar');
    const current = nav.locator('a[aria-current="page"]:visible');
    await expect(current).toHaveAttribute('href', '/settings/zona-pericolo');
    await expect.poll(() => current.evaluate(element => {
        const pane = element.closest('aside')!;
        const box = element.getBoundingClientRect(), frame = pane.getBoundingClientRect();
        return pane.scrollTop > 0 && box.top >= frame.top && box.bottom <= frame.bottom + 1;
    })).toBe(true);
    await expect(nav.getByText('Scorri l’indice', { exact: false })).toBeVisible();
    await expect(current).not.toBeFocused();
    const search = page.getByTestId('settings-search-trigger');
    await search.focus();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(search).toBeFocused();
});

test('Accesso a 768: kit visibile senza una riga aggiuntiva per lo scorrimento', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 960 });
    await page.goto('/settings/accesso');
    const kit = page.getByRole('button', { name: 'Prepara il nuovo kit', exact: true });
    await assertNotClippedInViewport(kit, 'Prepara il nuovo kit');
    expect(await kit.evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(960);
    const nav = page.getByTestId('settings-nav-sidebar');
    const hint = await nav.getByText('Scorri per altre sezioni', { exact: false }).boundingBox();
    const search = await page.getByTestId('settings-search-trigger-mobile').boundingBox();
    expect(Math.max(hint!.y, search!.y)).toBeLessThan(Math.min(hint!.y + hint!.height, search!.y + search!.height));
});

test('ricerca a 390: un solo Cancella intero, attivabile e con ritorno al campo', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 960 });
    await page.goto('/?area=incarico');
    const search = page.getByRole('searchbox', { name: 'Cerca nella lista pazienti' });
    await search.fill('Persona sintetica inesistente');
    const clear = page.getByRole('button', { name: 'Cancella la ricerca', exact: true });
    await expect(clear).toHaveCount(1);
    await assertNotClippedInViewport(clear, 'Cancella');
    const box = await clear.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    const field = await search.boundingBox();
    await page.mouse.click(field!.x + field!.width - 10, field!.y + field!.height / 2);
    await expect(search).toHaveValue('Persona sintetica inesistente');
    await clear.click();
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await expect(clear).toHaveCount(0);
});

test('Nuova scheda a 390: tab nella colonna e testo con spazio interno', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 960 });
    await page.goto('/patients/new');
    const nav = page.getByRole('navigation', { name: 'Sezioni della vista', exact: true });
    const title = await page.getByRole('heading', { name: 'Nuova scheda', exact: true }).boundingBox();
    for (const link of await nav.getByRole('link').all()) {
        await assertNotClippedInViewport(link, 'Tab nuova scheda');
        const style = await link.evaluate(element => {
            const css = getComputedStyle(element);
            return { left: element.getBoundingClientRect().left, padding: parseFloat(css.paddingLeft), align: css.justifyContent };
        });
        expect(style.left).toBeGreaterThanOrEqual(title!.x - 1);
        expect(style.padding).toBe(16);
        expect(style.align).toBe('flex-start');
    }
    await expect(page.locator('#documento')).toHaveCSS('border-radius', '0px');
    await expect(page.locator('#documento')).toHaveCSS('box-shadow', 'none');
    expect(await page.locator('#documento').evaluate(element => getComputedStyle(element, '::before').opacity)).toBe('0');
});

test('CSV: selettore italiano da tastiera, stato del file e allineamento alla colonna', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto('/patients/import');
    const panel = page.getByTestId('patient-bulk-import');
    const picker = page.getByRole('button', { name: 'Scegli file CSV', exact: true });
    await expect(picker).toBeEnabled();
    await expect(picker).toHaveAccessibleDescription('Nessun file selezionato');
    await expect(page.getByLabel('File CSV', { exact: true })).toHaveAttribute('type', 'file');
    await expect(page.getByTestId('patient-bulk-file')).toBeHidden();
    const title = await page.getByRole('heading', { name: 'Importa elenco', exact: true }).boundingBox();
    const content = await panel.boundingBox();
    expect(Math.abs(title!.x - content!.x)).toBeLessThanOrEqual(2);
    const download = await page.getByRole('link', { name: 'Scarica modello CSV', exact: true }).boundingBox();
    const field = await picker.boundingBox();
    expect(Math.abs(field!.y + field!.height - download!.y - download!.height)).toBeLessThanOrEqual(2);
    const chooser = page.waitForEvent('filechooser');
    await picker.focus();
    await picker.press('Enter');
    await (await chooser).setFiles({ name: 'elenco-sintetico.csv', mimeType: 'text/csv', buffer: Buffer.from('nome;cognome;codice_fiscale;data_nascita;indirizzo;telefono\r\n') });
    await expect(panel.getByRole('status').filter({ hasText: 'elenco-sintetico.csv' })).toHaveText('elenco-sintetico.csv');
    await expect(picker).toHaveAccessibleDescription('elenco-sintetico.csv');
});
