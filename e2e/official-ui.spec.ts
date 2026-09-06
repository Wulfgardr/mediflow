/* @Codex ADR 0123: production UI acceptance on an explicitly marked synthetic node. */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNoHorizontalOverflow, bootstrapUnlockedSession, unlockIfNeeded } from './utils';

const enabled = process.env.MEDIFLOW_TEST_OFFICIAL_UI === '1';
const pin = process.env.E2E_PIN || '086086';
test.skip(!enabled, 'Requires an explicitly marked synthetic production runtime.');
test.describe.configure({ mode: 'serial' });
let context: BrowserContext;
let page: Page;
const errors: string[] = [];
const consoleErrors: { text: string; url: string }[] = [];
const remoteRequests: string[] = [];
const runTag = randomUUID().slice(0, 6);
const patients = ['Uno', 'Due'].map(firstName => ({
  id: randomUUID(), firstName: `Prova UI ${firstName} ${runTag}`, lastName: 'Sintetica',
  taxCode: `UI086${randomUUID().replaceAll('-', '').slice(0, 11).toUpperCase()}`,
}));
const modules = (index = 0) => `/patients/${patients[index].id}/modules`;
const name = (index = 0) => `${patients[index].lastName} ${patients[index].firstName}`;
const nav = () => page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
const section = async (id: string) => {
  const sections = page.getByRole('navigation', { name: 'Sezioni della vista', exact: true });
  const link = sections.locator(`a[href="#${id}"]`);
  if (!await link.isVisible()) await sections.locator('summary').click();
  await link.click();
  await expect(page.locator(`#${id}`)).toBeVisible();
};
const noComparison = async (target = page) => {
  await expect(target.locator('html')).not.toHaveAttribute('data-runtime-twin');
  await expect(target.getByTestId('runtime-twin-toolbar')).toHaveCount(0);
  await expect(target.getByRole('button', { name: 'Originale', exact: true })).toHaveCount(0);
  await expect(target.locator('body')).not.toContainText(/Runtime Twin|Prototipo 0\.8\.6/);
  await expect(target.locator('nextjs-error-overlay')).toHaveCount(0);
};

test.beforeAll(async ({ browser, baseURL }) => {
  if (!enabled) return;
  expect(process.env.MEDIFLOW_RUNTIME_TWIN).toBeUndefined();
  const dataDir = process.env.MEDIFLOW_DATA_DIR;
  expect(dataDir).toBeTruthy();
  expect(fs.existsSync(path.join(dataDir!, 'SYNTHETIC-PROTOTYPE'))).toBe(true);
  const url = new URL(baseURL!);
  expect(['127.0.0.1', 'localhost']).toContain(url.hostname);
  expect(+url.port).toBeGreaterThanOrEqual(3200);
  expect(+url.port).toBeLessThan(3300);
  expect(['3290', '3291', '3292']).not.toContain(url.port);
  context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 960 } });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push({ text: message.text(), url: message.location().url });
  });
  page.on('request', request => {
    const requested = new URL(request.url());
    if (['http:', 'https:'].includes(requested.protocol) && requested.origin !== url.origin) remoteRequests.push(request.url());
  });
  await bootstrapUnlockedSession(page, pin);
  await expect(nav().or(page.getByRole('heading', { name: 'Sblocca MediFlow' })).first()).toBeVisible();
  await unlockIfNeeded(page, pin);
  await expect(nav()).toBeVisible();
  // Fixture creation uses the browser's ordinary authenticated API after PIN;
  // no copied session material, seed hook, or auth override is used.
  const statuses = await page.evaluate(async fixtures => {
    const result = [];
    for (const fixture of fixtures) {
      const response = await fetch('/api/patients', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fixture),
      });
      result.push(response.status);
    }
    return result;
  }, patients);
  expect(statuses).toEqual([201, 201]);
});

test.afterEach(async () => {
  if (!enabled) return;
  expect(errors).toEqual([]);
  expect(remoteRequests).toEqual([]);
});
test.afterAll(async () => {
  if (!enabled) return;
  await test.info().attach('console-diagnostics.json', {
    body: JSON.stringify(consoleErrors, null, 2), contentType: 'application/json',
  });
  await context?.close();
});

test('ordinary PIN and manual onboarding preserve default B without comparison chrome', async () => {
  await expect(page).toHaveTitle(/MediFlow/);
  await expect(page.locator('html')).toHaveAttribute('data-twin-composition', 'stream');
  await noComparison();
  const workspace = await page.locator('[data-twin-workspace]').boundingBox();
  expect(workspace!.y).toBe(0);
  expect(workspace!.height).toBe(960);
  await page.goto('/settings/profilo');
  const profile = page.getByTestId('work-profile-onboarding');
  await expect(profile.getByRole('heading', { name: 'Il tuo modo di lavorare' })).toBeVisible();
  await profile.getByRole('link', { name: 'Apri la cartella manualmente' }).click();
  // The unconfigured work profile keeps its existing Agenda entry. Layout B
  // changes the patient record entry, not the onboarding/start-area contract.
  await expect(page).toHaveURL(/[?&]area=turno/);
  await expect(nav().getByRole('link', { name: 'Agenda', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('one click opens the correct record and all thirteen progressive sections remain reachable', async () => {
  test.setTimeout(90_000);
  await nav().getByRole('link', { name: 'Pazienti', exact: true }).click();
  await page.getByTestId('lume-patient-row').filter({ hasText: patients[0].firstName }).click();
  await expect(page).toHaveURL(new RegExp(`${modules()}$`));
  await expect(page.locator('#diario')).toBeVisible();
  await expect(page.getByRole('heading', { name: name(), exact: true })).toBeVisible();
  await nav().getByRole('link', { name: 'Pazienti', exact: true }).click();
  await page.getByTestId('lume-patient-row').filter({ hasText: patients[1].firstName }).click();
  await expect(page).toHaveURL(new RegExp(`${modules(1)}$`));
  const tabs = page.getByRole('navigation', { name: 'Cartelle aperte' });
  await expect(tabs.getByRole('link', { name: name(1), exact: true })).toHaveAttribute('aria-current', 'page');
  await tabs.getByRole('link', { name: name(), exact: true }).click();
  await expect(page.getByRole('heading', { name: name(), exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Sezioni della vista' }).locator('a[href="#protesica"]')).not.toBeVisible();
  for (const id of ['quadro', 'attenzione', 'identita', 'parametri', 'terapie', 'prestazioni', 'protesica', 'scale', 'documenti', 'siss', 'timeline', 'diario', 'follow-up']) await section(id);
  await section('terapie');
  await page.getByRole('button', { name: 'Nuova terapia', exact: true }).click();
  const dosage = page.getByPlaceholder('Es. 1 cp ore 8:00, 1/2 cp ore 20:00');
  await dosage.fill('Bozza sintetica non salvata');
  await section('parametri'); await section('terapie');
  await expect(dosage).toHaveValue('Bozza sintetica non salvata');
  await page.getByRole('button', { name: 'Chiudi scheda terapia', exact: true }).click();
});

test('entry survives disclosure, cross-tab layout change and cancelled navigation before encrypted save', async () => {
  test.setTimeout(90_000);
  await page.goto(`/patients/${patients[0].id}/entries/new`);
  const editor = page.getByRole('textbox', { name: 'Resoconto clinico', exact: true });
  const draft = `Nota sintetica integrazione UI ${randomUUID()}.`;
  await editor.fill(draft);
  for (const label of ['Bozza locale e sessione', 'Consulta cartella']) {
    await page.locator('summary').filter({ hasText: label }).click();
    await expect(editor).toContainText(draft);
  }
  const sibling = await context.newPage();
  try {
    await sibling.goto('/settings/aspetto');
    await sibling.waitForLoadState('networkidle');
    try { await unlockIfNeeded(sibling, pin); }
    catch (error) {
      await test.info().attach('sibling-access-state.txt', { body: await sibling.locator('body').innerText(), contentType: 'text/plain' });
      const renew = sibling.getByRole('button', { name: 'Rinnova accesso', exact: true });
      if (!await renew.isVisible()) throw error;
      // Exercise the existing explicit recovery gesture; the PIN remains required.
      await renew.click();
      await unlockIfNeeded(sibling, pin);
    }
    await sibling.getByRole('radio', { name: 'Barra laterale', exact: true }).check();
    await expect(page.locator('html')).toHaveAttribute('data-twin-composition', 'workbench');
    await expect(editor).toContainText(draft);
    await sibling.reload();
    await expect(sibling.getByRole('radio', { name: 'Barra laterale', exact: true })).toBeChecked();
    await noComparison(sibling);
  } finally { await sibling.close(); }
  await nav().getByRole('link', { name: 'Pazienti', exact: true }).click();
  const leave = page.getByRole('dialog', { name: 'Lasciare la compilazione?' });
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: 'Continua a scrivere' }).click();
  await expect(editor).toContainText(draft);
  const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/entries' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Registra nel diario', exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const saved = await response.json() as { id: string };
  await expect(page).toHaveURL(new RegExp(`${modules()}$`));
  const rows = await page.evaluate(async patientId => (await fetch(`/api/entries?patientId=${patientId}`)).json(), patients[0].id) as { id: string; content: string }[];
  expect(rows.find(row => row.id === saved.id)?.content).toMatch(/^ENC:/);
  await section('diario');
  await expect(page.locator('#diario').getByText(draft, { exact: true }).first()).toBeVisible();
});

test('both layouts reload and reflow at desktop, phone, narrow and short viewport sizes', async () => {
  test.setTimeout(150_000);
  for (const [width, height] of [[1440, 960], [390, 844], [320, 760], [900, 620]]) {
    await page.setViewportSize({ width, height });
    for (const [label, value, entry] of [['Barra laterale', 'workbench', 'quadro'], ['Barra superiore', 'stream', 'diario']]) {
      await page.goto('/settings/aspetto');
      await page.getByRole('radio', { name: label, exact: true }).check();
      await page.reload();
      await expect(page.getByRole('radio', { name: label, exact: true })).toBeChecked();
      await assertNoHorizontalOverflow(page, [{ label: 'document', selector: 'document' }, { label: 'appearance', selector: '[data-testid="settings-appearance-section"]' }]);
      await noComparison();
      await page.goto(modules());
      await expect(page.locator('html')).toHaveAttribute('data-twin-composition', value);
      await expect(page.locator(`#${entry}`)).toBeVisible();
      await expect(page.getByRole('heading', { name: name(), exact: true })).toBeVisible();
      await assertNoHorizontalOverflow(page, [{ label: 'document', selector: 'document' }, { label: 'workspace', selector: '[data-twin-workspace]' }]);
      await page.screenshot({ path: test.info().outputPath(`${value}-${width}.png`) });
    }
    await page.goto(`/patients/${patients[0].id}/entries/new`);
    await expect(page.getByRole('textbox', { name: 'Resoconto clinico', exact: true })).toBeVisible();
    await assertNoHorizontalOverflow(page, [{ label: 'document', selector: 'document' }]);
    await page.screenshot({ path: test.info().outputPath(`entry-${width}.png`) });
  }
});

test('unavailable preference storage is transient and ordinary lock clears open records', async () => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/settings/aspetto');
  // Only the presentation key rejects writes. Auth storage remains untouched.
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key: string, value: string) {
      if (key === 'mediflow.runtime-twin.composition') throw new DOMException('Synthetic storage denial', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.getByRole('radio', { name: 'Barra laterale', exact: true }).check();
  await expect(page.locator('html')).toHaveAttribute('data-twin-composition', 'workbench');
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Barra superiore', exact: true })).toBeChecked();
  await page.goto(modules());
  await page.getByRole('button', { name: 'Blocca', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Cartelle aperte' })).toHaveCount(0);
  await noComparison();
  await unlockIfNeeded(page, pin);
  await expect(nav()).toBeVisible();
  // Preserve known auth conflict diagnostics; any other console error fails.
  expect(consoleErrors.filter(({ text, url }) => !(url.endsWith('/api/auth/lock') && text.includes('409 (Conflict)')))).toEqual([]);
});
