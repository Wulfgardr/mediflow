/* @Codex */
import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

test('web smoke: unlock/setup + patients filters + settings navigation', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';
  const patientsSearch = page.getByTestId('patients-search-input');

  await bootstrapUnlockedSession(page, pin);

  await expect(patientsSearch).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('patients-view-mode-archived').click();
  await page.getByTestId('patients-view-mode-active').click();
  await patientsSearch.fill('smoke');
  await patientsSearch.clear();

  const settingsLink = page.getByRole('link', { name: 'Impostazioni' }).first();
  await expect(settingsLink).toBeVisible();
  await settingsLink.click();
  if (!/\/settings$/.test(page.url())) {
    await settingsLink.click();
  }
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByText('Impostazioni').first()).toBeVisible();
  await expect(page.getByTestId('settings-appearance-section')).toBeVisible();
  await expect(page.getByTestId('ui-style-runtime-notice')).toBeVisible();
  await expect(page.getByTestId('ui-accessibility-controls')).toBeVisible();

  await page.getByRole('link', { name: 'Pazienti' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(patientsSearch).toBeVisible();
});
