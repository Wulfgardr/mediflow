/* @Codex: delay real successful reads; no replacement patient or route payload. */
import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

function barrier() {
  let release = () => {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

test('a patient read completing during navigation cannot restore the previous area', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await page.evaluate(async () => {
    const marker = crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
    const response = await fetch('/api/patients', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: 'Caso navigazione', lastName: `Sintetico ${marker}`, taxCode: `NAV${marker}`, birthDate: '1972-04-12T00:00:00.000Z' }),
    });
    if (!response.ok) throw new Error(`Synthetic navigation fixture: HTTP ${response.status}`);
  });
  await page.waitForLoadState('networkidle');
  const patientsReceived = barrier();
  const releasePatients = barrier();
  const navigationReceived = barrier();
  const releaseNavigation = barrier();
  let delayNavigation = true;
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/patients') {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      patientsReceived.release();
      await releasePatients.promise;
      return route.fulfill({ response });
    }
    if (delayNavigation && request.headers().rsc === '1' && url.pathname === '/' && url.searchParams.get('area') === 'incarico') {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      navigationReceived.release();
      await releaseNavigation.promise;
      return route.fulfill({ response });
    }
    return route.continue();
  });
  try {
    await page.goto('/?area=turno');
    await patientsReceived.promise;
    const navigation = page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
    await expect(page.getByRole('heading', { name: /Agenda di oggi/, level: 1 })).toBeVisible();
    await navigation.getByRole('link', { name: 'Pazienti', exact: true }).click();
    await navigationReceived.promise;
    releasePatients.release();
    // This text is published only after the real patient list has been rendered.
    await expect(page.getByText('Rivedi i passaggi della giornata: i filtri in alto ordinano l’agenda per urgenze, suggerimenti AI e passaggi manuali.', { exact: true })).toBeVisible();
    releaseNavigation.release();
    delayNavigation = false;
    await expect(page.getByRole('heading', { name: /Pazienti in carico/, level: 1 })).toBeVisible();
    await expect(page).toHaveURL(url => url.pathname === '/' && url.searchParams.get('area') === 'incarico');
    await expect(navigation.getByRole('link', { name: 'Pazienti', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.goBack();
    await expect(page.getByRole('heading', { name: /Agenda di oggi/, level: 1 })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole('heading', { name: /Pazienti in carico/, level: 1 })).toBeVisible();
  } finally {
    releasePatients.release();
    releaseNavigation.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
