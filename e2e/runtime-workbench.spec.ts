/* @Codex WUL-676: actual workflows on the marked, synthetic prototype only. */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import { bootstrapUnlockedSession, unlockIfNeeded } from './utils';
const enabled = process.env.MEDIFLOW_TEST_RUNTIME_TWIN === '1';
test.skip(!enabled, 'Requires the isolated synthetic twin.');
let context: BrowserContext;
let page: Page;
const errors: string[] = [];
const choose = async (name: string) => page.getByTestId('runtime-twin-toolbar').getByRole('button', { name, exact: true }).click();
const section = async (id: string) => {
  const nav = page.getByRole('navigation', { name: 'Sezioni della vista', exact: true });
  const link = nav.locator(`a[href="#${id}"]`);
  if (!await link.isVisible()) await nav.locator('summary').click();
  await link.click();
  await expect(page.locator(`#${id}`)).toBeVisible();
};
test.beforeAll(async ({ browser, baseURL }) => {
  if (!enabled) return;
  const url = new URL(baseURL!);
  expect(url.hostname).toBe('127.0.0.1'); expect(+url.port).toBeGreaterThanOrEqual(3200); expect(+url.port).toBeLessThan(3400);
  context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 960 } });
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await bootstrapUnlockedSession(page, '086086');
  // The comparison toolbar is also visible on lock. Wait for the actual app,
  // using the ordinary PIN flow if auth hydration exposes the lock late.
  await expect(page.getByRole('navigation', { name: 'Navigazione principale' }).or(page.getByRole('heading', { name: 'Sblocca MediFlow' })).first()).toBeVisible();
  await unlockIfNeeded(page, '086086');
  await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-runtime-twin', 'true');
  fs.mkdirSync('tmp-086-twin/workbench-review', { recursive: true });
});
test.afterAll(async () => { if (enabled) { fs.writeFileSync('tmp-086-twin/workbench-review/errors.json', JSON.stringify(errors)); await context?.close(); } });

test('single click opens the right patient and two records can be revisited', async () => {
  const mainNav = page.getByRole('navigation', { name: 'Navigazione principale' });
  await mainNav.getByRole('link', { name: 'Pazienti', exact: true }).click();
  await expect(page.getByTestId('lume-frame-canvas')).toHaveAttribute('data-lume-context', 'incarico');
  await mainNav.getByRole('link', { name: 'Agenda', exact: true }).click();
  await expect(page.getByTestId('lume-frame-canvas')).toHaveAttribute('data-lume-context', 'turno');
  await mainNav.getByRole('link', { name: 'Pazienti', exact: true }).click();
  await page.getByTestId('lume-patient-row').filter({ hasText: 'Persona 02' }).click();
  await expect(page).toHaveURL(/\/patients\/twin-086-02\/modules$/);
  const tabs = page.getByRole('navigation', { name: 'Cartelle aperte' });
  await expect(tabs.getByRole('link', { name: 'Sintetica Persona 02', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('navigation', { name: 'Navigazione principale' }).getByRole('link', { name: 'Pazienti', exact: true }).click();
  await page.getByTestId('lume-patient-row').filter({ hasText: 'Persona 06' }).click();
  await expect(page).toHaveURL(/\/patients\/twin-086-06\/modules$/);
  await expect(tabs.getByRole('link', { name: 'Sintetica Persona 02', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Sezioni della vista' }).locator('a[href="#protesica"]')).not.toBeVisible();
  await section('protesica');
  await tabs.getByRole('link', { name: 'Sintetica Persona 02', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sintetica Persona 02', exact: true })).toBeVisible();
});

test('all thirteen modules remain reachable and a therapy draft survives comparison', async () => {
  test.setTimeout(90_000);
  // A document reload clears the intentional in-memory record list. Open both
  // records through client navigation in this test's own session.
  await page.goto('/patients/twin-086-06/modules');
  await page.getByRole('navigation', { name: 'Navigazione principale' }).getByRole('link', { name: 'Pazienti', exact: true }).click();
  await page.getByTestId('lume-patient-row').filter({ hasText: 'Persona 02' }).click();
  for (const id of ['quadro','attenzione','identita','parametri','terapie','prestazioni','protesica','scale','documenti','siss','timeline','diario','follow-up']) await section(id);
  await section('terapie');
  await page.getByRole('button', { name: 'Nuova terapia', exact: true }).click();
  const dosage = page.getByPlaceholder('Es. 1 cp ore 8:00, 1/2 cp ore 20:00');
  await dosage.fill('Bozza dimostrativa non salvata');
  await section('parametri'); await section('terapie');
  await expect(dosage).toHaveValue('Bozza dimostrativa non salvata');
  await choose('B · Diario'); await expect(dosage).toHaveValue('Bozza dimostrativa non salvata');
  await choose('Originale'); await expect(dosage).toHaveValue('Bozza dimostrativa non salvata');
  await choose('A · Postazione'); await expect(dosage).toHaveValue('Bozza dimostrativa non salvata');
  await page.getByRole('navigation', { name: 'Cartelle aperte' }).getByRole('link', { name: 'Sintetica Persona 06', exact: true }).click();
  await page.getByRole('dialog', { name: 'Lasciare la compilazione?' }).getByRole('button', { name: 'Continua a scrivere' }).click();
  await expect(dosage).toHaveValue('Bozza dimostrativa non salvata');
  await page.getByRole('button', { name: 'Chiudi scheda terapia', exact: true }).click();
});

test('progressive entry preserves writing through tools, comparison and cancelled navigation', async () => {
  await page.goto('/patients/twin-086-02/entries/new');
  await expect(page.getByTestId('progressive-entry-composer')).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'Resoconto clinico', exact: true });
  const draft = 'Nota sintetica non salvata per verifica della composizione.';
  await editor.fill(draft);
  await page.locator('summary').filter({ hasText: 'Bozza locale e sessione' }).click();
  await expect(editor).toContainText(draft);
  await page.locator('summary').filter({ hasText: 'Consulta cartella' }).click();
  await expect(editor).toContainText(draft);
  await choose('B · Diario'); await expect(editor).toContainText(draft);
  await choose('Originale'); await expect(editor).toContainText(draft);
  await choose('A · Postazione'); await expect(editor).toContainText(draft);
  await page.getByRole('navigation', { name: 'Navigazione principale' }).getByRole('link', { name: 'Pazienti', exact: true }).click();
  const leaveDialog = page.getByRole('dialog', { name: 'Lasciare la compilazione?' });
  await expect(leaveDialog).toBeVisible();
  await leaveDialog.getByRole('button', { name: 'Continua a scrivere' }).click();
  await expect(editor).toContainText(draft);
  // Deliberate discard closes exactly the test's active tab after confirmation.
  await page.getByRole('navigation', { name: 'Cartelle aperte' }).getByRole('link', { name: 'Chiudi cartella 1', exact: true }).click();
  await leaveDialog.getByRole('button', { name: 'Esci senza salvare' }).click();
  await expect(page).toHaveURL(/\/?\?area=incarico/);
  await expect(page.getByRole('navigation', { name: 'Cartelle aperte' }).getByRole('link', { name: 'Sintetica Persona 02', exact: true })).toHaveCount(0);
  await page.goto('/patients/twin-086-02/modules');
});

test('desktop, phone and short window preserve text padding and control geometry', async () => {
  test.setTimeout(120_000);
  for (const [width, height] of [[1440, 960], [390, 844], [900, 620]]) {
    await page.setViewportSize({ width, height });
    await page.goto('/patients/twin-086-02/modules');
    await expect(page.getByRole('navigation', { name: 'Navigazione principale' }).getByRole('link', { name: 'Scale', exact: true })).toBeVisible();
    for (const [name, stem] of [['A · Postazione', 'a'], ['B · Diario', 'b']]) {
      await choose(name); await expect(page.getByRole('heading', { name: 'Sintetica Persona 02', exact: true })).toBeVisible();
      if (stem === 'b') {
        await expect(page.locator('#diario')).toBeVisible();
        const entry = page.locator('#diario [role="feed"] > article').first();
        const padding = await entry.locator(':scope > div').first().evaluate(el => {
          const style = getComputedStyle(el);
          return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(Number.parseFloat);
        });
        expect(Math.min(...padding)).toBeGreaterThanOrEqual(16);
        const remove = await entry.getByRole('button', { name: 'Elimina voce clinica con motivazione' }).boundingBox();
        expect(Math.abs(remove!.width - remove!.height)).toBeLessThan(2);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      const bounds = await page.locator('[data-twin-workspace]').boundingBox(); expect(bounds!.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `tmp-086-twin/workbench-review/${stem}-${width}.png` });
    }
    await choose('A · Postazione');
    await page.goto('/patients/twin-086-02/entries/new');
    await expect(page.getByRole('textbox', { name: 'Resoconto clinico', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `tmp-086-twin/workbench-review/entry-${width}.png` });
    await page.goto('/settings');
    await expect(page.getByTestId('settings-overview-section')).toBeVisible();
    await expect(page.getByText('Home-base disattivato.', { exact: true })).toBeVisible();
    const privacy = await page.getByTestId('privacy-mode-header-toggle').boundingBox();
    expect(Math.abs(privacy!.width - privacy!.height)).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `tmp-086-twin/workbench-review/settings-${width}.png` });
  }
  expect(errors).toEqual([]);
});
