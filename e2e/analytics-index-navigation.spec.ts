import { expect, test, type Page } from '@playwright/test';
import { bootstrapUnlockedSession, unlockIfNeeded } from './utils';

test.describe.configure({ retries: 0 });

const pin = process.env.E2E_PIN || '1234';
const destinations = [
  { label: 'Indicatori', id: 'indicatori' },
  { label: 'Età', id: 'eta' },
  { label: 'Diagnosi', id: 'diagnosi' },
  { label: 'Audit', id: 'audit' },
] as const;

const index = (page: Page) => page.getByRole('navigation', { name: 'Sezioni della vista' });

async function expectArrival(page: Page, destination: (typeof destinations)[number]) {
  await expect(page).toHaveURL(new RegExp(`#${destination.id}$`, 'u'));
  await expect(index(page).locator('[aria-current]')).toHaveText([new RegExp(`^${destination.label}`, 'u')]);
  await expect.poll(() => page.evaluate(id => {
    const heading = document.querySelector(`#${id} h2`);
    const bar = document.querySelector('nav[aria-label="Sezioni della vista"]');
    if (!heading || !bar) return 'missing';
    const rect = heading.getBoundingClientRect();
    return rect.top >= bar.getBoundingClientRect().bottom - 1 && rect.bottom <= window.innerHeight ? 'visible' : 'hidden';
  }, destination.id)).toBe('visible');
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 620 });
  await bootstrapUnlockedSession(page, pin);
});

for (const input of ['mouse', 'tastiera'] as const) {
  test(`Analisi: l'indice porta alla sezione scelta e la segna, ${input}`, async ({ page }) => {
    await page.goto('/analytics');
    await unlockIfNeeded(page, pin);
    await expect(index(page).getByRole('link', { name: 'Popolazione', exact: true })).toHaveAttribute('aria-current', 'location');
    await expect(page.locator('#audit')).toBeVisible();
    for (const destination of destinations) {
      const link = index(page).getByRole('link', { name: destination.label, exact: true });
      if (input === 'mouse') await link.click();
      else { await link.focus(); await page.keyboard.press('Enter'); }
      await expectArrival(page, destination);
    }
  });
}

for (const destination of destinations) {
  test(`Analisi: l'arrivo diretto su #${destination.id} mostra la sezione dopo il caricamento`, async ({ page }) => {
    let releaseAudit = () => {};
    const auditHeld = new Promise<void>(resolve => { releaseAudit = resolve; });
    await page.route('**/api/system/audit?**', async route => { await auditHeld; await route.continue(); });
    await page.goto(`/analytics#${destination.id}`);
    await unlockIfNeeded(page, pin);
    await expect(page.locator(`#${destination.id}`)).toBeVisible();
    releaseAudit();
    await expect(page.locator('#audit').getByText('Eventi locali registrati', { exact: true })).toBeVisible();
    await expectArrival(page, destination);
  });
}

test('Analisi: dopo la scelta, lo scorrimento restituisce l’indice alla posizione letta', async ({ page }) => {
  await page.goto('/analytics');
  await unlockIfNeeded(page, pin);
  await index(page).getByRole('link', { name: 'Audit', exact: true }).click();
  await expectArrival(page, destinations[3]);
  await page.locator('#audit').hover();
  await page.mouse.wheel(0, -4000);
  await expect(index(page).locator('[aria-current]')).toHaveText([/^Popolazione/u]);
});
