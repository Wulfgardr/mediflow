import type { Page, Request, Response } from '@playwright/test';
import { expect, test } from './fixtures/isolated-runtime';
import { documentRequests } from './fixtures/trusted-web-request';
import { bootstrapUnlockedSession } from './utils';

const ALPHANUMERIC_PIN = 'demo086086';
const NUMERIC_PIN = '086086';
const CONTROL_ETAG = /^"[A-Za-z0-9_-]{32,256}"$/u;

test.describe.configure({ retries: 0 });

function isPost(response: Response, pathname: string): boolean {
  return response.request().method() === 'POST' && new URL(response.url()).pathname === pathname;
}

async function expectUnlocked(page: Page): Promise<void> {
  await expect(page.getByLabel('MediFlow lock screen', { exact: true })).toHaveCount(0);
  const navigation = page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
  const manualEntry = page.getByRole('link', { name: 'Apri la cartella manualmente', exact: true });
  await expect(navigation.or(manualEntry).first()).toBeVisible();
  if (await manualEntry.isVisible()) await manualEntry.click();
  await expect(navigation).toBeVisible();
  expect((await documentRequests(page).get('/api/patients')).status()).toBe(200);
}

async function openLegacyPinArchive(page: Page, pin: string): Promise<void> {
  const responsePromise = page.waitForResponse(response => isPost(response, '/api/auth/login'));
  await bootstrapUnlockedSession(page, pin);
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON().password).toBe(pin);
  expect(await response.json()).toMatchObject({
    encryptedMasterKey: expect.stringMatching(/\S+/u), salt: expect.stringMatching(/\S+/u),
  });
  await expect(page.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toBeVisible();
  expect((await documentRequests(page).get('/api/patients')).status()).toBe(200);
}

async function expectReadyLock(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Sblocca MediFlow', exact: true })).toBeVisible();
  await expect(page.getByLabel('PIN operatore', { exact: true })).toBeEnabled();
  await expect(page.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toHaveCount(0);
}

async function unlock(page: Page, pin: string, gesture: 'click' | 'enter'): Promise<void> {
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
  expect(await response.json()).toMatchObject({
    success: true, encryptedMasterKey: expect.stringMatching(/\S+/u), salt: expect.stringMatching(/\S+/u),
  });
  await expectUnlocked(page);
}

const alphanumeric = test.extend({ existingPin: ALPHANUMERIC_PIN });
const numeric = test.extend({ existingPin: NUMERIC_PIN });
for (const { name, pin, pinAccount } of [
  { name: 'legacy alphanumeric PIN', pin: ALPHANUMERIC_PIN, pinAccount: alphanumeric },
  { name: 'numeric control including leading zero', pin: NUMERIC_PIN, pinAccount: numeric },
]) {
  pinAccount(`${name}: legacy PIN archive, same-PIN lock/unlock and fresh browser context`, async ({ browser, baseURL }) => {
    const initial = await browser.newContext({ baseURL });
    try {
      const page = await initial.newPage();
      await openLegacyPinArchive(page, pin);
      const check = await page.evaluate(async () => {
        const reply = await fetch('/api/auth/check', { cache: 'no-store' });
        const { status, hasSession } = await reply.json();
        return { code: reply.status, etag: reply.headers.get('etag'), status, hasSession };
      });
      expect(check).toMatchObject({ code: 200, status: 'ok', etag: expect.stringMatching(CONTROL_ETAG), hasSession: true });
      const receipt = page.waitForResponse(response => isPost(response, '/api/auth/lock'));
      await page.getByRole('button', { name: 'Blocca', exact: true }).click();
      const locked = await receipt;
      expect(locked.status()).toBe(200);
      expect(await locked.json()).toEqual({
        schemaVersion: 'mediflow.application-lock-receipt.v1', state: 'server_invalidation_confirmed',
      });
      expect((await documentRequests(page).get('/api/patients')).status()).toBe(401);
      await page.reload();
      await unlock(page, pin, 'click');
    } finally {
      await initial.close();
    }
    const reopened = await browser.newContext({ baseURL });
    try {
      const page = await reopened.newPage();
      await page.goto('/');
      await unlock(page, pin, 'enter');
    } finally {
      await reopened.close();
    }
  });
}

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

alphanumeric('explicit lock and PIN recovery: pending, short and wrong PIN, loading and focus recovery', async ({ page, browserName }) => {
  expect(browserName, 'Response-gated negative case requires Chromium/CDP; it must not silently skip').toBe('chromium');
  await openLegacyPinArchive(page, ALPHANUMERIC_PIN);
  const loginRequests: string[] = [];
  const observeLogin = (request: Request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/auth/login') {
      loginRequests.push(request.postDataJSON().password as string);
    }
  };
  page.on('request', observeLogin);
  try {
    const shell = page.getByLabel('MediFlow lock screen', { exact: true });
    const form = shell.locator('form');
    const input = page.getByLabel('PIN operatore', { exact: true });
    const renew = page.getByRole('button', { name: 'Rinnova accesso', exact: true });
    const lock = page.getByRole('button', { name: 'Blocca', exact: true });
    const submit = shell.locator('button[type="submit"]');
    const receipt = await holdRealResponse(page, '/api/auth/lock', 200,
      () => lock.click(), async () => {
        await expect(form).toHaveAttribute('aria-busy', 'true');
        await expect(input).toBeDisabled();
        await expect(submit).toBeDisabled();
        await expect(renew).toBeDisabled();
        await expect(page.getByText('Verifica dell’accesso…', { exact: true })).toBeVisible();
        await page.keyboard.press('Enter');
        await form.evaluate((element: HTMLFormElement) => element.requestSubmit());
        expect(loginRequests).toEqual([]);
        await expect(page.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toHaveCount(0);
      });
    expect(await receipt.json()).toEqual({
      schemaVersion: 'mediflow.application-lock-receipt.v1', state: 'server_invalidation_confirmed',
    });
    await expectReadyLock(page);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('');
    expect(loginRequests).toEqual([]);
    expect((await documentRequests(page).get('/api/patients')).status()).toBe(401);

    await input.fill('abc');
    await expect(submit).toBeDisabled();
    await input.press('Enter');
    await expect(input).toHaveValue('abc');
    expect(loginRequests).toEqual([]);
    await expect(shell).toBeVisible();

    const wrong = 'wrong086086';
    await input.fill(wrong);
    await expect(submit).toBeEnabled();
    const denied = await holdRealResponse(page, '/api/auth/login', 401,
      () => input.press('Enter'), async () => {
        await expect(input).toBeDisabled();
        await expect(submit).toBeDisabled();
        await expect(form).toHaveAttribute('aria-busy', 'true');
        await page.keyboard.press('Enter');
        expect(loginRequests).toEqual([wrong]);
      });
    expect(denied.request().postDataJSON().password).toBe(wrong);
    await expect(page.locator('#mediflow-lock-error')).toBeVisible();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    await expect(shell).toBeVisible();
    expect((await documentRequests(page).get('/api/patients')).status()).toBe(401);
    await unlock(page, ALPHANUMERIC_PIN, 'enter');
    expect(loginRequests).toEqual([wrong, ALPHANUMERIC_PIN]);
    await expect(page.locator('#mediflow-lock-error')).toHaveCount(0);
  } finally {
    page.off('request', observeLogin);
  }
});
