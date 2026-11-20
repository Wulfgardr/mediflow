import { expect, test } from '@playwright/test';
import { documentRequests } from './fixtures/trusted-web-request';
import { completeOnboardingIfNeeded, unlockIfNeeded } from './utils';

const strongControlETag = /^"[A-Za-z0-9_-]{32,256}"$/u;

test('Web login publishes one P3 session accepted by authenticated routes', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';
  await page.goto('/');
  await completeOnboardingIfNeeded(page, pin);
  await expect(page.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeVisible();

  const checked = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/check');
  const web = documentRequests(page);
  const before = await web.get('/api/auth/check');
  expect(await before.json()).toMatchObject({ hasSession: false });
  const previous = await (await checked).headerValue('etag');
  expect(previous).toMatch(strongControlETag);

  const loggedIn = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login');
  await unlockIfNeeded(page, pin);
  const login = await loggedIn;
  expect(login.status()).toBe(200);
  const current = await login.headerValue('etag');
  expect(current).toMatch(strongControlETag);
  expect(current).not.toBe(previous);

  expect(await (await web.get('/api/auth/check')).json()).toMatchObject({ hasSession: true });
  const patients = await web.get('/api/patients');
  expect(patients.status()).toBe(200);
  expect(await patients.json()).toEqual(expect.any(Array));
});
