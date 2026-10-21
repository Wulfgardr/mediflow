import { expect, test } from './fixtures/isolated-runtime';
import { randomUUID } from 'node:crypto';
import { bootstrapUnlockedSession } from './utils';
import { trustedArchiveWebRequestHeaders } from './fixtures/trusted-web-request';

test.describe('IPC-connected plugin runtime', () => {
  test.use({ pluginLocalUiRuntime: true });

  test('plugin confirmation follows the patient folder Privacy mode ON and OFF', async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      const host = window as any;
      host.localUiTestEvents = [];
      host.EventSource = class {
        onmessage?: (event: { data: string }) => void;
        closed = false;
        constructor() { host.localUiTestEvents.push(this); }
        close() { this.closed = true; }
      };
    });
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const headers = await trustedArchiveWebRequestHeaders(page);
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    const firstName = 'Privacy R1', lastName = `Sintetico ${suffix}`;
    const created = await page.request.post('/api/patients', { headers, data: {
      firstName, lastName, taxCode: `R1P${suffix}XXX`,
    } });
    expect(created.status()).toBe(201);
    const patient = await created.json() as { id: string };
    await page.goto(`/patients/${patient.id}/modules`);
    await expect(page.getByTestId('patient-profile-notes')).not.toContainText('Lettura delle note in corso…');
    await expect.poll(() => page.evaluate(() => (window as any).localUiTestEvents?.some((event: any) => !event.closed))).toBe(true);
    const off = page.getByRole('button', { name: 'Disattiva Privacy Mode', exact: true });
    if (await off.isVisible()) await off.click();
    await page.evaluate(() => {
      for (const event of (window as any).localUiTestEvents) if (!event.closed) event.onmessage?.({ data: 'identity' });
    });
    const confirmation = page.getByTestId('plugin-local-ui-navigation').locator('p').first();
    await expect(confirmation).toContainText(`${firstName} ${lastName}`);
    const nameFilter = () => confirmation.evaluate((paragraph, label) => {
      const name = Array.from(paragraph.querySelectorAll('span')).find(element => element.textContent === label) ?? paragraph;
      return getComputedStyle(name).filter;
    }, `${firstName} ${lastName}`);
    expect(await nameFilter()).toBe('none');
    await page.screenshot({ path: testInfo.outputPath('privacy-off.png') });
    await page.getByRole('button', { name: 'Attiva Privacy Mode', exact: true }).click();
    await page.mouse.move(0, 0);
    await expect.poll(() => page.locator('h1 span').first().evaluate(element => getComputedStyle(element).filter)).toBe('blur(5px)');
    await expect.poll(nameFilter).toBe('blur(5px)');
    await page.screenshot({ path: testInfo.outputPath('privacy-on.png') });
    await expect(confirmation).toContainText('conferma sulla cartella aperta di');
    await page.getByRole('button', { name: 'Disattiva Privacy Mode', exact: true }).click();
    await expect.poll(nameFilter).toBe('none');
    await expect(confirmation).toContainText(`${firstName} ${lastName}`);
    await page.screenshot({ path: testInfo.outputPath('privacy-off-again.png') });
  });

  test('plugin landing subscribes while ordinary pages keep their production cache', async ({ page }) => {
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    for (const route of ['/', '/settings']) {
      const response = await page.request.get(route);
      expect(response.status()).toBe(200);
      expect(response.headers()['x-nextjs-cache']).toBe('HIT');
      expect(response.headers()['x-nextjs-prerender']).toMatch(/^1(?:,\s*1)*$/u);
    }
    const subscribed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/plugin-local-ui/events');
    const landing = await page.goto('/plugin-local-ui');
    expect(landing?.headers()['cache-control']).toContain('no-store');
    const events = await subscribed;
    expect(events.status()).toBe(200);
    expect(events.headers()['cache-control']).toContain('no-store');
    const forged = await page.request.get('/api/plugin-local-ui/events', { headers: {
      'sec-fetch-site': 'cross-site', 'data-plugin-local-ui': 'true',
    } });
    expect(forged.status()).toBe(404);
  });
});

test('ordinary runtime makes no plugin event requests and has no console errors', async ({ page }) => {
  const requests: string[] = [], errors: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/plugin-local-ui/events') requests.push(request.url());
  });
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const headers = await trustedArchiveWebRequestHeaders(page);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
  const created = await page.request.post('/api/patients', { headers, data: {
    firstName: 'Navigazione', lastName: `Sintetico ${suffix}`, taxCode: `NAV${suffix}XXX`,
  } });
  expect(created.status()).toBe(201);
  const patient = await created.json() as { id: string };
  await page.goto(`/patients/${patient.id}/modules`);
  await expect(page.getByTestId('patient-profile-notes')).not.toContainText('Lettura delle note in corso…');
  await page.goto('/plugin-local-ui');
  await expect(page.getByRole('heading', { name: 'Continua in MediFlow', exact: true })).toBeVisible();
  const disabled = await page.request.get('/api/plugin-local-ui/events');
  expect(disabled.status()).toBe(404);
  expect(disabled.headers()['cache-control']).toContain('no-store');
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});
