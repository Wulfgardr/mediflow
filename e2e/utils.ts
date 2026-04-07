/* @Codex */
import { expect, Locator, Page } from '@playwright/test';

/* @Codex */
export async function isVisible(locator: Locator, timeout = 1200): Promise<boolean> {
  try {
    await locator.first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

/* @Codex */
async function hasSecurityOverlay(page: Page): Promise<boolean> {
  const surfaces = await Promise.all([
    isVisible(page.getByRole('heading', { name: 'Chi sei?' }), 250),
    isVisible(page.getByRole('heading', { name: 'Crea il tuo PIN' }), 250),
    isVisible(page.getByRole('heading', { name: 'MediFlow Sicurezza' }), 250),
  ]);

  return surfaces.some(Boolean);
}

/* @Codex */
async function hasStableUnlockedShell(page: Page): Promise<boolean> {
  if (await hasSecurityOverlay(page)) return false;
  await page.waitForTimeout(750);
  return !(await hasSecurityOverlay(page));
}

/* @Codex */
export async function completeOnboardingIfNeeded(page: Page, pin: string): Promise<void> {
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
  await page.waitForTimeout(300);
}

/* @Codex */
export async function unlockIfNeeded(page: Page, pin: string): Promise<void> {
  const lockHeading = page.getByRole('heading', { name: 'MediFlow Sicurezza' });
  if (!(await isVisible(lockHeading))) return;

  const pinInput = page.locator('input[placeholder="Inserisci PIN"]:not([disabled])').first();
  const unlockButton = page.getByRole('button', { name: /Sblocca/ }).first();

  await pinInput.fill(pin);
  await expect(pinInput).toHaveValue(pin);
  await expect(unlockButton).toBeEnabled({ timeout: 5_000 });
  await unlockButton.click();
  await expect(lockHeading).toBeHidden({ timeout: 5_000 });

  const invalidPinError = page.getByText('PIN non valido');
  if (await isVisible(invalidPinError, 500)) {
    throw new Error(`Unable to unlock E2E session with configured PIN "${pin}"`);
  }
}

/* @Codex */
export async function setupPinLegacyIfNeeded(page: Page, pin: string): Promise<void> {
  const setupHeading = page.getByRole('heading', { name: 'Crea il tuo PIN' });
  if (!(await isVisible(setupHeading))) return;

  const pinInput = page.locator('input[placeholder="Inserisci PIN"]:not([disabled])').first();
  const confirmPinInput = page.locator('input[placeholder="Conferma PIN"]:not([disabled])').first();
  const setupButton = page.getByRole('button', { name: /Imposta PIN/ }).first();

  await pinInput.fill(pin);
  await confirmPinInput.fill(pin);
  await expect(setupButton).toBeEnabled({ timeout: 5_000 });
  await setupButton.click();
  await page.waitForTimeout(300);
}

/* @Codex */
export async function bootstrapUnlockedSession(page: Page, pin: string): Promise<void> {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await hasStableUnlockedShell(page)) return;

    await completeOnboardingIfNeeded(page, pin);
    await setupPinLegacyIfNeeded(page, pin);
    await unlockIfNeeded(page, pin);
  }

  if (await hasSecurityOverlay(page)) {
    throw new Error('Security overlay is still visible after E2E bootstrap');
  }
}

/* @Codex */
export async function waitForUnlockedInteractiveShell(page: Page): Promise<void> {
  const securityHeading = page.getByRole('heading', { name: 'MediFlow Sicurezza' });
  const setupHeading = page.getByRole('heading', { name: 'Crea il tuo PIN' });
  const securityOverlay = page.locator('div.fixed.inset-0.z-\\[9999\\]');

  await expect(securityHeading).toBeHidden({ timeout: 10_000 });
  await expect(setupHeading).toBeHidden({ timeout: 10_000 });
  await expect(securityOverlay).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(250);
  await expect(securityOverlay).toHaveCount(0, { timeout: 5_000 });
}
