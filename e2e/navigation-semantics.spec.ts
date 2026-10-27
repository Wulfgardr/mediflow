import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

test('la navigazione globale annuncia la destinazione nelle sottoroute e nel menu compatto', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const patientId = await page.evaluate(async () => {
    const response = await fetch('/api/patients', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: 'Navigazione', lastName: 'Sintetico', taxCode: `NAV${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`, birthDate: '1972-04-12T00:00:00.000Z' }),
    });
    if (!response.ok) throw new Error(`Synthetic patient: HTTP ${response.status}`);
    return (await response.json()).id as string;
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 });
    for (const [path, name] of [[`/patients/${patientId}/modules`, 'Pazienti'], ['/?area=incarico', 'Pazienti'], ['/?area=turno', 'Agenda'], ['/?area=diario', 'Diario'], ['/?area=repertori', 'Repertori'], ['/analytics', 'Analisi'], ['/scales', 'Scale'], ['/settings/accesso', 'Impostazioni'], ['/settings/ai/modelli/?q=/settings-x#analytics-x', 'Impostazioni']]) {
      await page.goto(path);
      const shell = page.locator('aside').filter({ has: page.getByRole('navigation', { name: 'Navigazione principale', exact: true }) });
      const current = shell.locator('[aria-current="page"]:visible');
      await expect(current).toHaveCount(1);
      if (width === 390 && ['Repertori', 'Analisi', 'Scale', 'Impostazioni'].includes(name)) {
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

test('A1: nessuna voce corrente per falsi prefissi o route senza destinazione', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/settings/accesso');
    const shell = page.locator('aside').filter({ has: page.getByRole('navigation', { name: 'Navigazione principale', exact: true }) });
    await expect(shell.locator('[aria-current="page"]:visible')).toHaveCount(1);
    for (const path of ['/settings-x', '/analytics-x', '/scales-x', '/patients-x', '/unknown']) {
      for (const suffix of ['', '/', '?next=/settings', '#analytics']) {
        await page.evaluate(url => window.history.pushState(null, '', url), path + suffix);
        await expect(shell.locator('[aria-current="page"]:visible')).toHaveCount(0);
        if (width === 390) {
          await shell.locator('summary').click();
          await expect(shell.locator('[aria-current="page"]:visible')).toHaveCount(0);
          await shell.locator('summary').press('Escape');
        }
      }
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
      await expect(control).toHaveCSS('min-height', '44px');
      expect(await control.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
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
