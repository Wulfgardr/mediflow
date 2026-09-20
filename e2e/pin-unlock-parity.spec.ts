/* @Codex WUL-675: real UI + isolated server; no auth mocks or credential overrides. */
import { randomUUID } from 'node:crypto';
import type { Page, Response } from '@playwright/test';
import { expect, test } from './fixtures/isolated-runtime';

// This is the original Linux reproduction, not process.env.E2E_PIN.
const ALPHANUMERIC_PIN = 'demo086086';
const NUMERIC_PIN = '086086';
const CONTROL_ETAG = /^"[A-Za-z0-9_-]{32,256}"$/u;
type WrappedKey = Readonly<{ encryptedMasterKey: string; salt: string }>;

test.describe.configure({ retries: 0 });

function isPost(response: Response, pathname: string): boolean {
  return response.request().method() === 'POST' && new URL(response.url()).pathname === pathname;
}

async function expectUnlocked(page: Page): Promise<void> {
  await expect(page.getByLabel('MediFlow lock screen', { exact: true })).toHaveCount(0);
  const navigation = page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
  // Use the ordinary manual-entry link, when the authenticated work-profile step is shown.
  const manualEntry = page.getByRole('link', { name: 'Apri la cartella manualmente', exact: true });
  await expect(navigation.or(manualEntry).first()).toBeVisible();
  if (await manualEntry.isVisible()) await manualEntry.click();
  await expect(navigation).toBeVisible();
  expect((await page.request.get('/api/patients')).status()).toBe(200);
}

async function onboard(page: Page, pin: string): Promise<WrappedKey> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Chi sei?', exact: true })).toBeVisible();
  await page.getByLabel('Nome e Cognome', { exact: true }).fill('Dr. PIN Parity Synthetic');
  await page.getByLabel('Nome Ambulatorio', { exact: true }).fill('Ambulatorio PIN Parity Synthetic');
  await page.getByRole('button', { name: 'Avanti', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sicurezza', exact: true })).toBeVisible();
  const first = page.locator('#setup-pin');
  const confirmation = page.locator('#setup-confirm-pin');
  const submit = page.getByRole('button', { name: 'Concludi Setup', exact: true });
  for (const input of [first, confirmation]) {
    await expect(input).toHaveAttribute('type', 'password');
    await expect(input).toHaveAttribute('inputmode', 'text');
  }
  await expect(submit).toBeDisabled();
  await first.fill('abc');
  await confirmation.fill('abc');
  await expect(submit).toBeDisabled();
  await first.fill(pin);
  await confirmation.fill(`${pin}x`);
  await expect(submit).toBeDisabled();
  await expect(page.getByText('I PIN non corrispondono.', { exact: true })).toBeVisible();
  await confirmation.fill(pin);
  await expect(submit).toBeEnabled();
  const responsePromise = page.waitForResponse(response => isPost(response, '/api/auth/setup'));
  await submit.click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ success: true });
  const submitted = response.request().postDataJSON() as WrappedKey & { password: string };
  expect(submitted.password).toBe(pin);
  expect(submitted.encryptedMasterKey).toEqual(expect.any(String));
  expect(submitted.encryptedMasterKey.length).toBeGreaterThan(0);
  expect(submitted.salt).toEqual(expect.any(String));
  expect(submitted.salt.length).toBeGreaterThan(0);
  // The real provider generated/wrapped the key; no substitute crypto blob is supplied.
  await expectUnlocked(page);
  return { encryptedMasterKey: submitted.encryptedMasterKey, salt: submitted.salt };
}

async function expectReadyLock(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Sblocca MediFlow', exact: true })).toBeVisible();
  await expect(page.getByLabel('PIN operatore', { exact: true })).toBeEnabled();
  await expect(page.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toHaveCount(0);
}

async function unlock(page: Page, pin: string, key: WrappedKey, gesture: 'click' | 'enter'): Promise<void> {
  const input = page.getByLabel('PIN operatore', { exact: true });
  await expectReadyLock(page);
  await expect(input).toHaveAttribute('type', 'password');
  await expect(input).toHaveAttribute('inputmode', 'text');
  await input.fill(pin);
  await expect(input).toHaveValue(pin);
  expect(await input.evaluate((element: HTMLInputElement) => ({
    valid: element.checkValidity(), patternMismatch: element.validity.patternMismatch,
    validationEnabled: element.form?.noValidate === false,
  }))).toEqual({ valid: true, patternMismatch: false, validationEnabled: true });
  const submit = page.getByRole('button', { name: 'Sblocca', exact: true });
  await expect(submit).toBeEnabled();
  const responsePromise = page.waitForResponse(response => isPost(response, '/api/auth/login'));
  if (gesture === 'enter') await input.press('Enter');
  else await submit.click();
  const response = await responsePromise;
  expect(response.request().postDataJSON().password).toBe(pin);
  expect(response.status()).toBe(200);
  expect(response.headers().etag).toMatch(CONTROL_ETAG);
  // The same key wrapping must survive lock/reopen, not a reset, migration or new PIN.
  expect(await response.json()).toMatchObject({ success: true, ...key });
  // Navigation is rendered only after the actual provider unwraps the returned master key.
  await expectUnlocked(page);
}

for (const { name, pin } of [
  { name: 'original alphanumeric reproduction', pin: ALPHANUMERIC_PIN },
  { name: 'numeric control including leading zero', pin: NUMERIC_PIN },
]) {
  test(`${name}: ordinary setup, same-PIN lock/unlock and fresh browser context`, async ({ browser, baseURL }) => {
    let key: WrappedKey;
    const initial = await browser.newContext({ baseURL });
    try {
      const page = await initial.newPage();
      key = await onboard(page, pin);
      // Use the real application-lock endpoint from the supplied lifecycle test.
      // Its UI toolbar is outside this capsule; no selector or owner is invented.
      const check = await page.request.get('/api/auth/check', { headers: { 'Cache-Control': 'no-store' } });
      expect(check.status()).toBe(200);
      expect(check.headers().etag).toMatch(CONTROL_ETAG);
      const locked = await page.request.post('/api/auth/lock', { headers: {
        'If-Match': check.headers().etag, 'Idempotency-Key': randomUUID(),
      } });
      expect(locked.status()).toBe(200);
      expect(await locked.json()).toEqual({
        schemaVersion: 'mediflow.application-lock-receipt.v1', state: 'server_invalidation_confirmed',
      });
      expect((await page.request.get('/api/patients')).status()).toBe(401);
      await page.reload();
      await unlock(page, pin, key, 'click');
    } finally {
      await initial.close();
    }
    // No storageState, sessionStorage, cookies or local key copied into the reopened browser.
    const reopened = await browser.newContext({ baseURL });
    try {
      const page = await reopened.newPage();
      await page.goto('/');
      await unlock(page, pin, key, 'enter');
    } finally {
      await reopened.close();
    }
  });
}

/* @Codex: Chromium test-only response gate. The real server has already responded.
   CDP pauses delivery, then continues the UNMODIFIED response. No route(), fulfill(),
   Fetch.fulfillRequest, API replacement, cookie injection or successful-login stub.
   This makes pending/loading checks deterministic without sleeps or timeout changes. */
async function holdRealResponse(
  page: Page, pathname: string, status: number,
  trigger: () => Promise<void>, inspectPending: () => Promise<void>,
): Promise<Response> {
  const cdp = await page.context().newCDPSession(page);
  let held: { requestId: string; status: number | undefined } | undefined;
  const resume = async () => {
    if (!held) return;
    await cdp.send('Fetch.continueRequest', { requestId: held.requestId });
    held = undefined;
  };
  cdp.on('Fetch.requestPaused', event => {
    held = { requestId: event.requestId, status: event.responseStatusCode };
  });
  try {
    await cdp.send('Fetch.enable', { patterns: [{
      urlPattern: new URL(pathname, page.url()).href, requestStage: 'Response',
    }] });
    const responsePromise = page.waitForResponse(response => isPost(response, pathname));
    // Observe rejection too when an earlier assertion fails; the original promise is still awaited.
    void responsePromise.catch(() => undefined);
    await trigger();
    await expect.poll(() => held?.status, 'A real server response must reach the response gate').toBe(status);
    await inspectPending();
    await resume();
    const response = await responsePromise;
    expect(response.status()).toBe(status);
    return response;
  } finally {
    try { await resume(); }
    finally { await cdp.detach(); }
  }
}

test('real renewal: required/pending, short and wrong PIN, loading and focus recovery', async ({ page, browserName }) => {
  expect(browserName, 'Response-gated negative case requires Chromium/CDP; it must not silently skip').toBe('chromium');
  const key = await onboard(page, ALPHANUMERIC_PIN);
  const context = page.context();
  // New page with the real shared cookie, but no opener and no copied tab-local key.
  await page.close();
  const reopened = await context.newPage();
  const loginRequests: string[] = [];
  reopened.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/auth/login') {
      loginRequests.push(request.postDataJSON().password as string);
    }
  });
  try {
    await reopened.goto('/');
    const shell = reopened.getByLabel('MediFlow lock screen', { exact: true });
    const form = shell.locator('form');
    const input = reopened.getByLabel('PIN operatore', { exact: true });
    const renew = reopened.getByRole('button', { name: 'Rinnova accesso', exact: true });
    const submit = shell.locator('button[type="submit"]');
    await expect(reopened.getByText('Una sessione è già attiva. Rinnova l’accesso per usare questa scheda.', { exact: true })).toBeVisible();
    await expect(input).toBeDisabled();
    await expect(submit).toBeDisabled();
    await expect(renew).toBeEnabled();
    // requestSubmit still performs native validation and also exercises the existing handler guard.
    await form.evaluate((element: HTMLFormElement) => element.requestSubmit());
    expect(loginRequests).toEqual([]);

    const receipt = await holdRealResponse(reopened, '/api/auth/lock', 200,
      () => renew.click(), async () => {
        await expect(form).toHaveAttribute('aria-busy', 'true');
        await expect(input).toBeDisabled();
        await expect(submit).toBeDisabled();
        await expect(renew).toBeDisabled();
        await expect(reopened.getByText('Sto chiudendo la sessione precedente…', { exact: true })).toBeVisible();
        await reopened.keyboard.press('Enter');
        await form.evaluate((element: HTMLFormElement) => element.requestSubmit());
        expect(loginRequests).toEqual([]);
        await expect(reopened.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toHaveCount(0);
      });
    expect(await receipt.json()).toEqual({
      schemaVersion: 'mediflow.application-lock-receipt.v1', state: 'server_invalidation_confirmed',
    });
    await expectReadyLock(reopened);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('');
    expect(loginRequests).toEqual([]);
    expect((await reopened.request.get('/api/patients')).status()).toBe(401);

    await input.fill('abc');
    await expect(submit).toBeDisabled();
    await input.press('Enter');
    await expect(input).toHaveValue('abc');
    expect(loginRequests).toEqual([]);
    await expect(shell).toBeVisible();

    const wrong = 'wrong086086';
    await input.fill(wrong);
    await expect(submit).toBeEnabled();
    const denied = await holdRealResponse(reopened, '/api/auth/login', 401,
      () => input.press('Enter'), async () => {
        await expect(input).toBeDisabled();
        await expect(submit).toBeDisabled();
        await expect(form).toHaveAttribute('aria-busy', 'true');
        await reopened.keyboard.press('Enter');
        expect(loginRequests).toEqual([wrong]);
      });
    expect(denied.request().postDataJSON().password).toBe(wrong);
    await expect(reopened.locator('#mediflow-lock-error')).toBeVisible();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    await expect(shell).toBeVisible();
    expect((await reopened.request.get('/api/patients')).status()).toBe(401);
    await unlock(reopened, ALPHANUMERIC_PIN, key, 'enter');
    expect(loginRequests).toEqual([wrong, ALPHANUMERIC_PIN]);
    await expect(reopened.locator('#mediflow-lock-error')).toHaveCount(0);
  } finally {
    await reopened.close();
  }
});
