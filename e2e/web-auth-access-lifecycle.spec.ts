/* @Codex */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const STRONG_AUTH_CONTROL_ETAG = /^"[A-Za-z0-9_-]{32,256}"$/u;

function mutationHeaders(etag: string): Record<string, string> {
  return {
    'If-Match': etag,
    'Idempotency-Key': randomUUID(),
  };
}

test('Web access recovers across application lock, logout, and synthetic admin reset', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';
  const request = page.request;

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

  const setup = await request.post('/api/auth/setup', {
    headers: mutationHeaders(setupCheck.headers().etag),
    data: {
      username: 'recovery-admin',
      password: '5678',
      encryptedMasterKey: 'synthetic-encrypted-master-key',
      salt: 'synthetic-salt',
      displayName: 'Synthetic Recovery Admin',
      ambulatoryName: 'Synthetic Recovery Clinic',
    },
  });
  expect(setup.status()).toBe(200);

  const afterSetup = await request.get('/api/patients');
  expect(afterSetup.status()).toBe(200);
});
