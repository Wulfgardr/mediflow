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
  // WUL-274/Kree8: the lock chrome moved to the Kree8 lock shell
  // (components/lock-screen.tsx). The unlock title is now "Sblocca MediFlow"
  // and the setup title "Crea il tuo PIN"; the shell root carries
  // aria-label="MediFlow lock screen". "Chi sei?" keys the onboarding wizard.
  const surfaces = await Promise.all([
    isVisible(page.getByRole('heading', { name: 'Chi sei?' }), 250),
    isVisible(page.getByRole('heading', { name: 'Crea il tuo PIN' }), 250),
    isVisible(page.getByRole('heading', { name: 'Sblocca MediFlow' }), 250),
    isVisible(page.getByLabel('MediFlow lock screen'), 250),
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
  const lockHeading = page.getByRole('heading', { name: 'Sblocca MediFlow' });
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
export async function openAiFunzioniSettings(page: Page): Promise<void> {
  // The funzioni page loads the stored kill-switch values asynchronously on mount and
  // overwrites the optimistic switch defaults once the read lands (loadAiConfig in
  // lib/hooks/use-ai-settings-controller.ts). A toggle clicked before that reset gets
  // silently undone. Wait for the last settings read of the load (aiInsightManualConfig,
  // fetched in the final Promise.all) plus a short stabilization delay before letting
  // the caller interact with the switches.
  const settingsSettled = page.waitForResponse((response) =>
    response.url().includes('/api/settings/aiInsightManualConfig')
    && response.request().method() === 'GET'
  );
  await page.goto('/settings/ai/funzioni');
  await expect(page).toHaveURL(/\/settings\/ai\/funzioni$/);
  await settingsSettled;
  await page.waitForTimeout(250);
}

/* @Codex */
export async function setAiLaneKillSwitch(page: Page, key: string, value: 'enabled' | 'disabled'): Promise<void> {
  await page.evaluate(async ({ settingKey, settingValue }) => {
    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: settingKey, value: settingValue }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
  }, { settingKey: key, settingValue: value });
}

/* @Codex */
export async function waitForUnlockedInteractiveShell(page: Page): Promise<void> {
  // WUL-274/Kree8: the lock shell is identified by aria-label="MediFlow lock screen"
  // (components/lock-screen.tsx). The setup and onboarding surfaces are keyed by their
  // headings ("Crea il tuo PIN" and "Chi sei?"). The legacy z-[9999] overlay is gone.
  const lockShell = page.getByLabel('MediFlow lock screen');
  const setupHeading = page.getByRole('heading', { name: 'Crea il tuo PIN' });
  const onboardingHeading = page.getByRole('heading', { name: 'Chi sei?' });

  await expect(lockShell).toHaveCount(0, { timeout: 10_000 });
  await expect(setupHeading).toBeHidden({ timeout: 10_000 });
  await expect(onboardingHeading).toBeHidden({ timeout: 10_000 });
  await page.waitForTimeout(250);
  await expect(lockShell).toHaveCount(0, { timeout: 5_000 });
}
