import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

test.describe.configure({ retries: 0 });

async function openSyntheticToolbarPatient(page: Page) {
    const lastName = `Sintetica ${randomUUID().slice(0, 8)}`;
    const documentTimeOrigin = await page.evaluate(() => performance.timeOrigin);
    const navigation = page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
    await navigation.getByRole('link', { name: 'Pazienti', exact: true }).click();
    await page.getByRole('link', { name: 'Nuova scheda', exact: true }).click();
    await page.locator('input[name="firstName"]').fill('Barra');
    await page.locator('input[name="lastName"]').fill(lastName);
    await page.getByLabel('Identificativo', { exact: true }).selectOption('none');
    await page.getByRole('checkbox', { name: 'Conosco solo l’anno' }).check();
    await page.getByRole('spinbutton', { name: 'Anno di nascita stimato' }).fill('1960');
    const [response] = await Promise.all([
        page.waitForResponse(result => new URL(result.url()).pathname === '/api/patients'
            && result.request().method() === 'POST'),
        page.getByRole('button', { name: 'Crea scheda', exact: true }).click(),
    ]);
    expect(response.status()).toBe(201);
    const { id } = await response.json() as { id: string };
    await page.getByRole('searchbox', { name: 'Cerca nella lista pazienti', exact: true }).fill(lastName);
    const patient = page.getByRole('option').filter({ hasText: `${lastName} Barra` });
    await expect(patient).toBeVisible();
    await patient.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/patients/${id}/modules$`));
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentTimeOrigin);
    return id;
}

for (const [width, height] of [[1320, 880], [402, 874]] as const) test(`comandi della scheda a ${width}: una fermata Tab, frecce dentro, azioni raggiungibili`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const id = await openSyntheticToolbarPatient(page);
    const header = page.getByTestId('lume-scheda-header');
    const toolbar = header.getByRole('toolbar', { name: 'Comandi della scheda', exact: true });
    const prescribe = toolbar.getByRole('button', { name: 'Prescrivi', exact: true });
    const entry = toolbar.getByRole('link', { name: 'Nuova voce', exact: true });
    const actions = toolbar.getByRole('button', { name: 'Azioni', exact: true });
    await expect(entry).toBeVisible();
    expect(await toolbar.evaluate(root => [...root.querySelectorAll('a[href], button')].filter(item => !item.closest('[role="menu"]') && item.getClientRects().length > 0)
        .map(item => (item as HTMLElement).tabIndex))).toEqual([0, -1, -1]);

    await header.getByRole('heading', { level: 1 }).focus();
    await page.keyboard.press('Tab');
    await expect(prescribe).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(entry).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(actions).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(prescribe).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(actions).toBeFocused();
    await page.keyboard.press('Home');
    await expect(prescribe).toBeFocused();
    await page.keyboard.press('End');
    await expect(actions).toBeFocused();

    await page.keyboard.press('Tab');
    expect(await toolbar.evaluate(root => root.contains(document.activeElement))).toBe(false);
    await expect(page.getByRole('navigation', { name: 'Sezioni della vista', exact: true }).locator(':focus')).toHaveCount(1);
    await page.keyboard.press('Shift+Tab');
    await expect(actions).toBeFocused();

    await page.keyboard.press('ArrowDown');
    const menu = page.getByRole('menu', { name: 'Azioni scheda', exact: true });
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(actions).toBeFocused();

    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    const prescriptions = page.getByRole('menuitem', { name: 'Prescrizione di una prestazione', exact: true });
    await expect(prescriptions).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(prescriptions).toHaveCount(0);
    await expect(prescribe).toBeFocused();

    await page.keyboard.press('ArrowRight');
    await expect(entry).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/patients/${id}/modules\\?voce=nuova$`));
});
