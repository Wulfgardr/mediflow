import { expect, Locator, Page } from '@playwright/test';
import { generateMasterKey, wrapMasterKeyVersioned } from '../lib/security/security';
import { checkPassphrase } from '../lib/security/unlock-credential';
import { trustedWebRequestHeaders } from './fixtures/trusted-web-request';

/* The widths exercise responsive reflow only. They are intentionally
   not labelled as browser zoom: Playwright does not provide a reliable
   page-zoom primitive for layout assertions in this harness. */
export const REFLOW_PROXY_VIEWPORTS = [
  { viewport: 'reflow-proxy-400', width: 320, height: 760 },
  { viewport: 'phone', width: 390, height: 844 },
  { viewport: 'reflow-proxy-200', width: 768, height: 1024 },
  { viewport: 'wide', width: 1440, height: 960 },
] as const;

export type ReflowProxyViewport = (typeof REFLOW_PROXY_VIEWPORTS)[number];

type OverflowTarget = { label: string; selector: string };

/* ADR 0123: reach a clinical pane through the ordinary section menu,
   including sections disclosed under "Altro". */
export async function openPatientSection(page: Page, id: string): Promise<void> {
  const navigation = page.getByRole('navigation', { name: 'Sezioni della vista', exact: true });
  const link = navigation.locator(`a[href="#${id}"]`);
  await expect(navigation).toBeVisible();
  if (!(await link.isVisible())) await navigation.getByRole('button', { name: 'Altro', exact: true }).click();
  await expect(link).toHaveCount(1);
  await expect(link).toBeVisible();
  await link.click();
  await expect(navigation.locator('[aria-current="location"]:visible')).toHaveCount(1);
  // ordinary sections use navigation state and visibility; the twin-only
  // data-folder-active attribute is not part of their contract.
  const pane = page.locator(`#${id}`);
  await expect(pane).toBeVisible();
}

export async function assertNoHorizontalOverflow(page: Page, targets: readonly OverflowTarget[]): Promise<void> {
  const evidence = await page.evaluate((requestedTargets) => requestedTargets.map(({ label, selector }) => {
    const element = selector === 'document' ? document.documentElement : document.querySelector<HTMLElement>(selector);
    return {
      label,
      delta: element ? element.scrollWidth - element.clientWidth : Number.POSITIVE_INFINITY,
    };
  }), targets);

  for (const target of evidence) {
    expect(target.delta, `Overflow orizzontale su ${target.label}`).toBeLessThanOrEqual(1);
  }
}

export async function assertNotClippedInViewport(locator: Locator, label: string): Promise<void> {
  const box = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width, viewportWidth: window.innerWidth };
  });
  expect(box.width, `${label}: larghezza osservabile`).toBeGreaterThan(0);
  expect(box.left, `${label}: bordo sinistro fuori viewport`).toBeGreaterThanOrEqual(-1);
  expect(box.right, `${label}: bordo destro fuori viewport`).toBeLessThanOrEqual(box.viewportWidth + 1);
}

export async function assertKeyboardFocusProgresses(page: Page, origin: Locator, label: string): Promise<void> {
  await origin.focus();
  await expect(origin, `${label}: focus iniziale`).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await origin.evaluate((element) => document.activeElement === element), `${label}: Tab deve uscire dal controllo`).toBe(false);
  expect(await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement !== document.body), `${label}: Tab deve raggiungere un controllo`).toBe(true);
}

export async function isVisible(locator: Locator, timeout = 1200): Promise<boolean> {
  try {
    await locator.first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

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

async function hasStableUnlockedShell(page: Page): Promise<boolean> {
  if (await hasSecurityOverlay(page)) return false;

  // The lock surface can be absent while SecurityProvider is still resolving
  // the initial auth check. Wait for the authenticated application chrome, or
  // for the authenticated work-profile flow rendered in place of that chrome.
  const [navigationVisible, lockControlVisible, workProfileVisible] = await Promise.all([
    isVisible(page.getByRole('navigation', { name: 'Navigazione principale', exact: true }), 750),
    isVisible(page.getByRole('button', { name: 'Blocca', exact: true }), 750),
    isVisible(page.getByTestId('work-profile-onboarding'), 750),
  ]);

  if (navigationVisible && !lockControlVisible) {
    const navigation = page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
    const mobileMenu = navigation.locator('details').filter({ has: page.getByText('Altro', { exact: true }) });
    const toggle = mobileMenu.locator('summary');
    if (await isVisible(toggle, 250)) {
      const wasOpen = await mobileMenu.getAttribute('open') !== null;
      if (!wasOpen) await toggle.click();
      const lock = mobileMenu.getByRole('button', { name: 'Blocca', exact: true });
      const authenticatedMenu = await isVisible(lock, 250) && await lock.isEnabled();
      if (!wasOpen) await toggle.press('Escape');
      return authenticatedMenu;
    }
  }
  return (navigationVisible && lockControlVisible) || workProfileVisible;
}

/* Compatibility fixture only: legacy PIN accounts are provisioned through the real
   supported API. The dedicated first-use spec qualifies the ordinary v3 wizard. */
export async function completeOnboardingIfNeeded(page: Page, pin: string): Promise<void> {
  const stepProfile = page.getByRole('heading', { name: 'Chi sei?' });
  if (!(await isVisible(stepProfile))) return;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const encryptedMasterKey = await wrapMasterKeyVersioned(await generateMasterKey(), pin, salt);
  const control = await page.request.get('/api/auth/check');
  expect(control.status()).toBe(200);
  const etag = control.headers()['etag'];
  expect(etag).toBeTruthy();
  const response = await page.request.post('/api/auth/setup', {
    headers: { ...trustedWebRequestHeaders(page.url()), 'If-Match': etag, 'Idempotency-Key': crypto.randomUUID() },
    data: { username: 'admin', password: pin, displayName: 'Dr. E2E Smoke', ambulatoryName: 'Ambulatorio E2E',
      encryptedMasterKey, salt: Buffer.from(salt).toString('base64') },
  });
  expect(response.status()).toBe(200);
  await page.reload();
}

export async function unlockIfNeeded(page: Page, pin: string): Promise<void> {
  const lockHeading = page.getByRole('heading', { name: 'Sblocca MediFlow' });
  if (!(await isVisible(lockHeading))) return;

  const pinInput = page.getByLabel('PIN operatore').first();
  const unlockButton = page.getByRole('button', { name: /Sblocca/ }).first();

  /* a tab without its local key first offers explicit session renewal.
     Observe that real UI state and its receipt before entering the PIN. */
  const renew = page.getByRole('button', { name: 'Rinnova accesso', exact: true });
  if (await renew.isVisible() && await renew.isEnabled()) await renew.click();
  await expect(pinInput).toBeEnabled();
  await pinInput.fill(pin);
  await expect(pinInput).toHaveValue(pin);
  await expect(unlockButton).toBeEnabled({ timeout: 5_000 });
  await unlockButton.click();
  const confirm = page.getByRole('button', { name: 'È il mio PIN', exact: true });
  if (checkPassphrase(pin).ok) { await expect(confirm).toBeVisible(); await confirm.click(); }
  await expect(lockHeading).toBeHidden({ timeout: 5_000 });

  const invalidPinError = page.getByText('PIN non valido');
  if (await isVisible(invalidPinError, 500)) {
    throw new Error(`Unable to unlock E2E session with configured PIN "${pin}"`);
  }
}

export async function setupPinLegacyIfNeeded(page: Page, pin: string): Promise<void> {
  const setupHeading = page.getByRole('heading', { name: 'Crea il tuo PIN' });
  if (!(await isVisible(setupHeading))) return;

  const pinInput = page.getByLabel('Nuovo PIN').first();
  const confirmPinInput = page.getByLabel('Conferma PIN').first();
  const setupButton = page.getByRole('button', { name: 'Imposta' }).first();

  await pinInput.fill(pin);
  await confirmPinInput.fill(pin);
  await expect(setupButton).toBeEnabled({ timeout: 5_000 });
  await setupButton.click();
  await page.waitForTimeout(300);
}

export async function bootstrapUnlockedSession(page: Page, pin: string): Promise<void> {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await hasStableUnlockedShell(page)) {
      // unrelated E2E flows use the always-available manual entry.
      if (await isVisible(page.getByTestId('work-profile-onboarding'))) {
        await page.getByRole('link', { name: 'Apri la cartella manualmente' }).click();
      }
      return;
    }

    await completeOnboardingIfNeeded(page, pin);
    await setupPinLegacyIfNeeded(page, pin);
    await unlockIfNeeded(page, pin);
  }

  if (!(await hasStableUnlockedShell(page))) {
    throw new Error('Authenticated application shell is unavailable after E2E bootstrap');
  }
}

async function openAiSettingsPage(page: Page, route: 'funzioni' | 'modelli'): Promise<void> {
  await page.goto(`/settings/ai/${route}`);
  await expect(page).toHaveURL(new RegExp(`/settings/ai/${route}$`));
  // Controls become available only after the stored draft has been applied.
  await expect(page.getByTestId('ai-settings-controls')
    .getByRole('button', { name: route === 'modelli' ? 'Salva configurazione' : 'Salva Configurazione', exact: true })).toBeEnabled();
}

export async function openAiFunzioniSettings(page: Page): Promise<void> {
  await openAiSettingsPage(page, 'funzioni');
}

export async function openAiModelsSettings(page: Page): Promise<void> {
  await openAiSettingsPage(page, 'modelli');
}

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
