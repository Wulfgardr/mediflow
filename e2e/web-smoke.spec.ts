/* @Codex */
import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

test('web smoke: unlock/setup + patients filters + settings navigation', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';
  const patientsSearch = page.getByPlaceholder('Cerca paziente...');

  await bootstrapUnlockedSession(page, pin);

  await expect(patientsSearch).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Archiviati' }).click();
  await page.getByRole('button', { name: 'Attivi' }).click();
  await patientsSearch.fill('smoke');
  await patientsSearch.clear();

  await page.getByRole('link', { name: 'Impostazioni' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByText('Impostazioni').first()).toBeVisible();

  await page.getByRole('link', { name: 'Pazienti' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(patientsSearch).toBeVisible();
});
