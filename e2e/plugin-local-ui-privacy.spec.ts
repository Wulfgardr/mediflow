import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { bootstrapUnlockedSession } from './utils';
import { trustedArchiveWebRequestHeaders } from './fixtures/trusted-web-request';

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
