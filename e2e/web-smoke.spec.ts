/* @Codex */
import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

test('web smoke: unlock/setup + patients filters + settings navigation', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';

  // @Codex WUL-55: the locked surface stays terse while retaining an accessible field name.
  await page.goto('/');
  const lockScreen = page.getByLabel('MediFlow lock screen');
  await expect(lockScreen).toBeVisible();
  await expect(lockScreen.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeVisible();
  await expect(lockScreen.getByText(/sessione protetta/i)).toHaveCount(0);
  await expect(lockScreen.getByText(/inserisci (il )?pin/i)).toHaveCount(0);
  await expect(lockScreen.getByText('PIN operatore', { exact: true })).toHaveClass(/sr-only/);
  await expect(lockScreen.getByLabel('PIN operatore')).toBeVisible();

  await bootstrapUnlockedSession(page, pin);

  // WUL-274/Kree8: the patients list moved into the cockpit "incarico" area
  // (components/kree8/areas/incarico-area.tsx). The cockpit toolbar exposes a
  // "Cerca nella lista pazienti" trigger (components/kree8/cockpit-shared.tsx)
  // that focuses the incarico search field (aria-label "Cerca nella lista pazienti").
  await page.getByRole('button', { name: 'Cerca nella lista pazienti' }).click();
  const patientsSearch = page.getByRole('searchbox', { name: 'Cerca nella lista pazienti' });
  await expect(patientsSearch).toBeVisible({ timeout: 20_000 });

  // Scope chips ("Attivi" / "Archivio") replaced the old view-mode toggles.
  await page.getByRole('button', { name: 'Archivio' }).click();
  await page.getByRole('button', { name: 'Attivi' }).click();
  await patientsSearch.fill('smoke');
  await patientsSearch.fill('');

  // WUL-274/Kree8: "Impostazioni" is an in-cockpit governance area reached via the
  // nav rail, which reflects the state into the query string as ?area=governance.
  const settingsNav = page.getByRole('button', { name: 'Impostazioni' }).first();
  await expect(settingsNav).toBeVisible();
  await settingsNav.click();
  await expect(page).toHaveURL(/[?&]area=governance/);
  await expect(page.getByText('Sistema e impostazioni')).toBeVisible();

  // WUL-297: the detailed appearance controls still live on the /settings/aspetto route.
  await page.goto('/settings/aspetto');
  await expect(page).toHaveURL(/\/settings\/aspetto$/);
  await expect(page.getByTestId('settings-nav-sidebar')).toBeVisible();
  await expect(page.getByTestId('settings-appearance-section')).toBeVisible();
  await expect(page.getByTestId('ui-style-runtime-notice')).toBeVisible();
  await expect(page.getByTestId('ui-accessibility-controls')).toBeVisible();

  // WUL-297: settings returns to the cockpit via "Torna ai pazienti" (-> /?area=incarico),
  // which lands directly on the patients list with the search field mounted.
  await page.getByRole('link', { name: 'Torna ai pazienti' }).click();
  await expect(page).toHaveURL(/[?&]area=incarico/);
  await expect(
    page.getByRole('button', { name: 'Cerca nella lista pazienti' })
  ).toBeVisible();
});

/* @Codex */
test('web smoke: Rivedi agenda focuses its controlled heading without leaving turno', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await page.goto('/?area=turno');

  const reviewAgenda = page.getByRole('button', { name: 'Rivedi agenda', exact: true });
  const agendaHeading = page.getByRole('heading', { name: 'Agenda di oggi', exact: true, level: 2 });

  await expect(reviewAgenda).toBeVisible();
  await expect(reviewAgenda).toHaveAttribute('aria-controls', 'turno-agenda-heading');
  await expect(agendaHeading).toHaveAttribute('id', 'turno-agenda-heading');

  await reviewAgenda.focus();
  await expect(reviewAgenda).toBeFocused();

  await page.keyboard.press('Enter');

  await expect(agendaHeading).toBeFocused();
  await expect(agendaHeading).toBeInViewport();
  await expect(page).toHaveURL(/[?&]area=turno(?:&|$)/);
});

/* @Codex */
test('web smoke: synthetic agenda decision CTAs always open their declared context', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await page.goto('/mockups/kree8');

  const agendaNav = page.getByRole('button', { name: /Agenda/ }).first();

  await expect(page.getByRole('button', { name: 'Vai alla revisione', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Apri esenzioni', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Apri documenti', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: /Referto cardiologico/, level: 1 }),
  ).toBeFocused();
  await expect(
    page.getByRole('button', { name: 'Documenti', exact: true }),
  ).toHaveAttribute('aria-current', 'page');

  await agendaNav.click();
  await page.getByRole('button', { name: 'Apri paziente', exact: true }).click();
  const patientLens = page.getByRole('complementary', { name: 'Lente paziente: C. D.' });
  await expect(patientLens).toBeVisible();
  await expect(patientLens.getByRole('heading', { name: 'C. D.', exact: true })).toBeVisible();
  await expect(patientLens.getByText('Esenzione 031', { exact: true })).toBeVisible();

  await agendaNav.click();
  await page.getByRole('button', { name: 'Apri quadro', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Sezioni del paziente' })).toContainText('M. R.');
  await expect(page.getByTestId('lume-quadro')).toContainText('AB-2026-014');
  await expect(page.getByRole('heading', { name: 'M. R.', exact: true, level: 1 })).toBeFocused();
});
