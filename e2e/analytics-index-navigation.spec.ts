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

test('Analisi: l’indice si presenta come indice della pagina, non come una serie di schede', async ({ page }) => {
  await page.goto('/analytics');
  await unlockIfNeeded(page, pin);
  await expect(index(page).getByText('In questa pagina', { exact: true })).toBeVisible();
  await index(page).getByRole('link', { name: 'Diagnosi', exact: true }).click();
  await expectArrival(page, destinations[2]);
  const appearance = await index(page).getByRole('link').evaluateAll(links => links.map(link => {
    const style = getComputedStyle(link);
    const box = link.getBoundingClientRect();
    return { current: link.hasAttribute('aria-current'), weight: style.fontWeight, underline: style.boxShadow, width: box.width, height: box.height };
  }));
  expect(appearance.filter(link => link.current)).toHaveLength(1);
  for (const link of appearance) {
    expect(link.weight).toBe(link.current ? '600' : '400');
    expect(link.underline).toBe('none');
    expect(link.width).toBeGreaterThanOrEqual(40);
    expect(link.height).toBeGreaterThanOrEqual(40);
  }
  const widths = () => index(page).getByRole('link').evaluateAll(links => links.map(link => link.getBoundingClientRect().width));
  const before = await widths();
  await index(page).getByRole('link', { name: 'Audit', exact: true }).click();
  await expectArrival(page, destinations[3]);
  expect(await widths()).toEqual(before);
});

test('Analisi: dopo la scelta, lo scorrimento restituisce l’indice alla posizione letta', async ({ page }) => {
  await page.goto('/analytics');
  await unlockIfNeeded(page, pin);
  await index(page).getByRole('link', { name: 'Audit', exact: true }).click();
  await expectArrival(page, destinations[3]);
  await page.locator('#audit').hover();
  await page.mouse.wheel(0, -4000);
  await expect(index(page).locator('[aria-current]')).toHaveText([/^Popolazione/u]);
});

for (const action of ['Indietro', 'Apri in nuova scheda'] as const) {
  test(`Analisi: ${action} conserva la posizione quando arriva il conteggio audit`, async ({ page }) => {
    let releaseAudit = () => {};
    const auditHeld = new Promise<void>(resolve => { releaseAudit = resolve; });
    await page.route('**/api/system/audit?**', async route => { await auditHeld; await route.continue(); });
    try {
      await page.goto('/analytics');
      await unlockIfNeeded(page, pin);
      const auditLink = index(page).getByRole('link', { name: 'Audit', exact: true });
      const population = index(page).getByRole('link', { name: 'Popolazione', exact: true });
      await expect(population).toHaveAttribute('aria-current', 'location');
      await expect(page.locator('#audit')).toBeAttached();
      if (action === 'Indietro') {
        await auditLink.click();
        await expectArrival(page, destinations[3]);
        await Promise.all([
          page.evaluate(() => new Promise<void>(resolve => window.addEventListener('hashchange', () => resolve(), { once: true }))),
          page.goBack(),
        ]);
        await page.locator('#domanda').evaluate(element => element.scrollIntoView({ block: 'start' }));
      } else {
        const [otherTab] = await Promise.all([
          page.context().waitForEvent('page'),
          auditLink.click({ modifiers: ['ControlOrMeta'] }),
        ]);
        await otherTab.close();
      }
      await expect(page).toHaveURL(/\/analytics$/u);
      releaseAudit();
      await expect(page.locator('#audit').getByText('Eventi locali registrati', { exact: true })).toBeVisible();
      await expect(population).toHaveAttribute('aria-current', 'location');
      await expect(page.getByRole('heading', { name: 'Schede attive nel filtro', exact: true })).toBeInViewport();
    } finally {
      releaseAudit();
    }
  });
}
