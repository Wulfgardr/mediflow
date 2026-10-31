import { expect, test } from '@playwright/test';
import { openTreatmentReasoningDenial } from './fixtures/treatment-reasoning-denial';
import { assertNoHorizontalOverflow, assertNotClippedInViewport } from './utils';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';

test('Terapie conserva registro e gerarchia con Treatment Reasoning indisponibile', async ({ page }) => {
  const run = await openTreatmentReasoningDenial(page);
  try {
    const therapies = page.locator('#terapie');
    await expect(therapies.getByRole('heading', { level: 3 })).toHaveText([/^Terapie farmacologiche\s*1 attiva$/, 'Guida alla prescrizione', 'Attive', 'Proposte']);
    await expect(therapies.getByRole('heading')).toHaveCount(4);
    await expect(therapies.locator('[data-clinical-register="therapies"]')).toContainText('Farmaco sintetico locale');
    await run.proposals.click();
    await expect(run.proposals).toHaveAttribute('aria-expanded', 'false');
    await expect(run.panel).toBeHidden();
    await run.proposals.click();
    await run.assertDenied();
  } finally { run.restore(); }
});

for (const theme of ['light', 'dark']) for (const size of ['1440', '768', '390', '320', 'zoom-200', 'zoom-400']) {
  test(`diniego Treatment Reasoning ${theme} ${size}`, async ({ page: ownedPage, baseURL }) => {
    const zoom = size.startsWith('zoom') ? await openBrowserZoomFixture(baseURL!) : null;
    const page = zoom?.page ?? ownedPage;
    let run: Awaited<ReturnType<typeof openTreatmentReasoningDenial>> | undefined;
    try {
      await page.setViewportSize({ width: zoom ? 1440 : Number(size), height: 1000 });
      run = await openTreatmentReasoningDenial(page);
      await page.evaluate(theme => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        document.documentElement.classList.toggle('light', theme === 'light');
      }, theme);
      if (zoom) await zoom.setZoom(size === 'zoom-200' ? 2 : 4);
      const notice = run.panel.getByText('Non disponibile in questa versione', { exact: true });
      await notice.scrollIntoViewIfNeeded();
      await assertNotClippedInViewport(notice, 'Diniego Treatment Reasoning');
      await assertNoHorizontalOverflow(page, [{ label: 'documento', selector: 'document' }, { label: 'proposte', selector: '[data-testid="treatment-reasoning-panel"]' }]);
      await run.assertDenied();
    } finally { run?.restore(); await zoom?.close(); }
  });
}

test.describe('Proposte al tocco', () => {
  test.use({ hasTouch: true });
  test('disclosure raggiungibile e diniego senza generazione', async ({ page }) => {
    const run = await openTreatmentReasoningDenial(page);
    try {
      expect(await run.proposals.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      await run.proposals.tap(); await run.proposals.tap();
      await run.assertDenied();
    } finally { run.restore(); }
  });
});
