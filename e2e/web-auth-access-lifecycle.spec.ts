/* @Codex */
import { expect, test } from './fixtures/isolated-runtime';
import { randomUUID } from 'node:crypto';
import { bootstrapUnlockedSession } from './utils';

const STRONG_AUTH_CONTROL_ETAG = /^"[A-Za-z0-9_-]{32,256}"$/u;

function mutationHeaders(etag: string): Record<string, string> {
  return {
    'If-Match': etag,
    'Idempotency-Key': randomUUID(),
  };
}

test('Web access recovers across application lock, logout, and synthetic admin reset', async ({ page, browser, baseURL }) => {
  const pin = process.env.E2E_PIN || '1234';
  const request = page.request;

  // Bootstrap this test's empty server via ordinary UI, with a real wrapped key.
  // Close the UI before retiring its session, then exercise the original API lifecycle.
  const setupContext = await browser.newContext({ baseURL });
  try {
    const setupPage = await setupContext.newPage();
    await bootstrapUnlockedSession(setupPage, pin);
    await expect(setupPage.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toBeVisible();
    await setupPage.close();
    expect((await setupContext.request.post('/api/auth/logout')).status()).toBe(204);
  } finally {
    await setupContext.close();
  }

  const bootstrap = await request.get('/api/auth/check', {
    headers: { 'Cache-Control': 'no-store' },
  });
  expect(bootstrap.status()).toBe(200);
  const bootstrapEtag = bootstrap.headers().etag;
  expect(bootstrapEtag).toMatch(STRONG_AUTH_CONTROL_ETAG);

  const login = await request.post('/api/auth/login', {
    headers: mutationHeaders(bootstrapEtag),
    data: { username: 'admin', password: pin },
  });
  expect(login.status()).toBe(200);
  const loginEtag = login.headers().etag;
  expect(loginEtag).toMatch(STRONG_AUTH_CONTROL_ETAG);

  const authenticated = await request.get('/api/patients');
  expect(authenticated.status()).toBe(200);

  const lock = await request.post('/api/auth/lock', {
    headers: mutationHeaders(loginEtag),
  });
  expect(lock.status()).toBe(200);
  await expect(lock.json()).resolves.toEqual({
    schemaVersion: 'mediflow.application-lock-receipt.v1',
    state: 'server_invalidation_confirmed',
  });

  const afterLock = await request.get('/api/patients');
  expect(afterLock.status()).toBe(401);

  const postLockCheck = await request.get('/api/auth/check', {
    headers: { 'Cache-Control': 'no-store' },
  });
  expect(postLockCheck.status()).toBe(200);
  await expect(postLockCheck.json()).resolves.toMatchObject({ hasSession: false });

  const relogin = await request.post('/api/auth/login', {
    headers: mutationHeaders(postLockCheck.headers().etag),
    data: { username: 'admin', password: pin },
  });
  expect(relogin.status()).toBe(200);
  expect(relogin.headers().etag).toMatch(STRONG_AUTH_CONTROL_ETAG);

  const logout = await request.post('/api/auth/logout');
  expect(logout.status()).toBe(204);
  expect(await logout.text()).toBe('');

  const afterLogout = await request.get('/api/patients');
  expect(afterLogout.status()).toBe(401);

  const recoveryLoginCheck = await request.get('/api/auth/check', {
    headers: { 'Cache-Control': 'no-store' },
  });
  expect(recoveryLoginCheck.status()).toBe(200);
  const recoveryLogin = await request.post('/api/auth/login', {
    headers: mutationHeaders(recoveryLoginCheck.headers().etag),
    data: { username: 'admin', password: pin },
  });
  expect(recoveryLogin.status()).toBe(200);

  const reset = await request.post('/api/auth/reset');
  expect(reset.status()).toBe(200);
  await expect(reset.json()).resolves.toEqual({ success: true });

  const afterReset = await request.get('/api/patients');
  expect(afterReset.status()).toBe(401);

  const setupCheck = await request.get('/api/auth/check', {
    headers: { 'Cache-Control': 'no-store' },
  });
  expect(setupCheck.status()).toBe(200);
  await expect(setupCheck.json()).resolves.toMatchObject({ isSetup: false, hasSession: false });

  // Re-onboard with a new PIN and ordinary key generation, never a fake crypto blob.
  const setupResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/setup');
  await bootstrapUnlockedSession(page, '5678');
  expect((await setupResponse).status()).toBe(200);
  await expect(page.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toBeVisible();

  const afterSetup = await request.get('/api/patients');
  expect(afterSetup.status()).toBe(200);

  // A new browser context must also unlock the newly configured account using its real key.
  const recoveredContext = await browser.newContext({ baseURL });
  try {
    const recoveredPage = await recoveredContext.newPage();
    await bootstrapUnlockedSession(recoveredPage, '5678');
    await expect(recoveredPage.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toBeVisible();
  } finally {
    await recoveredContext.close();
  }
});
