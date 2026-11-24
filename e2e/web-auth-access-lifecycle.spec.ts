import { expect, test } from './fixtures/isolated-runtime';
import { randomUUID } from 'node:crypto';
import { bootstrapUnlockedSession } from './utils';
import { documentRequests, localClientProofHeaders, trustedWebRequestHeaders } from './fixtures/trusted-web-request';

test.use({ initialRuntimeServices: true, existingPin: process.env.E2E_PIN || '1234' });

const STRONG_AUTH_CONTROL_ETAG = /^"[A-Za-z0-9_-]{32,256}"$/u;

function mutationHeaders(etag: string, baseURL: string | undefined): Record<string, string> {
  return {
    ...trustedWebRequestHeaders(baseURL),
    'If-Match': etag,
    'Idempotency-Key': randomUUID(),
  };
}

test('Web access recovers across application lock, logout, and synthetic admin reset', async ({ page, browser, baseURL, request: client }) => {
  const pin = process.env.E2E_PIN || '1234';
  const local = localClientProofHeaders();
  type Options = { headers?: Record<string, string>; data?: unknown };
  const request = {
    get: (path: string, options: Options = {}) => client.get(path, { ...options, headers: { ...local, ...options.headers } }),
    post: (path: string, options: Options = {}) => client.post(path, { ...options, headers: { ...local, ...options.headers } }),
  };

  const setupContext = await browser.newContext({ baseURL });
  try {
    const setupPage = await setupContext.newPage();
    await bootstrapUnlockedSession(setupPage, pin);
    await expect(setupPage.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toBeVisible();
    expect((await documentRequests(setupPage).post('/api/auth/logout', { data: {} })).status()).toBe(204);
    await setupPage.close();
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
    headers: mutationHeaders(bootstrapEtag, baseURL),
    data: { username: 'admin', password: pin },
  });
  expect(login.status()).toBe(200);
  const loginEtag = login.headers().etag;
  expect(loginEtag).toMatch(STRONG_AUTH_CONTROL_ETAG);

  const authenticated = await request.get('/api/patients');
  expect(authenticated.status()).toBe(200);

  const lock = await request.post('/api/auth/lock', {
    headers: mutationHeaders(loginEtag, baseURL),
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
    headers: mutationHeaders(postLockCheck.headers().etag, baseURL),
    data: { username: 'admin', password: pin },
  });
  expect(relogin.status()).toBe(200);
  expect(relogin.headers().etag).toMatch(STRONG_AUTH_CONTROL_ETAG);

  const logout = await request.post('/api/auth/logout', { headers: trustedWebRequestHeaders(baseURL) });
  expect(logout.status()).toBe(204);
  expect(await logout.text()).toBe('');

  const afterLogout = await request.get('/api/patients');
  expect(afterLogout.status()).toBe(401);

  const recoveryLoginCheck = await request.get('/api/auth/check', {
    headers: { 'Cache-Control': 'no-store' },
  });
  expect(recoveryLoginCheck.status()).toBe(200);
  const recoveryLogin = await request.post('/api/auth/login', {
    headers: mutationHeaders(recoveryLoginCheck.headers().etag, baseURL),
    data: { username: 'admin', password: pin },
  });
  expect(recoveryLogin.status()).toBe(200);

  const { archiveGeneration } = await recoveryLogin.json();
  expect(archiveGeneration).toBeTruthy();
  const reset = await request.post('/api/auth/reset', {
    headers: { ...trustedWebRequestHeaders(baseURL), 'x-mediflow-archive-generation': archiveGeneration },
  });
  expect(reset.status()).toBe(200);
  await expect(reset.json()).resolves.toMatchObject({ success: true,
    receipt: { outcome: 'completed', reconciled: false, previousArchive: { retained: true } } });

  const afterReset = await request.get('/api/patients');
  expect(afterReset.status()).toBe(401);

  const setupCheck = await request.get('/api/auth/check', {
    headers: { 'Cache-Control': 'no-store' },
  });
  expect(setupCheck.status()).toBe(200);
  await expect(setupCheck.json()).resolves.toMatchObject({ isSetup: false, hasSession: false });

  await bootstrapUnlockedSession(page, '5678');
  await expect(page.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toBeVisible();

  const afterSetup = await documentRequests(page).get('/api/patients');
  expect(afterSetup.status()).toBe(200);

  const recoveredContext = await browser.newContext({ baseURL });
  try {
    const recoveredPage = await recoveredContext.newPage();
    await bootstrapUnlockedSession(recoveredPage, '5678');
    await expect(recoveredPage.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toBeVisible();
  } finally {
    await recoveredContext.close();
  }
});
