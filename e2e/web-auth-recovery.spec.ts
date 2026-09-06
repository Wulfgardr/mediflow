/* @Codex: ordinary shared-cookie tabs; no injected key/session or auth response. */
import { expect, test, type Page, type Request } from '@playwright/test';
import { bootstrapUnlockedSession, unlockIfNeeded } from './utils';

const pin = process.env.E2E_PIN || '1234';
const authPath = (request: Request) => new URL(request.url()).pathname;
const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
const renewButton = (page: Page) => page.getByRole('button', { name: 'Rinnova accesso', exact: true });
const pinField = (page: Page) => page.getByLabel('PIN operatore', { exact: true });

function deferred() {
  let release: () => void = () => undefined;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function openSibling(page: Page) {
  await bootstrapUnlockedSession(page, pin);
  await expect(navigation(page)).toBeVisible();
  const sibling = await page.context().newPage();
  const mutations: Request[] = [];
  const errors: string[] = [];
  sibling.on('request', request => {
    if (request.method() === 'POST' && authPath(request).startsWith('/api/auth/')) mutations.push(request);
  });
  sibling.on('pageerror', error => errors.push(error.message));
  const checked = sibling.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/check');
  await sibling.goto('/settings/aspetto');
  const check = await checked;
  expect(check.status()).toBe(200);
  expect(await check.json()).toMatchObject({ isSetup: true, hasSession: true });
  await expect(sibling.getByRole('heading', { name: 'Sblocca MediFlow', exact: true })).toBeVisible();
  return { sibling, mutations, errors };
}

test('an active session without the tab key needs explicit renewal and waits for its real lock receipt', async ({ page }) => {
  const { sibling, mutations, errors } = await openSibling(page);
  const consoleErrors: string[] = [];
  sibling.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  const received = deferred();
  const release = deferred();
  let returnedFence: string | undefined;
  await sibling.route('**/api/auth/lock', async route => {
    // Forward the real operation, but keep its response pending at the browser boundary.
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: 'mediflow.application-lock-receipt.v1', state: 'server_invalidation_confirmed',
    });
    returnedFence = response.headers().etag;
    expect(Boolean(returnedFence)).toBe(true);
    received.release();
    await release.promise;
    await route.fulfill({ response });
  });
  try {
    await expect(sibling.getByRole('status')).toContainText('Una sessione è già attiva');
    await expect(renewButton(sibling)).toBeEnabled();
    await expect(pinField(sibling)).toBeDisabled();
    await expect(sibling.locator('button[type="submit"]')).toBeDisabled();
    await sibling.waitForLoadState('networkidle');
    expect(mutations).toHaveLength(0); // Mounting the sibling must not revoke or attempt a login.
    expect((await page.request.get('/api/patients')).status()).toBe(200);
    await expect(navigation(page)).toBeVisible();

    await renewButton(sibling).click();
    await received.promise;
    await expect(sibling.getByRole('status')).toHaveText('Sto chiudendo la sessione precedente…');
    await expect(sibling.locator('form')).toHaveAttribute('aria-busy', 'true');
    await expect(pinField(sibling)).toBeDisabled();
    await expect(sibling.locator('button[type="submit"]')).toBeDisabled();
    await expect(renewButton(sibling)).toBeDisabled();
    await sibling.keyboard.press('Enter');
    expect(mutations.map(authPath)).toEqual(['/api/auth/lock']);

    release.release();
    await expect(pinField(sibling)).toBeEnabled();
    await expect(pinField(sibling)).toBeFocused();
    await expect(pinField(sibling)).toHaveValue('');
    expect(mutations.map(authPath)).toEqual(['/api/auth/lock']); // No auto-login after the receipt.
    const loggedIn = sibling.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login');
    await unlockIfNeeded(sibling, pin);
    expect((await loggedIn).status()).toBe(200);
    await expect(navigation(sibling)).toBeVisible();
    const loginRequests = mutations.filter(request => authPath(request) === '/api/auth/login');
    expect(loginRequests).toHaveLength(1);
    // Keep the actual opaque values out of assertion output.
    expect(await loginRequests[0].headerValue('if-match') === returnedFence).toBe(true);
    expect(errors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  } finally {
    release.release();
    await sibling.unrouteAll({ behavior: 'wait' });
    await sibling.close();
  }
});

test('failed renewal keeps the PIN disabled and requires another explicit successful recovery', async ({ page }) => {
  const { sibling, mutations, errors } = await openSibling(page);
  const failedPaths: string[] = [];
  sibling.on('requestfailed', request => failedPaths.push(authPath(request)));
  // A narrow transport fault; the production client performs its existing same-key replay.
  await sibling.route('**/api/auth/lock', route => route.abort('failed'));
  try {
    await renewButton(sibling).click();
    await expect(sibling.getByRole('status')).toContainText('Chiusura della sessione non confermata');
    await expect(sibling.locator('form')).toHaveAttribute('aria-busy', 'false');
    await expect(pinField(sibling)).toBeDisabled();
    await expect(sibling.locator('button[type="submit"]')).toBeDisabled();
    await expect(renewButton(sibling)).toBeEnabled();
    expect(mutations.map(authPath)).toEqual(['/api/auth/lock', '/api/auth/lock']);
    expect(failedPaths).toEqual(['/api/auth/lock', '/api/auth/lock']);
    expect((await page.request.get('/api/patients')).status()).toBe(200);

    await sibling.unrouteAll({ behavior: 'wait' });
    await renewButton(sibling).click();
    await expect(pinField(sibling)).toBeEnabled();
    expect(mutations.filter(request => authPath(request) === '/api/auth/login')).toHaveLength(0);
    await unlockIfNeeded(sibling, pin);
    await expect(navigation(sibling)).toBeVisible();
    expect(mutations.filter(request => authPath(request) === '/api/auth/login')).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally {
    await sibling.unrouteAll({ behavior: 'wait' });
    await sibling.close();
  }
});
