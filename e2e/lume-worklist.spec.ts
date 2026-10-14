/* @Codex Punto d’inchiostro: table, keyboard selection and compact navigation. */
import { expect, test, type Page } from '@playwright/test';
import { assertNoHorizontalOverflow, assertNotClippedInViewport, bootstrapUnlockedSession,
  openPatientSection, REFLOW_PROXY_VIEWPORTS } from './utils';

async function openSyntheticWorklist(page: Page, width: number, height: number, theme = 'light') {
  await page.setViewportSize({ width, height });
  await page.addInitScript((value) => localStorage.setItem('mediflow-theme', value), theme);
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const marker = `Ink${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  await page.evaluate(async (lastName) => {
    for (let index = 0; index < 3; index++) {
      const response = await fetch('/api/patients', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: `Caso ${index + 1}`, lastName,
          taxCode: `SYN${lastName.slice(-10)}${index}`, birthDate: '1972-04-12T00:00:00.000Z',
          diagnoses: [{ system: 'ICD-11', code: 'BA00', description: 'Ipertensione sintetica' }],
          notes: 'Cartella inventata per test. Nessun dato reale.' }),
      });
      if (!response.ok) throw new Error(`Fixture: HTTP ${response.status}`);
    }
  }, marker);
  await page.goto('/?area=incarico');
  await expect(page.getByTestId('lume-worklist')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Cerca nella lista pazienti' }).fill(marker);
  await expect(page.getByText('3 risultati', { exact: true })).toBeVisible();
  return marker;
}

for (const theme of ['light', 'dark']) {
  for (const viewport of [...REFLOW_PROXY_VIEWPORTS, { width: 850, height: 900 }]) {
    test(`Punto worklist ${theme} ${viewport.width}px`, async ({ page }) => {
      const marker = await openSyntheticWorklist(page, viewport.width, viewport.height, theme);
      await expect(page.locator('html')).toHaveClass(new RegExp(theme));
      const rows = page.getByTestId('lume-patient-row');
      await expect(rows).toHaveCount(3);
      const first = rows.nth(0), second = rows.nth(1);
      await expect(first).toHaveAccessibleName(new RegExp(`${marker}.*Ipertensione sintetica`));
      await first.focus();
      await first.press('ArrowDown');
      await expect(second).toBeFocused();
      await expect(second).toHaveAttribute('aria-selected', 'true');
      await expect(first).toHaveAttribute('aria-selected', 'false');
      await expect(second).toHaveCSS('box-shadow', 'none');
      await assertNotClippedInViewport(second, 'riga selezionata');
      await assertNoHorizontalOverflow(page, [
        { label: 'documento', selector: 'document' },
        { label: 'elenco', selector: '[data-testid="lume-patient-list"]' },
      ]);
      const search = page.getByRole('searchbox', { name: 'Cerca nella lista pazienti' });
      await search.fill('nessuna corrispondenza sintetica');
      await expect(page.getByText('0 risultati', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Cancella', exact: true }).click();
      await expect(search).toBeFocused();
      await search.fill(marker);
      await expect(rows).toHaveCount(3);
      const name = await first.locator('strong').innerText();
      await first.click();
      if (viewport.width > 850) {
        await expect(page.getByTestId('lume-patient-lens')).toContainText(name);
        await expect(page).toHaveURL(/area=incarico/);
        await first.press('Enter');
      }
      await expect(page).toHaveURL(/\/patients\/[^/]+\/modules$/);
      await expect(page.getByTestId('lume-scheda-header').getByRole('heading', { name, exact: true })).toBeVisible();
      await page.screenshot({ path: test.info().outputPath('scheda.png'), animations: 'disabled' });
      await page.getByRole('navigation', { name: 'Navigazione principale' }).getByRole('link', { name: 'Pazienti', exact: true }).click();
      await expect(search).toHaveValue(marker);
      await expect(page.getByRole('option').filter({ has: page.locator('strong', { hasText: name }) })).toBeFocused();
    });
  }
}

test('menu mobile, sezioni e composizione restano raggiungibili da tastiera', async ({ page }) => {
  await openSyntheticWorklist(page, 390, 844);
  const navigation = page.getByRole('navigation', { name: 'Navigazione principale' });
  const more = navigation.locator('summary');
  await more.focus(); await more.press('Enter');
  const details = navigation.locator('details');
  await expect(details).toHaveAttribute('open', '');
  for (const link of await details.getByRole('link').all()) await assertNotClippedInViewport(link, await link.innerText());
  await more.press('Escape');
  await expect(details).not.toHaveAttribute('open');
  await expect(more).toBeFocused();
  await page.getByRole('option').first().press('Enter');
  await openPatientSection(page, 'documenti');
  await openPatientSection(page, 'siss');
  const header = page.getByTestId('lume-scheda-header');
  const name = await header.getByRole('heading').innerText();
  await header.getByRole('link', { name: 'Nuova voce', exact: true }).click();
  await expect(page.getByTestId('progressive-entry-composer')).toContainText(name);
  await assertNoHorizontalOverflow(page, [{ label: 'compositore', selector: 'document' }]);
});

test('la worklist virtuale attraversa l’indice completo e apre la sola Scheda', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const marker = `VirtualK1${Date.now().toString().slice(-8)}`;
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.evaluate(async (fixtureMarker) => {
    const responses = await Promise.all(Array.from({ length: 120 }, async (_, index) => {
      const response = await fetch('/api/patients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: `Caso ${String(index + 1).padStart(3, '0')}`,
          lastName: fixtureMarker,
          taxCode: `${fixtureMarker.slice(-8)}${String(index).padStart(3, '0')}`,
          birthDate: '1972-04-12T00:00:00.000Z',
        }),
      });
      if (!response.ok) throw new Error(`Fixture virtuale ${index + 1}: HTTP ${response.status}`);
    }));
    await Promise.all(responses);
  }, marker);
  await page.goto('/?area=incarico');

  const listbox = page.getByRole('listbox', { name: 'Elenco pazienti in carico', exact: true });
  await expect(listbox).toBeVisible();
  const search = page.getByRole('searchbox', { name: 'Cerca nella lista pazienti', exact: true });
  await search.fill(marker);
  await expect(page.getByText('120 risultati', { exact: true })).toBeVisible();

  const firstRow = page.getByRole('option').first();
  await firstRow.focus();
  await firstRow.press('End');
  const lastRow = page.locator('[data-patient-index="119"]');
  await expect(lastRow).toBeFocused();
  await expect(lastRow).toHaveAttribute('aria-selected', 'true');
  await expect(lastRow).toHaveAttribute('data-patient-index', '119');

  await page.keyboard.press('PageUp');
  await expect.poll(() => page.evaluate(() => Number(document.activeElement?.getAttribute('data-patient-index'))))
    .toBeLessThan(119);
  const pageUpIndex = await page.evaluate(() => Number(document.activeElement?.getAttribute('data-patient-index')));
  expect(pageUpIndex).toBeGreaterThanOrEqual(0);
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => page.evaluate(() => Number(document.activeElement?.getAttribute('data-patient-index'))))
    .toBe(pageUpIndex - 1);
  await page.keyboard.press('j');
  await page.keyboard.press('k');
  await page.keyboard.press('Home');
  await expect(page.locator('[data-patient-index="0"]')).toBeFocused();
  await page.keyboard.press('PageDown');
  await expect.poll(() => page.evaluate(() => Number(document.activeElement?.getAttribute('data-patient-index'))))
    .toBeGreaterThan(0);
  const pageDownIndex = await page.evaluate(() => Number(document.activeElement?.getAttribute('data-patient-index')));
  await assertNoHorizontalOverflow(page, [
    { label: 'documento worklist virtuale', selector: 'document' },
    { label: 'worklist virtuale', selector: '[data-testid="lume-worklist"]' },
    { label: 'lista virtuale', selector: '[data-testid="lume-patient-list"]' },
  ]);
  await page.screenshot({ path: test.info().outputPath('virtual-wide.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(`[data-patient-index="${pageDownIndex}"]`)).toBeFocused();
  await assertNoHorizontalOverflow(page, [
    { label: 'documento worklist virtuale narrow', selector: 'document' },
    { label: 'worklist virtuale narrow', selector: '[data-testid="lume-worklist"]' },
    { label: 'lista virtuale narrow', selector: '[data-testid="lume-patient-list"]' },
  ]);
  await page.screenshot({ path: test.info().outputPath('virtual-phone.png'), animations: 'disabled' });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('lume-scheda-header')).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
