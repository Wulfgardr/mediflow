/* @Codex */
import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

test('web smoke: unlock/setup + patients filters + settings navigation', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';

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
