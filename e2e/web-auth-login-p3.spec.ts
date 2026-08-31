/* @Codex */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const STRONG_AUTH_CONTROL_ETAG = /^"[A-Za-z0-9_-]{32,256}"$/u;
const AUTH_CONTROL_COOKIE = /^[A-Za-z0-9_-]{32,256}$/u;

test('Web login publishes one P3 session accepted by authenticated routes', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';

  /* @Codex The page-owned request context persists the opaque control cookie
     from bootstrap through login and the authenticated route read. */
  const bootstrap = await page.request.get('/api/auth/check', {
    headers: { 'Cache-Control': 'no-store' },
  });
  expect(bootstrap.status()).toBe(200);
  const bootstrapEtag = bootstrap.headers().etag;
  expect(bootstrapEtag).toMatch(STRONG_AUTH_CONTROL_ETAG);
  const controlCookie = (await page.context().cookies())
    .find((cookie) => cookie.name === 'mediflow_auth_control');
  expect(controlCookie?.value).toMatch(AUTH_CONTROL_COOKIE);

  const login = await page.request.post('/api/auth/login', {
    headers: {
      'If-Match': bootstrapEtag,
      'Idempotency-Key': randomUUID(),
    },
    data: { username: 'admin', password: pin },
  });
  expect(login.status()).toBe(200);
  expect(login.headers().etag).toMatch(STRONG_AUTH_CONTROL_ETAG);
  expect(login.headers().etag).not.toBe(bootstrapEtag);
  expect(login.headers()['set-cookie']).toMatch(/^mediflow_session=[^;]+;/);

  const patients = await page.request.get('/api/patients');
  expect(patients.status()).toBe(200);
  await expect(patients.json()).resolves.toEqual([]);

  await page.goto('/');
  await expect(page.getByLabel('MediFlow lock screen')).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeVisible();
});
