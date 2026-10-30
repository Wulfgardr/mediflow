import { test, expect } from './fixtures/isolated-runtime';
import { bootstrapUnlockedSession } from './utils';
import type { Page } from '@playwright/test';

test.use({ pluginLocalUiRuntime: true });

async function patient(page: Page, suffix: string) {
  return page.evaluate(async suffix => {
    const response = await fetch('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: 'Storia', lastName: `Sintetica ${suffix}`, taxCode: `HST${crypto.randomUUID().replaceAll('-', '').slice(0, 13)}` }) });
    if (response.status !== 201) throw new Error(`Patient: ${response.status}`);
    return response.json();
  }, suffix);
}

async function openFolder(page: Page, id: string) {
  await page.goto(`/patients/${id}/modules`);
  await expect(page.getByTestId('patient-profile-notes')).not.toContainText('Lettura delle note in corso…');
  await expect.poll(() => page.evaluate(() => performance.getEntriesByType('resource').some(entry => entry.name.includes('/api/patient-profile/selection-epoch')))).toBe(true);
}

async function pair(page: Page, runtime: { offerPairing(): { nonce: string; host: string } }) {
  const grant = runtime.offerPairing();
  await page.getByLabel('Codice di abbinamento', { exact: true }).fill('a'.repeat(24));
  await page.getByRole('button', { name: 'Consenti', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Revoca il collegamento del plugin', exact: true })).toBeVisible();
  return grant;
}

const confirmation = (page: Page) => page.getByRole('button', { name: 'Apri sulla cartella aperta', exact: true });

test('history exposes content and source locally, confirmation is consumed and cancellation clears it', async ({ page, isolatedRuntime }, info) => {
  await bootstrapUnlockedSession(page, '1234');
  const p = await patient(page, 'fonte');
  const response = await page.request.post('/api/entries', { data: { patientId: p.id, type: 'visit', title: 'Controllo inventato',
    date: '2026-10-29T10:00:00Z', content: '<p>Contenuto sintetico della storia.</p>', setting: 'ambulatory', metadata: { sourceLabel: 'Fonte sintetica verificabile' } } });
  expect(response.status()).toBe(201);
  await openFolder(page, p.id);
  const grant = await pair(page, isolatedRuntime);
  expect(await isolatedRuntime.usePairing(grant.nonce, grant.host, { intent: 'history' })).toBe('accepted');
  await confirmation(page).click();
  await expect(page).toHaveURL(/#timeline$/u);
  const row = page.locator('#timeline article').filter({ hasText: 'Controllo inventato' });
  await expect(row).toContainText('Contenuto sintetico della storia.');
  await expect(row).toContainText('Fonte: Fonte sintetica verificabile');
  await expect(row.locator('time')).toHaveAttribute('datetime', '2026-10-29T10:00:00.000Z');
  await expect(confirmation(page)).toHaveCount(0);
  await info.attach('history-source', { body: await page.screenshot(), contentType: 'image/png' });
  await row.getByRole('link').click();
  await expect(page).toHaveURL(/#diario$/u);
  await expect(page.locator('#diario')).toContainText('Contenuto sintetico della storia.');
  expect(await isolatedRuntime.usePairing(grant.nonce, grant.host, { intent: 'history' })).toBe('accepted');
  await expect(confirmation(page)).toBeVisible();
  isolatedRuntime.cancelNavigation();
  await expect(confirmation(page)).toHaveCount(0);
  expect(await page.request.get(`/api/entries?patientId=${p.id}`).then(r => r.json())).toHaveLength(1);
});

test('patient change retires the old confirmation, revocation and lock deny subsequent requests', async ({ page, isolatedRuntime }) => {
  await bootstrapUnlockedSession(page, '1234');
  const a = await patient(page, 'A'), b = await patient(page, 'B');
  await openFolder(page, a.id);
  const grant = await pair(page, isolatedRuntime);
  expect(await isolatedRuntime.usePairing(grant.nonce, grant.host, { intent: 'history' })).toBe('accepted');
  await expect(confirmation(page)).toBeVisible();
  await openFolder(page, b.id);
  await expect(confirmation(page)).toHaveCount(0);
  expect(new URL(page.url()).hash).toBe('');
  expect(await isolatedRuntime.usePairing(grant.nonce, grant.host, { intent: 'history' })).toBe('accepted');
  await expect(confirmation(page)).toBeVisible();
  await page.getByRole('button', { name: 'Revoca il collegamento del plugin', exact: true }).click();
  await expect(confirmation(page)).toHaveCount(0);
  expect(await isolatedRuntime.usePairing(grant.nonce, grant.host)).toBe('denied');
  const next = await pair(page, isolatedRuntime);
  await page.getByRole('button', { name: 'Blocca', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sblocca MediFlow', exact: true })).toBeVisible();
  expect(await isolatedRuntime.usePairing(next.nonce, next.host)).toBe('denied');
});

test('expired IPC and UI deadline cannot navigate, a fresh request works after timeout', async ({ page, isolatedRuntime }) => {
  test.setTimeout(65000);
  await bootstrapUnlockedSession(page, '1234');
  const p = await patient(page, 'scadenza'); await openFolder(page, p.id);
  const grant = await pair(page, isolatedRuntime);
  expect(await isolatedRuntime.usePairing(grant.nonce, grant.host, { intent: 'history', expiresAt: Date.now() - 1 })).toBe('denied');
  await expect(confirmation(page)).toHaveCount(0);
  expect(await isolatedRuntime.usePairing(grant.nonce, grant.host, { intent: 'history' })).toBe('accepted');
  await expect(confirmation(page)).toBeVisible();
  await expect(confirmation(page)).toHaveCount(0, { timeout: 18000 });
  expect(new URL(page.url()).hash).toBe('');
  expect(await isolatedRuntime.usePairing(grant.nonce, grant.host, { intent: 'history' })).toBe('accepted');
  await confirmation(page).click(); await expect(page).toHaveURL(/#timeline$/u);
});

test('an epoch response arriving after the UI timeout cannot resurrect a confirmation', async ({ page, isolatedRuntime }) => {
  test.setTimeout(65000);
  await bootstrapUnlockedSession(page, '1234');
  const p = await patient(page, 'ritardo'); await openFolder(page, p.id);
  const grant = await pair(page, isolatedRuntime);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let observed!: () => void;
  const started = new Promise<void>(resolve => { observed = resolve; });
  await page.route('**/api/patient-profile/selection-epoch', async route => {
    const response = await route.fetch(); observed(); await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  expect(await isolatedRuntime.usePairing(grant.nonce, grant.host, { intent: 'history' })).toBe('accepted');
  await started;
  await page.waitForTimeout(16000);
  release();
  await page.unrouteAll({ behavior: 'wait' });
  await expect(confirmation(page)).toHaveCount(0);
  expect(new URL(page.url()).hash).toBe('');
  expect(await isolatedRuntime.usePairing(grant.nonce, grant.host, { intent: 'history' })).toBe('accepted');
  await confirmation(page).click(); await expect(page).toHaveURL(/#timeline$/u);
  await page.reload(); await expect(confirmation(page)).toHaveCount(0);
});
