import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import { openPatientSection, unlockIfNeeded, isVisible } from '../../e2e/utils';
import { fetchInterceptedRequest } from '../../e2e/fixtures/trusted-web-request';

const data = process.env.MEDIFLOW_DATA_DIR!;
function reference() {
  const scratch = process.env.MF_BANCO_SCRATCH || '/Volumes/Vision/mf-ui-identita-20261107-scratch';
  if (!data?.startsWith(`${scratch}/`) || !fs.existsSync(`${data}/SYNTHETIC_ONLY`)) throw new Error('Solo archivio sintetico');
  return JSON.parse(fs.readFileSync(`${data}/reference.json`, 'utf8')).referenceId as string;
}
async function navigate(page: Page, path: string) {
  await page.goto(path);
  if (await isVisible(page.getByLabel('PIN operatore').first(), 2500)) {
    // Lo sblocco resta occupato finché la sessione aperta dal banco non è chiusa: si agisce dopo.
    await expect(page.locator('form[aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 });
    await unlockIfNeeded(page, '314159');
  }
  await expect(page.getByLabel('MediFlow lock screen')).toBeHidden();
}

test('errore di lettura critico nella colonna e ripetizione funzionante', async ({ page }) => {
  const id = reference();
  await navigate(page, `/patients/${id}/modules`);
  await page.route(`**/api/patients/${id}`, route => route.abort('connectionrefused'));
  await page.reload();
  const error = page.getByRole('alert').filter({ hasText: 'Impossibile leggere la scheda paziente.' });
  await expect(error).toContainText('✕');
  await expect(error).toHaveAttribute('data-view-state', 'error');
  await expect(error).not.toHaveCSS('border-style', 'dashed');
  await expect(error).toHaveCSS('border-width', '0px');
  await page.unroute(`**/api/patients/${id}`);
  await error.getByRole('button', { name: 'Riprova', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Rossi Sintetica Maria', exact: true })).toBeVisible();
});

test('formattazione compatta lascia almeno 200 px di testo sopra la soglia', { tag: '@stretto' }, async ({ page }) => {
  page.on('dialog', dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss());
  for (const route of ['entries/new', 'modules?voce=nuova']) {
  await navigate(page, `/patients/${reference()}/${route}`);
  await expect(page.getByText('Rossi Sintetica Maria', { exact: true }).first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const editor = page.locator('[contenteditable="true"]').first();
  await expect(editor).toBeVisible();
  await editor.fill('Nota sintetica in preparazione: controllo clinico programmato.');
  await expect(page.getByTestId('local-draft-status')).toContainText(/conservati cifrati|Bozza recuperata/);
  await expect.poll(() => editor.evaluate(field => Math.ceil(field.getBoundingClientRect().right) - innerWidth)).toBeLessThanOrEqual(0);
  const geometry = await editor.evaluate(field => {
    const toolbar = document.querySelector('[data-lume-editor-surface="toolbar"]')!.getBoundingClientRect();
    const threshold = document.querySelector('button[type="submit"]')!.parentElement!.getBoundingClientRect();
    const box = field.getBoundingClientRect();
    return { toolbarHeight: toolbar.height, visibleText: Math.min(box.bottom, threshold.top, innerHeight) - Math.max(box.top, 0) };
  });
  console.log(JSON.stringify({ route, ...geometry }));
  expect.soft(geometry.toolbarHeight).toBeLessThanOrEqual(64);
  expect(geometry.visibleText).toBeGreaterThanOrEqual(200);
  }
});

test('elenco a 1440 per 900 mostra 14 pazienti con righe di 40 px', { tag: '@largo' }, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigate(page, '/?area=incarico');
  const rows = page.getByTestId('lume-patient-row');
  await expect(rows.first()).toBeVisible();
  await expect(page.locator('[data-worklist-todo="ready"]').first()).toBeVisible();
  const geometry = await rows.evaluateAll(elements => {
    const list = document.querySelector('[data-testid="lume-patient-list"]')!.getBoundingClientRect();
    const boxes = elements.map(element => element.getBoundingClientRect());
    return { heights: boxes.map(box => box.height), visible: boxes.filter(box => box.top >= list.top - 1 && box.bottom <= Math.min(list.bottom, innerHeight) + 1).length };
  });
  console.log(JSON.stringify(geometry));
  expect.soft(geometry.heights.every(height => Math.abs(height - 40) <= 1), JSON.stringify(geometry.heights)).toBe(true);
  expect(geometry.visible).toBeGreaterThanOrEqual(14);
});

test('voce con data ora tipo luogo e autore conserva provenienza e stato', async ({ page }) => {
  const id = reference();
  await page.route('**/api/entries?*', async route => {
    if (new URL(route.request().url()).searchParams.get('patientId') !== id) return route.continue();
    const response = await fetchInterceptedRequest(route);
    const rows = await response.json();
    await route.fulfill({ response, json: rows.map((row: object) => ({ ...row, setting: 'ambulatory', metadata: { authorName: 'Ada Sintetica', sourceLabel: 'Fonte sintetica', workflowStatus: 'registered' } })) });
  });
  await navigate(page, `/patients/${id}/modules`);
  const overviewRow = page.locator('#diario article').filter({ hasText: 'Pressione 132/78' });
  await expect(overviewRow).toBeVisible();
  if (test.info().project.name.endsWith('1440')) await expect(overviewRow).toHaveCSS('grid-template-columns', /^84px /);
  await openPatientSection(page, 'diario');
  const row = page.locator('#diario article').filter({ hasText: 'Pressione 132/78' });
  await expect(row).toBeVisible();
  // ADR 0183: l'autore nei metadati non attesta chi ha registrato; vale l'operatore autenticato.
  await expect(row.locator('[data-ink="dry"]')).toHaveText(/^Registrata da Benchmark sintetico il \d{2} \p{L}+ \d{4} alle \d{2}:\d{2}$/u);
  await expect.soft(row.locator('[class*="identity"] > span').first()).toHaveCSS('font-weight', '600');
  await expect(row).toContainText('Ambulatorio');
  await expect(row).toContainText('Fonte sintetica');
  await expect(row.locator(':scope > time')).toContainText(/\d{2}:\d{2}/);
  if (test.info().project.name.endsWith('1440')) await expect(row).toHaveCSS('grid-template-columns', /^84px /);
  else await expect(row.locator(':scope > time')).toHaveCSS('flex-direction', 'row');
});

test('Nuova voce dalla scheda conserva identità quadro e diario', async ({ page }) => {
  const id = reference();
  await navigate(page, `/patients/${id}/modules`);
  await page.getByRole('link', { name: 'Nuova voce', exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`/patients/${id}/modules\\?voce=nuova`));
  await expect(page.getByTestId('lume-scheda-header')).toContainText('Rossi Sintetica Maria');
  const editor = page.locator('#diario [contenteditable="true"]');
  await expect(editor).toBeVisible();
  await editor.fill('Nota sintetica non registrata.');
  await expect(page.locator('#diario')).toContainText('Pressione 132/78');
  await expect(page.locator('#quadro')).toBeVisible();
  await editor.evaluate(element => element.scrollIntoView({ block: 'center' }));
  const header = page.getByTestId('lume-scheda-header');
  expect((await header.boundingBox())!.y).toBeGreaterThanOrEqual(0);
});

test('Impostazioni compatte con sezioni scorrevoli e margini di 16 px', { tag: '@stretto' }, async ({ page }) => {
  await navigate(page, '/settings');
  const strip = page.locator('[data-settings-strip]');
  expect((await page.getByTestId('settings-subroute-content').boundingBox())!.x).toBe(16);
  await expect(strip).toBeVisible();
  const geometry = await strip.evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth, rows: [...element.children].map(child => child.getBoundingClientRect().top) }));
  expect(geometry.scroll).toBeGreaterThan(geometry.width);
  expect(new Set(geometry.rows).size).toBe(1);
  await navigate(page, `/patients/${reference()}/modules`);
  const body = page.locator('[data-testid="lume-scheda-scroll"] > [data-folder-section]').last();
  await expect(body).toHaveCSS('padding-left', '16px');
  await expect(body).toHaveCSS('padding-right', '16px');
});


test('pagina separata: metadati entro il piano alla soglia delle due colonne', { tag: '@giorno-largo' }, async ({ page }) => {
  page.on('dialog', dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss());
  await navigate(page, `/patients/${reference()}/entries/new`);
  const composer = page.getByTestId('progressive-entry-composer');
  await expect(composer).toBeVisible();
  await composer.evaluate(element => { (element as HTMLElement).style.width = '1060px'; (element as HTMLElement).style.maxWidth = 'none'; });
  await page.evaluate(() => document.fonts.ready);
  const geometry = await composer.evaluate(element => {
    const form = element.querySelector('form')!;
    const metadata = form.querySelector('[class*="metadata"]')!;
    const box = form.getBoundingClientRect();
    return {
      pageContent: element.clientWidth - 40,
      columns: getComputedStyle(element.querySelector('[class*="layout"]')!).gridTemplateColumns,
      clientWidth: form.clientWidth, scrollWidth: form.scrollWidth,
      fields: Array.from(metadata.querySelectorAll('select, input')).map(field => {
        const rect = field.getBoundingClientRect();
        return { left: rect.left - box.left, right: rect.right - box.left, width: rect.width };
      }), formWidth: box.width,
    };
  });
  console.log('CRITICAL_METADATA ' + JSON.stringify(geometry));
  await expect(composer.getByRole('button', { name: 'Consulta il Quadro', exact: true })).toBeHidden();
  expect(geometry.pageContent).toBe(1020);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  expect(geometry.fields).toHaveLength(3);
  for (const field of geometry.fields) {
    expect(field.left).toBeGreaterThanOrEqual(0);
    expect(field.right).toBeLessThanOrEqual(geometry.formWidth);
  }
});
