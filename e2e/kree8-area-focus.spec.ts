/* @Codex */

import { expect, test, type Locator, type Page } from '@playwright/test';

import { bootstrapUnlockedSession } from './utils';

/* @Codex */
async function expectAreaHeadingFocused(
  page: Page,
  area: string,
  heading: Locator,
): Promise<void> {
  await expect(page.getByTestId('lume-frame-canvas')).toHaveAttribute('data-lume-context', area);
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
}

test('le CTA Agenda portano tastiera e focus al titolo della destinazione', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await page.goto('/?area=turno');

  const patientsAction = page.getByRole('button', { name: 'Vai ai pazienti', exact: true });
  await patientsAction.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\?area=incarico(?:&|$)/);
  await expectAreaHeadingFocused(
    page,
    'incarico',
    page.getByRole('heading', { name: /Pazienti in carico/, level: 1 }),
  );

  const agendaNavigation = page.getByRole('button', { name: 'Agenda', exact: true });
  await agendaNavigation.focus();
  await page.keyboard.press('Enter');
  await expectAreaHeadingFocused(
    page,
    'turno',
    page.getByRole('heading', { name: /Agenda di oggi/, level: 1 }),
  );

  const reviewAction = page.getByRole('button', { name: 'Apri revisione', exact: true });
  await reviewAction.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\?area=revisione(?:&|$)/);
  await expectAreaHeadingFocused(
    page,
    'revisione',
    page.getByRole('heading', { name: 'Evidenza, decisione e prossimo passo', level: 1 }),
  );
});

test('la command palette focalizza il titolo quando il comando smonta la CTA sorgente', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await page.goto('/?area=turno');

  const sourceAction = page.getByRole('button', { name: 'Vai ai pazienti', exact: true });
  await sourceAction.focus();
  await expect(sourceAction).toBeFocused();

  await page.keyboard.press('ControlOrMeta+KeyK');
  const commandSearch = page.getByRole('combobox', { name: 'Cerca un comando', exact: true });
  await expect(commandSearch).toBeFocused();
  await commandSearch.fill('Diario');
  await commandSearch.press('Enter');

  await expect(sourceAction).toHaveCount(0);
  await expectAreaHeadingFocused(
    page,
    'diario',
    page.getByRole('heading', { name: /Ultime voci del lavoro clinico/, level: 1 }),
  );
});

test('Apri quadro focalizza la destinazione, la ricerca il proprio campo', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await page.goto('/mockups/kree8');

  const quadroAction = page.getByRole('button', { name: 'Apri quadro', exact: true });
  await quadroAction.focus();
  await page.keyboard.press('Enter');
  await expectAreaHeadingFocused(
    page,
    'scheda',
    page.getByRole('heading', { name: 'M. R.', level: 1 }),
  );

  const patientSearchAction = page.getByRole('button', {
    name: 'Cerca nella lista pazienti',
    exact: true,
  });
  await patientSearchAction.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('lume-frame-canvas')).toHaveAttribute('data-lume-context', 'incarico');
  await expect(page.getByRole('searchbox', { name: 'Cerca nella lista pazienti', exact: true })).toBeFocused();
});
