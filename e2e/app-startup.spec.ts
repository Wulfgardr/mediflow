import { test, expect } from './fixtures/isolated-runtime';
import { test as launcherTest } from '@playwright/test';
import http from 'node:http';
import path from 'node:path';
import { createChoiceServer } from '../scripts/mediflow-launcher-page.mjs';

test('slow startup stays readable and an explicit reload reaches setup', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install();
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let firstCheck = true;
    await page.route('**/api/auth/check', async route => {
        if (firstCheck) {
            firstCheck = false;
            await held;
        }
        await route.continue();
    });
    try {
        await page.goto('/');
        await expect(page.getByRole('heading', { name: 'Avvio di MediFlow' })).toBeVisible();
        await expect(page.getByRole('status')).toContainText('Verifico l’accesso');
        await expect(page.locator('[data-testid="onboarding-setup"]')).toHaveCount(0);
        await page.clock.fastForward(12_000);
        await expect(page.getByRole('status')).toContainText('L’avvio sta richiedendo più tempo');
        for (const width of [390, 1280]) {
            await page.setViewportSize({ width, height: 800 });
            await expect(page.getByRole('button', { name: 'Ricarica la pagina' })).toBeVisible();
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        }
        await page.getByRole('button', { name: 'Ricarica la pagina' }).click();
        await expect(page.locator('[data-testid="onboarding-setup"]')).toBeVisible();
        await expect(page.locator('nextjs-error-overlay')).toHaveCount(0);
        expect(errors).toEqual([]);
    } finally {
        release();
        await page.unrouteAll({ behavior: 'wait' });
    }
});

launcherTest.describe('Unified launcher', () => {
launcherTest.use({ extraHTTPHeaders: {} });
launcherTest('launcher choice supports keyboard, both themes and a verified redirect', async ({ page }, testInfo) => {
    const { probeRunningInstance } = await import('../scripts/launcher-helpers.mjs');
    const fingerprint = 'synthetic-launcher@abc123:clean';
    const runtime = http.createServer((_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ revision: 'abc123', sourceFingerprint: fingerprint, fingerprint }));
    });
    await new Promise<void>((resolve, reject) => { runtime.once('error', reject); runtime.listen(0, '127.0.0.1', resolve); });
    const address = runtime.address();
    if (!address || typeof address === 'string') throw new Error('Synthetic runtime address unavailable');
    const target = `http://127.0.0.1:${address.port}`;
    const state = { ready: false, busy: false, url: null as string | null, message: 'Scegli come aprire MediFlow.' };
    let selection: unknown;
    const chooser = await createChoiceServer({ root: path.resolve(__dirname, '..'), state: () => state,
        choose: (choice: string, remember: boolean) => {
            selection = { choice, remember };
            Object.assign(state, { busy: true, message: 'Preparazione di MediFlow.' });
        }, install: () => {}, stop: async () => {} });
    try {
        await page.goto(chooser.url);
        await expect(page.getByRole('heading', { name: 'Avvio', exact: true })).toBeVisible();
        for (const colorScheme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme });
            await page.setViewportSize({ width: colorScheme === 'light' ? 390 : 1280, height: 850 });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            await page.screenshot({ path: testInfo.outputPath(`avvio-${colorScheme}.png`) });
        }
        const remember = page.getByRole('checkbox', { name: 'Ricorda questa scelta al prossimo avvio' });
        await remember.focus();
        await page.keyboard.press('Space');
        const web = page.getByRole('button', { name: /^Nel browser/u });
        await web.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('status')).toHaveText('Preparazione di MediFlow.');
        expect(selection).toEqual({ choice: 'web', remember: true });
        await page.getByRole('link', { name: 'Cambia', exact: true }).click();
        await expect(web).toBeVisible();
        expect((await probeRunningInstance(target, fingerprint)).ok).toBe(true);
        Object.assign(state, { busy: false, ready: true, url: target, message: 'Pronto' });
        await page.goto(chooser.url);
        await page.waitForURL(`${target}/`);
    } finally {
        await chooser.close();
        await new Promise<void>(resolve => { runtime.close(() => resolve()); runtime.closeAllConnections(); });
    }
});
});
