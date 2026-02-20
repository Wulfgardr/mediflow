/* @Codex */
import { expect, Locator, Page, test } from '@playwright/test';

async function isVisible(locator: Locator, timeout = 1200): Promise<boolean> {
  try {
    await locator.first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

async function completeOnboardingIfNeeded(page: Page, pin: string): Promise<void> {
  const stepProfile = page.getByRole('heading', { name: 'Chi sei?' });
  if (!(await isVisible(stepProfile))) return;

  await page.getByPlaceholder('es. Dott. Leonardo Pegollo').fill('Dr. E2E Smoke');
  await page.getByPlaceholder('es. Studio Medico Centrale').fill('Ambulatorio E2E');
  await page.getByRole('button', { name: 'Avanti' }).click();

  await expect(page.getByRole('heading', { name: 'Ruolo' })).toBeVisible();
  await page.getByRole('button', { name: 'Avanti' }).click();

  await expect(page.getByRole('heading', { name: 'Credenziali di Accesso' })).toBeVisible();
  await page.getByPlaceholder('es. leonardo.pegollo').fill('admin');
  await page.getByPlaceholder('Password sicura').fill('password');
  await page.getByRole('button', { name: 'Avanti' }).click();

  await expect(page.getByRole('heading', { name: 'Sicurezza Locale' })).toBeVisible();
  const pinInputs = page.locator('input[placeholder="••••••"]');
  await pinInputs.nth(0).fill(pin);
  await pinInputs.nth(1).fill(pin);
  await page.getByRole('button', { name: 'Concludi Setup' }).click();
}

async function unlockIfNeeded(page: Page, pin: string): Promise<void> {
  const lockHeading = page.getByRole('heading', { name: 'MediFlow Sicurezza' });
  if (!(await isVisible(lockHeading))) return;

  await page.getByPlaceholder('Inserisci PIN').fill(pin);
  await page.getByRole('button', { name: /Sblocca/i }).click();
}

async function setupPinLegacyIfNeeded(page: Page, pin: string): Promise<void> {
  const setupHeading = page.getByRole('heading', { name: 'Crea il tuo PIN' });
  if (!(await isVisible(setupHeading))) return;

  await page.getByPlaceholder('Inserisci PIN').fill(pin);
  await page.getByPlaceholder('Conferma PIN').fill(pin);
  await page.getByRole('button', { name: 'Imposta PIN' }).click();
}

test('web smoke: unlock/setup + patients filters + settings navigation', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';
  const patientsSearch = page.getByPlaceholder('Cerca per nome, cognome o codice fiscale...');

  await page.goto('/');

  await completeOnboardingIfNeeded(page, pin);
  await setupPinLegacyIfNeeded(page, pin);
  await unlockIfNeeded(page, pin);

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
