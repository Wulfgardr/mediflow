import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { assertNoHorizontalOverflow, bootstrapUnlockedSession } from './utils';

const SHOTS = process.env.LAYOUT_HARMONY_SHOTS_DIR || '/tmp/mediflow-layout-harmony-shots';

async function assertControlUnclipped(control: Locator, label: string) {
  const evidence = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const edges = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (let owner = element.parentElement; owner; owner = owner.parentElement) {
      const style = getComputedStyle(owner);
      const box = owner.getBoundingClientRect();
      if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX)) {
        edges.left = Math.max(edges.left, box.left + owner.clientLeft);
        edges.right = Math.min(edges.right, box.left + owner.clientLeft + owner.clientWidth);
      }
      if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowY)) {
        edges.top = Math.max(edges.top, box.top + owner.clientTop);
        edges.bottom = Math.min(edges.bottom, box.top + owner.clientTop + owner.clientHeight);
      }
    }
    return { rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, edges };
  });
  expect(evidence.rect.left, `${label}: sinistra`).toBeGreaterThanOrEqual(evidence.edges.left - 1);
  expect(evidence.rect.top, `${label}: alto`).toBeGreaterThanOrEqual(evidence.edges.top - 1);
  expect(evidence.rect.right, `${label}: destra`).toBeLessThanOrEqual(evidence.edges.right + 1);
  expect(evidence.rect.bottom, `${label}: basso`).toBeLessThanOrEqual(evidence.edges.bottom + 1);
}

async function fixture(page: Page) {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  return page.evaluate(async () => {
    async function post(route: string, value: unknown) {
      const response = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
      if (!response.ok) throw new Error(`Synthetic fixture ${route}: ${response.status}`);
      return response.json();
    }
    const patient = await post('/api/patients', { firstName: 'Dimensione', lastName: 'Sintetica', taxCode: `LAY${crypto.randomUUID().slice(0, 8)}`,
      birthDate: '1972-04-12T00:00:00.000Z', diagnoses: [{ system: 'ICD-11', code: 'BA00', description: 'Diagnosi sintetica' }],
      notes: 'Cartella inventata per la verifica delle dimensioni dei comandi.' });
    return patient.id as string;
  });
}

async function capture(page: Page, name: string, info: TestInfo) {
  mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${info.title.replace(/[^\w-]+/g, '-')}-${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
}

async function pageHealth(page: Page) {
  await expect(page.locator('h1').first()).toBeVisible();
  await expect(page).toHaveTitle(/MediFlow/);
  await expect(page.getByLabel('MediFlow lock screen')).toHaveCount(0);
  await expect(page.locator('nextjs-portal')).not.toContainText(/Runtime Error|Build Error|Unhandled Runtime/);
  await expect(page.locator('[data-twin-workspace]')).toBeVisible();
  const canvas = page.getByTestId('lume-frame-canvas');
  if (await canvas.count()) await assertNoHorizontalOverflow(page, [{ label: 'canvas', selector: '[data-testid="lume-frame-canvas"]' }]);
  await assertNoHorizontalOverflow(page, [
    { label: 'documento', selector: 'document' },
    { label: 'piano', selector: '[data-twin-workspace]' },
  ]);
}

for (const theme of ['light', 'dark']) {
  test(`comandi completi e orientamento ${theme}`, async ({ page }, info) => {
    test.setTimeout(90_000);
    await page.addInitScript(value => localStorage.setItem('mediflow-theme', value), theme);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const id = await fixture(page);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1328, height: 769 }, { width: 320, height: 760 }]) {
      await page.setViewportSize(viewport);
      const routes = [['pazienti', `/?area=incarico&paziente=${id}`], ['repertori', '/?area=repertori']];
      for (const [name, route] of routes) await test.step(`${name} ${viewport.width}px`, async () => {
        await page.goto(route);
        await pageHealth(page);
        await expect(page.locator('html')).toHaveClass(new RegExp(theme));
        if (name === 'pazienti' && viewport.width > 850) {
          const open = page.getByRole('link', { name: 'Apri scheda paziente', exact: true });
          const more = page.getByRole('button', { name: 'Altre azioni paziente', exact: true });
          await expect(open).toBeVisible();
          await assertControlUnclipped(open, 'Apri scheda al primo ingresso');
          await assertControlUnclipped(more, 'Altre azioni al primo ingresso');
          await more.focus(); await more.press('ArrowDown');
          const menu = page.getByRole('menu');
          await expect(menu).toBeVisible();
          for (const item of await menu.getByRole('menuitem').all()) await assertControlUnclipped(item, 'azione paziente');
          await page.keyboard.press('Escape');
          await expect(menu).toHaveCount(0);
          await expect(more).toBeFocused();
        }
        const label = name === 'pazienti' ? 'Pazienti' : 'Repertori';
        await expect(page.getByRole('navigation', { name: 'Cartelle aperte' }).getByRole('link', { name: label, exact: true })).toBeVisible();
        if (name === 'repertori') await expect(page.getByRole('button', { name: 'Cerca nella lista pazienti', exact: true })).toHaveCount(0);
        if (name === 'repertori') {
          const metadata = page.locator('[class*="catalogRow"]').filter({ hasText: 'ICD-11 WHO' }).locator(':scope > span').first();
          const gap = await metadata.evaluate(element => {
            const range = document.createRange(); range.selectNodeContents(element);
            const status = element.nextElementSibling!.getBoundingClientRect();
            return [...range.getClientRects()].filter(rect => rect.top < status.bottom && rect.bottom > status.top)
              .map(rect => status.left - rect.right);
          });
          for (const distance of gap) expect(distance, 'Contenuto locale separato dallo stato').toBeGreaterThanOrEqual(12);
          const manage = page.getByRole('link', { name: 'Gestisci repertori', exact: true });
          for (const control of [manage, ...await page.getByRole('button', { name: /Mostra dettaglio repertorio/ }).all()]) {
            await control.scrollIntoViewIfNeeded();
            await assertControlUnclipped(control, 'comando Repertori');
            await expect(control).toHaveCSS('box-shadow', 'none');
            await expect(control).toHaveCSS('border-right-width', '1px');
          }
          const detail = page.getByRole('button', { name: /Mostra dettaglio repertorio.*esenzioni/ });
          await detail.focus(); await page.keyboard.press('Enter');
          await expect(detail).toHaveAttribute('aria-pressed', 'true');
          const settings = page.getByRole('region', { name: /Dettaglio Codifiche esenzioni/ }).getByRole('link');
          await settings.scrollIntoViewIfNeeded(); await settings.focus();
          await assertControlUnclipped(settings, 'Impostazioni in fondo al dettaglio');
          await expect(settings).toHaveCSS('outline-style', 'solid');
        }
        await capture(page, `${viewport.width}-${name}`, info);
      });
    }
    await page.goto('/?area=turno');
    await expect(page.getByRole('navigation', { name: 'Cartelle aperte' }).getByRole('link', { name: 'Agenda', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cerca nella lista pazienti', exact: true })).toHaveCount(0);
    expect(errors, 'nessun errore runtime durante il percorso').toEqual([]);
  });
}

test.describe('toolbar mobile', () => {
  test.use({ hasTouch: true, viewport: { width: 320, height: 812 } });

  test('comandi in Altro conservano accesso touch e focus', async ({ page }, info) => {
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => localStorage.setItem('mediflow-theme', value), theme);
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 812 });
        await page.goto('/?area=repertori');
        await pageHealth(page);
        await expect(page.getByRole('button', { name: /Mostra dettaglio repertorio/ }).first()).toBeVisible();
        await expect(page.locator('[data-mobile-commands="workspace"]')).toBeHidden();
        const canvas = page.getByTestId('lume-frame-canvas');
        const panel = page.getByTestId('lume-frame-panel');
        const canvasBox = await canvas.boundingBox();
        const panelBox = await panel.boundingBox();
        expect(panelBox!.y - canvasBox!.y, 'nessuna riga vuota prima del contenuto').toBeLessThanOrEqual(1);

        const summary = page.getByRole('navigation', { name: 'Navigazione principale' }).locator('summary').filter({ hasText: /^Altro$/ });
        const command = page.getByRole('button', { name: 'Comandi e aiuto', exact: true });
        await summary.tap();
        await assertControlUnclipped(command, 'Comandi e aiuto in Altro');
        expect((await command.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await capture(page, `${theme}-${width}-altro`, info);
        await command.tap();
        const dialog = page.getByRole('dialog', { name: 'Comandi MediFlow', exact: true });
        await expect(dialog).toBeVisible();
        await expect(page.getByRole('combobox', { name: 'Cerca un comando' })).toBeFocused();
        await expect(summary.locator('..')).not.toHaveAttribute('open');
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(summary).toBeFocused();

        await page.keyboard.press('Enter');
        await command.focus();
        await page.keyboard.press('Enter');
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(summary).toBeFocused();
        await page.keyboard.press('Control+k');
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(summary).toBeFocused();
      }
    }
    await page.setViewportSize({ width: 701, height: 812 });
    await expect(page.getByRole('button', { name: 'Apri comandi e aiuto tastiera' })).toBeVisible();
    await page.getByRole('button', { name: 'Apri comandi e aiuto tastiera' }).click();
    await expect(page.getByRole('dialog', { name: 'Comandi MediFlow' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 320, height: 812 });
    await page.goto('/settings');
    await page.getByText('Altro', { exact: true }).tap();
    await expect(page.getByRole('button', { name: 'Comandi e aiuto', exact: true })).toHaveCount(0);
    await page.goto('/mockups/kree8');
    await page.getByRole('button', { name: 'Apri comandi e aiuto tastiera' }).click();
    await expect(page.getByRole('dialog', { name: 'Comandi MediFlow' })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  });
});
