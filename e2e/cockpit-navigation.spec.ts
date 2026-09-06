/* @Codex: delay real successful reads; no replacement patient or route payload. */
import { expect, test, type Page } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

function barrier() {
  let release = () => {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function createPatients(page: Page, count: number): Promise<string> {
  return page.evaluate(async number => {
    const marker = crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
    for (let index = 0; index < number; index += 1) {
      const response = await fetch('/api/patients', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: `Caso navigazione ${index}`, lastName: `Sintetico ${marker}`, taxCode: `NAV${marker}${index}`, birthDate: '1972-04-12T00:00:00.000Z' }),
      });
      if (!response.ok) throw new Error(`Synthetic navigation fixture: HTTP ${response.status}`);
    }
    return marker;
  }, count);
}

test('a patient read completing during navigation cannot restore the previous area', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await createPatients(page, 1);
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

test('deferred row focus yields to a newer focus outside the list', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const marker = await createPatients(page, 2);
  await page.goto('/?area=incarico');
  await page.getByRole('searchbox', { name: 'Cerca nella lista pazienti', exact: true }).fill(marker);
  const rows = page.getByTestId('lume-patient-row');
  await expect(rows).toHaveCount(2);
  await rows.first().focus();
  // Hold browser animation callbacks to exercise a newer focus before the
  // pending virtual-row focus runs. Keyboard and application handlers are real.
  await page.evaluate(() => {
    const originalRequest = window.requestAnimationFrame.bind(window);
    const originalCancel = window.cancelAnimationFrame.bind(window);
    const callbacks = new Map<number, () => void>();
    let held = true;
    window.requestAnimationFrame = callback => {
      const id = originalRequest(time => {
        if (held) callbacks.set(id, () => callback(time));
        else callback(time);
      });
      return id;
    };
    window.cancelAnimationFrame = id => { callbacks.delete(id); originalCancel(id); };
    Object.assign(window, {
      heldNavigationFrames: () => callbacks.size,
      releaseNavigationFrames: () => {
        held = false;
        window.requestAnimationFrame = originalRequest;
        window.cancelAnimationFrame = originalCancel;
        const pending = [...callbacks.values()];
        callbacks.clear();
        for (const callback of pending) callback();
      },
    });
  });
  const release = () => page.evaluate(() => {
    (window as unknown as { releaseNavigationFrames: () => void }).releaseNavigationFrames();
  });
  try {
    await rows.first().press('ArrowDown');
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { heldNavigationFrames: () => number }).heldNavigationFrames(),
    )).toBeGreaterThan(0);
    const create = page.getByRole('link', { name: 'Nuova scheda', exact: true });
    await create.focus();
    await expect(create).toBeFocused();
    await release();
    await expect(create).toBeFocused();
  } finally {
    await release();
  }
});
