import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

test('two profile editors retain a conflicting draft, reread explicitly and save canonical values', async ({ browser, baseURL }, testInfo) => {
    const contextA = await browser.newContext({ baseURL });
    const contextB = await browser.newContext({ baseURL });
    try {
        const a = await contextA.newPage();
        const b = await contextB.newPage();
        await bootstrapUnlockedSession(a, '1234');
        await bootstrapUnlockedSession(b, '1234');
        await a.goto('/settings/profilo');
        await b.goto('/settings/profilo');
        const saveA = a.getByRole('button', { name: 'Salva profilo', exact: true });
        const saveB = b.getByRole('button', { name: 'Salva profilo', exact: true });
        await expect(saveA).toBeEnabled();
        await expect(saveB).toBeEnabled();
        await a.getByLabel('Nome medico', { exact: true }).fill('  Medico sintetico primo client  ');
        const saved = a.waitForResponse(response => response.url().endsWith('/api/auth/profile') && response.request().method() === 'PUT');
        await saveA.click();
        const first = await saved;
        expect(first.status()).toBe(200);
        expect(first.request().postDataJSON()).not.toHaveProperty('id');
        expect(first.request().postDataJSON().expectedVersion).toBeTruthy();
        expect((await first.json()).changed).toBe(true);
        await expect(a.getByLabel('Nome medico', { exact: true })).toHaveValue('Medico sintetico primo client');
        await b.getByLabel('Nome medico', { exact: true }).fill('Bozza sintetica secondo client');
        await saveB.click();
        await expect(b.getByRole('status').filter({ hasText: 'Il profilo è cambiato' })).toBeVisible();
        await expect(b.getByLabel('Nome medico', { exact: true })).toHaveValue('Bozza sintetica secondo client');
        await expect(saveB).toBeDisabled();
        await expect(b.getByText('Valori salvati:', { exact: false })).toContainText('Medico sintetico primo client');
        await testInfo.attach('profile-conflict', { body: await b.screenshot({ fullPage: true }), contentType: 'image/png' });
        await b.getByRole('button', { name: 'Rileggi profilo mantenendo la bozza' }).click();
        await expect(saveB).toBeEnabled();
        await expect(b.getByLabel('Nome medico', { exact: true })).toHaveValue('Bozza sintetica secondo client');
        await saveB.click();
        await expect(b.getByRole('status').filter({ hasText: 'Profilo aggiornato.' })).toBeVisible();
        await b.reload();
        await expect(b.getByLabel('Nome medico', { exact: true })).toHaveValue('Bozza sintetica secondo client');
        await expect(saveB).toBeEnabled();
        await saveB.click();
        await expect(b.getByRole('status').filter({ hasText: 'Il profilo è già aggiornato.' })).toBeVisible();
        await b.setViewportSize({ width: 390, height: 844 });
        await expect(b.getByRole('button', { name: 'Rileggi profilo mantenendo la bozza' })).toBeVisible();
        expect(await b.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await testInfo.attach('profile-phone', { body: await b.screenshot({ fullPage: true }), contentType: 'image/png' });
    } finally {
        await contextA.close();
        await contextB.close();
    }
});

test('a lost save response preserves draft and requires reread without a second PUT', async ({ page }) => {
    await bootstrapUnlockedSession(page, '1234');
    await page.goto('/settings/profilo');
    const save = page.getByRole('button', { name: 'Salva profilo', exact: true });
    await expect(save).toBeEnabled();
    await page.getByLabel('Nome medico', { exact: true }).fill('Bozza con risposta persa');
    let puts = 0;
    await page.route('**/api/auth/profile', async route => {
        if (route.request().method() !== 'PUT') return route.continue();
        puts++;
        await route.fetch();
        await route.abort('failed');
    });
    await save.click();
    await expect(page.getByRole('status').filter({ hasText: 'Salvataggio non confermato' })).toBeVisible();
    await expect(save).toBeDisabled();
    await expect(page.getByLabel('Nome medico', { exact: true })).toHaveValue('Bozza con risposta persa');
    expect(puts).toBe(1);
    await page.unroute('**/api/auth/profile');
    await page.getByRole('button', { name: 'Rileggi profilo mantenendo la bozza' }).click();
    await expect(save).toBeEnabled();
    await expect(page.getByText('Valori salvati:', { exact: false })).toContainText('Bozza con risposta persa');
    await save.click();
    await expect(page.getByRole('status').filter({ hasText: 'Il profilo è già aggiornato.' })).toBeVisible();
});

test('same-account login in another tab preserves draft and requires an explicit profile read', async ({ page, context }) => {
    await bootstrapUnlockedSession(page, '1234');
    await page.goto('/settings/profilo');
    const save = page.getByRole('button', { name: 'Salva profilo', exact: true });
    await expect(save).toBeEnabled();
    await page.getByLabel('Nome medico', { exact: true }).fill('Bozza prima del cambio sessione');
    let reads = 0;
    let writes = 0;
    page.on('request', request => {
        if (new URL(request.url()).pathname !== '/api/auth/profile') return;
        if (request.method() === 'GET') reads++;
        if (request.method() === 'PUT') writes++;
    });
    const other = await context.newPage();
    try {
        await bootstrapUnlockedSession(other, '1234');
        const checked = page.waitForResponse(response => response.url().endsWith('/api/auth/check'));
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        expect((await (await checked).json()).hasSession).toBe(true);
        await expect(page.getByRole('status').filter({ hasText: 'La sessione è cambiata' })).toBeVisible();
        await expect(save).toBeDisabled();
        await expect(page.getByLabel('Nome medico', { exact: true })).toHaveValue('Bozza prima del cambio sessione');
        expect(reads).toBe(0);
        expect(writes).toBe(0);
        await page.getByRole('button', { name: 'Rileggi profilo mantenendo la bozza' }).click();
        await expect(save).toBeEnabled();
        await expect(page.getByLabel('Nome medico', { exact: true })).toHaveValue('Bozza prima del cambio sessione');
        expect(reads).toBe(1);
        expect(writes).toBe(0);
        await save.click();
        await expect(page.getByRole('status').filter({ hasText: 'Profilo aggiornato.' })).toBeVisible();
        expect(writes).toBe(1);
    } finally { await other.close(); }
});

test('CI_SHARD_FALSIFICATION_RED', () => {
    throw new Error('CI_SHARD_FALSIFICATION_RED');
});
