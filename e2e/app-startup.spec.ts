import { test, expect } from './fixtures/isolated-runtime';

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
