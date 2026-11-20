import { expect, test, type Page } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

test.describe.configure({ retries: 0 });

async function syntheticPatient(page: Page) {
    return page.evaluate(async () => {
        const response = await fetch('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName: 'Barra', lastName: `Sintetica ${crypto.randomUUID().slice(0, 4)}`, identifierType: 'none', taxCode: '', birthDatePrecision: 'estimated', birthYear: 1960 }) });
        if (!response.ok) throw new Error(`Paziente sintetico: ${response.status}`);
        return (await response.json() as { id: string }).id;
    });
}

for (const [width, height] of [[1320, 880], [402, 874]] as const) test(`comandi della scheda a ${width}: una fermata Tab, frecce dentro, azioni raggiungibili`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const id = await syntheticPatient(page);
    await page.goto(`/patients/${id}/modules`);
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
