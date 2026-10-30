import { test, expect } from './fixtures/isolated-runtime';
import { bootstrapUnlockedSession } from './utils';
import { trustedArchiveWebRequestHeaders } from './fixtures/trusted-web-request';
import { spawn } from 'node:child_process';
import path from 'node:path';
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
  const response = await page.request.post('/api/entries', { headers: await trustedArchiveWebRequestHeaders(page), data: { patientId: p.id, type: 'visit', title: 'Controllo inventato',
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
  const capture = info.outputPath('history-source.png');
  await page.screenshot({ path: capture });
  await info.attach('history-source', { path: capture, contentType: 'image/png' });
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
  expect(await isolatedRuntime.usePairing(next.nonce, next.host, { intent: 'history' })).toBe('accepted');
  await expect(confirmation(page)).toBeVisible();
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


test('selection changed by another local consumer denies the old confirmation in the same document', async ({ page, isolatedRuntime }) => {
  await bootstrapUnlockedSession(page, '1234');
  const a = await patient(page, 'prima'), b = await patient(page, 'dopo');
  await openFolder(page, a.id); const grant = await pair(page, isolatedRuntime);
  expect(await isolatedRuntime.usePairing(grant.nonce, grant.host, { intent: 'history' })).toBe('accepted');
  await expect(confirmation(page)).toBeVisible();
  expect(await page.evaluate(async id => {
    const epoch = await (await fetch('/api/patient-profile/selection-epoch')).json();
    const response = await fetch(`/api/patients/${id}/profile-query`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'open', contractVersion: 1, projection: 'notes', expectedSelectionEpoch: epoch.selectionEpoch }) });
    return response.status;
  }, b.id)).toBe(200);
  await confirmation(page).click();
  await expect(page.getByRole('alert').filter({ hasText: 'La selezione è cambiata' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  await expect(confirmation(page)).toHaveCount(0);
});

test('real MCP receipt and duplicate parent RPC produce a single local confirmation without patient output', async ({ page, isolatedRuntime }) => {
  await bootstrapUnlockedSession(page, '1234');
  const p = await patient(page, 'duplicato'); await openFolder(page, p.id);
  const grant = await pair(page, isolatedRuntime);
  const driver = spawn(process.execPath, ['--import', path.resolve('scripts/register-strip-types-loader.mjs'),
    'e2e/fixtures/local-ui-mcp-driver.mjs'], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  driver.stdout!.resume(); driver.stderr!.resume();
  const closed = new Promise(resolve => driver.once('exit', resolve));
  const replies = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  let sequence = 0;
  driver.on('message', async (message: any) => {
    if (message.navigate) {
      driver.send({ ack: await isolatedRuntime.usePairing(grant.nonce, grant.host, { intent: message.navigate }) });
      return;
    }
    const pending = replies.get(message.id);
    if (message.error) pending?.reject(new Error(message.error)); else pending?.resolve(message.result);
    replies.delete(message.id);
  });
  const command = (command: string) => new Promise<any>((resolve, reject) => {
    const id = ++sequence; replies.set(id, { resolve, reject }); driver.send({ id, command });
  });
  try {
    const result = await command('call');
    expect(result.result.content).toEqual([{ type: 'text', text: 'continue_in_mediflow' }]);
    await expect(confirmation(page)).toBeVisible();
    expect(await command('duplicate')).toMatchObject({ dispatched: 1, conflict: true });
    await confirmation(page).click(); await expect(page).toHaveURL(/#timeline$/u);
    const repeated = await command('duplicate');
    expect(repeated).toMatchObject({ dispatched: 1, conflict: true });
    await expect(confirmation(page)).toHaveCount(0);
    for (const sentinel of [p.id, 'Sintetica duplicato']) expect(repeated.wire).not.toContain(sentinel);
  } finally { if (driver.connected) driver.disconnect(); await closed; }
});
