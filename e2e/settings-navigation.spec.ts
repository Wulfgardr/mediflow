import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

const destinations = [
    '/settings/profilo', '/settings/aspetto', '/settings/ambulatories', '/settings/accesso',
    '/settings/backup', '/settings/compliance', '/settings/repertori', '/settings/ai/fabric',
    '/settings/ai/modelli', '/settings/ai/chatgpt', '/settings/ai/funzioni', '/settings/ai/governance',
    '/settings/diagnostica', '/settings/sviluppo', '/settings/zona-pericolo',
];

for (const width of [1440, 768, 390]) test(`Impostazioni: una navigazione e destinazione corrente a ${width}`, async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    if (process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR || !baseURL
        || new URL(baseURL).hostname !== '127.0.0.1') throw new Error('Runtime sintetico isolato richiesto');
    await page.setViewportSize({ width, height: 1000 });
    await page.route('**/api/siss/session-status', route => route.fulfill({ json: { status: 'unavailable', source: 'synthetic', checkpoints: [] } }));
    await bootstrapUnlockedSession(page, '1234');
    const writes: string[] = [];
    page.on('request', request => { if (['PUT', 'PATCH', 'DELETE'].includes(request.method()) || (request.method() === 'POST' && /^\/api\/(patients|ambulatories)(\/|$)/u.test(new URL(request.url()).pathname))) writes.push(`${request.method()} ${new URL(request.url()).pathname}`); });
    for (const theme of ['giorno', 'grafite']) {
        await page.goto('/settings');
        await page.getByRole('button', { name: theme === 'giorno' ? 'Tema Chiaro' : 'Tema Scuro', exact: true }).click();
        const content = page.getByTestId('settings-subroute-content');
        const sidebar = page.getByTestId('settings-nav-sidebar');
        const navigation = width >= 1024 ? sidebar : content.getByRole('navigation', { name: 'Sezioni', exact: true });
        const hrefs = await navigation.locator('a:visible').evaluateAll(links => links.map(link => link.getAttribute('href')));
        expect(hrefs.sort()).toEqual((width >= 1024 ? ['/settings', ...destinations] : [...destinations]).sort());
        await expect(content.getByRole('link', { name: /Panoramica|Apri aspetto/u })).toHaveCount(0);
        if (width >= 1024) await expect(content.getByRole('navigation')).toBeHidden();
        else await expect(sidebar.locator('a:visible')).toHaveCount(0);
        const rightEdges = await content.locator('[data-lume-control="theme"]:not(button), [data-settings-section] a[href="/settings/diagnostica"]').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().right));
        expect(rightEdges).toHaveLength(2);
        expect(Math.abs(rightEdges[0] - rightEdges[1])).toBeLessThanOrEqual(2);
        await navigation.locator('a[href="/settings/ai/governance"]:visible').click();
        await expect(page).toHaveURL(/\/settings\/ai\/governance$/u);
        const current = sidebar.locator('a[aria-current="page"]:visible');
        await expect(current).toHaveAttribute('href', '/settings/ai/governance');
        const back = content.getByRole('link', { name: 'Torna alle impostazioni', exact: true });
        if (width >= 1024) await expect(back).toBeHidden();
        else {
            await expect.poll(() => current.evaluate(element => {
                const item = element.getBoundingClientRect(), strip = element.parentElement!.getBoundingClientRect();
                return item.left >= strip.left - 1 && item.right <= strip.right + 1;
            })).toBe(true);
            await expect(sidebar.getByText('Scorri per altre sezioni')).toBeVisible();
            const columnLeft = await content.evaluate(element => element.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(element).paddingLeft));
            const arrow = await back.locator('svg').boundingBox();
            expect(Math.abs(columnLeft - arrow!.x)).toBeLessThanOrEqual(2);
        }
        const global = page.getByRole('complementary', { name: 'MediFlow', exact: true });
        await expect(global.locator('[aria-current="page"]:visible')).toHaveCount(1);
        await expect(global.locator('[aria-current="page"]:visible')).toHaveAccessibleName(/Impostazioni/u);
        const appearance = sidebar.locator('a[href="/settings/aspetto"]:visible');
        await appearance.focus(); await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/settings\/aspetto$/u);
        await sidebar.locator('a[href="/settings/ambulatories"]:visible').click();
        const ambulatoryHeading = await content.getByRole('heading', { name: 'Ambulatori', exact: true }).evaluate(element => ({ font: getComputedStyle(element).font, caps: getComputedStyle(element).fontVariantCaps }));
        await sidebar.locator('a[href="/settings/ai/funzioni"]:visible').click();
        const functionsHeading = await content.getByRole('heading', { name: 'Funzioni cliniche', exact: true }).evaluate(element => ({ font: getComputedStyle(element).font, caps: getComputedStyle(element).fontVariantCaps }));
        expect(functionsHeading).toEqual(ambulatoryHeading);
        await expect(content.getByText('Intelligenza locale', { exact: true })).toHaveCount(0);
    }
    expect(writes).toEqual([]);
});
