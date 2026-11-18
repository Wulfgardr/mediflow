import { expect, test, type Locator, type Page } from '@playwright/test';
import { assertNoHorizontalOverflow, bootstrapUnlockedSession, openPatientSection, unlockIfNeeded } from './utils';

test.describe.configure({ retries: 0 });

const pin = process.env.E2E_PIN || '1234';

async function post(page: Page, route: string, body: unknown) {
  const status = await page.evaluate(async ({ route, body }) => (await fetch(route, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })).status, { route, body });
  expect(status, `POST ${route}`).toBeLessThan(300);
}

async function syntheticPatient(page: Page, identity: Record<string, unknown>) {
  const id = `first-glance-${crypto.randomUUID()}`;
  await post(page, '/api/patients', { id, firstName: 'Scheda', lastName: 'Sintetica',
    diagnoses: [{ code: 'I50.9', description: 'Scompenso cardiaco sintetico', system: 'ICD-10' }], ...identity });
  const therapy = (suffix: string, fields: Record<string, unknown>) => post(page, '/api/therapies', {
    id: `${id}-${suffix}`, patientId: id, dosage: '1 cp al mattino', startDate: '2026-03-10T08:00:00.000Z', endDate: null, ...fields });
  await therapy('active', { drugName: 'Farmaco sintetico attivo', activePrinciple: 'Principio sintetico', atc: 'C03CA01', aic: '023993019',
    status: 'active', motivation: 'Nota sintetica di indicazione', diagnosisCode: 'I50.9', diagnosisName: 'Scompenso cardiaco sintetico' });
  await therapy('suspended', { drugName: 'Farmaco sintetico sospeso', status: 'suspended', motivation: 'Sospeso per controllo sintetico' });
  await therapy('ended', { drugName: 'Farmaco sintetico concluso', status: 'completed', endDate: '2026-09-20T08:00:00.000Z' });
  return id;
}

async function openSheet(page: Page, id: string) {
  await page.goto(`/patients/${id}/modules`);
  await unlockIfNeeded(page, pin);
  await expect(page.locator('#quadro').getByRole('table', { name: 'Problemi' })).toBeVisible();
}

const insideWorkArea = (target: Locator) => target.evaluate(element => {
  const rect = element.getBoundingClientRect();
  return rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight;
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await bootstrapUnlockedSession(page, pin);
});

test('Riepilogo: identità, problemi, terapie attive e Quadro paziente senza una visita di riferimento', async ({ page }) => {
  const id = await syntheticPatient(page, { taxCode: '', identifierType: 'none', birthDatePrecision: 'estimated', birthYear: 1984 });
  await openSheet(page, id);

  const header = page.getByTestId('lume-scheda-header');
  await expect(header).toContainText('circa');
  await expect(header).toContainText('Nascita anno stimato 1984');
  await expect(header).toContainText('Nessun identificativo per ora');

  const proposals = page.getByTestId('patient-proposals-summary');
  await expect(proposals).toHaveCount(1);
  await expect(proposals).toContainText('Nessuna proposta da rivedere');
  const quadro = proposals.getByRole('link', { name: 'Apri il Quadro e le fonti', exact: true });
  expect(await insideWorkArea(quadro)).toBe(true);
  const problems = page.locator('#quadro').getByRole('table', { name: 'Problemi' });
  await expect(problems).toBeVisible();
  await expect(page.getByText('Nessuna visita registrata.', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Variazioni dall’ultima visita', exact: true })).toHaveCount(0);
  const active = page.locator('#quadro').getByRole('table', { name: 'Terapie attive' });
  await expect(active.getByRole('row')).toHaveCount(2);
  await expect(active).not.toContainText('Farmaco sintetico sospeso');

  await quadro.click();
  await expect(page.locator('#patient-insight [data-disclosure-control]').first()).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#patient-insight')).toBeVisible();
});

test('Terapie: indicazione, periodo e codici si leggono nella riga, e le sezioni restano raggiungibili', async ({ page }) => {
  const id = await syntheticPatient(page, { taxCode: `FG${crypto.randomUUID().replaceAll('-', '').slice(0, 14).toUpperCase()}`, birthDate: '1950-05-05T00:00:00.000Z' });
  await openSheet(page, id);
  await openPatientSection(page, 'terapie');
  const pane = page.locator('#terapie');
  const row = pane.getByRole('row').filter({ hasText: 'Farmaco sintetico attivo' });
  await expect(row.getByText('Nota sintetica di indicazione', { exact: true })).toBeVisible();
  await expect(row.getByText('Scompenso cardiaco sintetico')).toBeVisible();
  await expect(row.getByText('ATC C03CA01 · AIC 023993019', { exact: true })).toBeVisible();
  await expect(row.getByText('Dal 10/03/2026', { exact: true })).toBeVisible();
  const completed = pane.getByRole('row').filter({ hasText: 'Farmaco sintetico concluso' });
  const start = completed.getByText('Dal 10/03/2026', { exact: true });
  const end = completed.getByText('Conclusa il 20/09/2026', { exact: true });
  await expect(start).toBeVisible();
  await expect(end).toBeVisible();
  await expect(pane.getByText('Dettagli terapia', { exact: true })).toHaveCount(0);

  const sections = page.getByRole('navigation', { name: 'Sezioni della vista', exact: true });
  await page.locator('#terapie table').last().scrollIntoViewIfNeeded();
  expect(await insideWorkArea(sections.getByRole('link', { name: /^Documenti/u }))).toBe(true);

  const trigger = row.getByRole('button', { name: 'Altre azioni per Farmaco sintetico attivo', exact: true });
  await row.getByRole('button', { name: 'Modifica', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(trigger).toBeFocused();
  await page.keyboard.press('ArrowDown');
  const menu = page.getByRole('menu', { name: 'Azioni terapia Farmaco sintetico attivo', exact: true });
  await expect(menu.getByRole('menuitem', { name: 'Sospendi', exact: true })).toBeFocused();
  const items = menu.getByRole('menuitem');
  const last = items.last();
  await expect(last).toHaveText('Elimina (inserita per errore)');
  const probeCorner = (item: Locator, end: 'top' | 'bottom') => item.evaluate((element, edge) => {
    const panel = element.closest('[role=menu]')!;
    const outer = panel.getBoundingClientRect();
    const inner = element.getBoundingClientRect();
    const frame = getComputedStyle(panel);
    const row = getComputedStyle(element);
    const left = outer.left;
    const right = outer.right;
    const verticalInset = edge === 'top' ? inner.top - outer.top : outer.bottom - inner.bottom;
    const outline = Math.max(0, parseFloat(row.outlineWidth) + parseFloat(row.outlineOffset));
    return {
      panel: [frame.borderTopLeftRadius, frame.borderTopRightRadius, frame.borderBottomLeftRadius, frame.borderBottomRightRadius].map(parseFloat),
      frameInsets: [parseFloat(frame.borderLeftWidth) + parseFloat(frame.paddingLeft),
        parseFloat(frame.borderRightWidth) + parseFloat(frame.paddingRight),
        parseFloat(edge === 'top' ? frame.borderTopWidth : frame.borderBottomWidth) + parseFloat(edge === 'top' ? frame.paddingTop : frame.paddingBottom)],
      row: (edge === 'top' ? [row.borderTopLeftRadius, row.borderTopRightRadius] : [row.borderBottomLeftRadius, row.borderBottomRightRadius]).map(parseFloat),
      actualInsets: [inner.left - left, right - inner.right, verticalInset],
      outline,
      focusVisible: element.matches(':focus-visible') && row.outlineStyle !== 'none' && parseFloat(row.outlineWidth) >= 2,
    };
  }, end);
  const top = await probeCorner(items.first(), 'top');
  await test.info().attach('menu-terapia-prima-voce', { body: await menu.screenshot(), contentType: 'image/png' });
  await page.keyboard.press('End');
  await expect(last).toBeFocused();
  const bottom = await probeCorner(last, 'bottom');
  await test.info().attach('menu-terapia-ultima-voce', { body: await menu.screenshot(), contentType: 'image/png' });
  await test.info().attach('geometria-menu-terapia', { body: JSON.stringify({ top, bottom }), contentType: 'application/json' });
  for (const corner of [top, bottom]) {
    expect(corner.panel).toEqual([10, 10, 10, 10]);
    expect(corner.focusVisible).toBe(true);
    corner.actualInsets.forEach((inset, index) => expect(inset).toBeCloseTo(corner.frameInsets[index], 1));
    corner.row.forEach((radius, index) => {
      expect(radius).toBeCloseTo(10 - corner.actualInsets[index], 1);
      expect(radius).toBeCloseTo(10 - corner.actualInsets[2], 1);
    });
    expect(corner.outline).toBe(0);
  }
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();

  await row.getByRole('button', { name: 'Modifica', exact: true }).click();
  await expect(pane.getByRole('textbox', { name: 'Principio attivo', exact: true })).toHaveValue('Principio sintetico');
  await expect(pane.getByRole('group', { name: 'Collegamento clinico', exact: true })).toBeVisible();
  await expect(pane.getByRole('combobox', { name: 'Collegamento clinico', exact: true })).toBeVisible();
  const boundary = () => pane.getByRole('textbox', { name: 'Posologia', exact: true }).evaluate(async element => {
    const channel = (value: number) => { const unit = value / 255; return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4; };
    const luminance = (color: string) => { const [red, green, blue] = color.match(/[\d.]+/gu)!.map(Number); return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue); };
    await Promise.allSettled(element.getAnimations().map(animation => animation.finished));
    const style = getComputedStyle(element);
    const border = luminance(style.borderTopColor);
    const surrounding = getComputedStyle(element.closest('main')!).getPropertyValue('--lume-surface-focal').trim();
    const sample = document.createElement('span');
    sample.style.color = surrounding;
    element.parentElement!.append(sample);
    const outside = luminance(getComputedStyle(sample).color);
    sample.remove();
    return [luminance(style.backgroundColor), outside].map(background => (
      (Math.max(border, background) + 0.05) / (Math.min(border, background) + 0.05)
    ));
  });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => {
      localStorage.setItem('mediflow-theme', value);
      document.documentElement.classList.toggle('light', value === 'light');
      document.documentElement.classList.toggle('dark', value === 'dark');
    }, theme);
    const ratios = await boundary();
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(3);
    await test.info().attach(`contrasto-campo-${theme}`, { body: JSON.stringify(ratios), contentType: 'application/json' });
  }
  await page.setViewportSize({ width: 768, height: 900 });
  await expect(start).toBeVisible();
  await expect(end).toBeVisible();
  await expect(row.getByText('Nota sintetica di indicazione', { exact: true })).toBeVisible();
  await assertNoHorizontalOverflow(page, [{ label: 'therapy pane', selector: '#terapie' }]);
});
