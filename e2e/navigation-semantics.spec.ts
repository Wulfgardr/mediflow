import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

test('la navigazione globale annuncia la destinazione nelle sottoroute e nel menu compatto', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 });
    for (const [path, name] of [['/analytics', 'Analisi'], ['/scales', 'Scale'], ['/settings/accesso', 'Impostazioni']]) {
      await page.goto(path);
      const shell = page.locator('aside').filter({ has: page.getByRole('navigation', { name: 'Navigazione principale', exact: true }) });
      const current = shell.locator('[aria-current="page"]:visible');
      await expect(current).toHaveCount(1);
      if (width === 390) {
        const more = shell.locator('summary');
        await expect(more).toHaveAttribute('aria-current', 'page');
        await more.click();
        await expect(current).toHaveCount(1);
        await expect(shell.getByRole('link', { name, exact: true }).last()).toHaveAttribute('aria-current', 'page');
        await more.press('Escape');
        await expect(more).toHaveAttribute('aria-current', 'page');
      } else await expect(current).toHaveAccessibleName(name);
    }
  }
});

test('la disclosure mantiene il bersaglio minimo nelle impostazioni', async ({ page, browser }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  for (const width of [1440, 700, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/settings/accesso');
    const controls = page.locator('[data-disclosure-control]:visible');
    await expect(controls.first()).toBeVisible();
    for (const control of await controls.all()) {
      await expect(control).toHaveCSS('min-height', width <= 700 ? '44px' : '40px');
      expect(await control.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(width <= 700 ? 44 : 40);
    }
  }
  const context = await browser.newContext({ storageState: await page.context().storageState(), hasTouch: true, viewport: { width: 1440, height: 960 } });
  try {
    const touchPage = await context.newPage();
    await bootstrapUnlockedSession(touchPage, process.env.E2E_PIN || '1234');
    await touchPage.goto('/settings/accesso');
    const controls = touchPage.locator('[data-disclosure-control]:visible');
    await expect(controls.first()).toBeVisible();
    for (const control of await controls.all()) {
      await expect(control).toHaveCSS('min-height', '44px');
      expect(await control.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
  } finally { await context.close(); }
});
