/* @Codex */
import { expect, test } from '@playwright/test';

test('Web login publishes one P3 session accepted by authenticated routes', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';

  const login = await page.request.post('/api/auth/login', {
    data: { username: 'admin', password: pin },
  });
  expect(login.status()).toBe(200);
  expect(login.headers()['set-cookie']).toMatch(/^mediflow_session=[^;]+;/);

  const patients = await page.request.get('/api/patients');
  expect(patients.status()).toBe(200);
  await expect(patients.json()).resolves.toEqual([]);

  await page.goto('/');
  await expect(page.getByLabel('MediFlow lock screen')).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeVisible();
});
