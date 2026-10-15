import { mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { bootstrapUnlockedSession, openPatientSection } from './utils';

const PANES = ['quadro', 'attenzione', 'identita', 'clinica', 'amministrazione', 'parametri', 'terapie',
  'prestazioni', 'protesica', 'scale', 'documenti', 'siss', 'timeline', 'diario', 'follow-up'];
const SHOTS = process.env.TYPE_SCALE_SHOTS_DIR || path.join(process.platform === 'win32' ? tmpdir() : '/tmp', 'type-scale-shots');

function settingsRoutes(directory = 'app/settings'): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return settingsRoutes(file);
    return entry.name === 'page.tsx' ? [directory.replace(/^app/, '')] : [];
  }).sort();
}

async function measureText(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const scale = parseFloat(root.fontSize) / 16;
    const firstFamily = (family: string) => family.split(',')[0].trim().replace(/["']/g, '').toLowerCase();
    const families = {
      system: 'system-ui',
      voice: firstFamily(root.getPropertyValue('--font-voce')),
      code: firstFamily(root.getPropertyValue('--font-registro')),
    };
    const samples: { text: string; element: string; family: string; weight: number; size: number; issue: string | null }[] = [];
    const rendered = (element: Element) => {
      if (!element.getClientRects().length) return false;
      for (let owner: Element | null = element; owner; owner = owner.parentElement) {
        const style = getComputedStyle(owner);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      }
      return true;
    };
    function record(element: Element, text: string, pseudo?: string) {
      if (!text.trim() || !rendered(element)) return;
      const style = getComputedStyle(element, pseudo);
      const family = firstFamily(style.fontFamily);
      const size = parseFloat(style.fontSize) / scale;
      const weight = Number(style.fontWeight);
      const isSize = (values: number[]) => values.some(value => Math.abs(value - size) < 0.02);
      let issue: string | null = null;
      if (family === families.system) {
        if (![400, 600].includes(weight) || !isSize([12, 13, 14, 15])) issue = 'Sistema fuori scala';
      } else if (families.voice && family === families.voice) {
        if (!(weight === 400 && isSize([17, 22, 26, 28])) && !(weight === 500 && isSize([21]))) issue = 'Newsreader fuori ruolo';
        if (element.closest('button, input, select, [role="button"], summary, table, [role="alert"]')) issue = 'Serif su comando, tabella o errore';
      } else if (families.code && family === families.code) {
        if (weight !== 400 || !isSize([12])) issue = 'Codice fuori scala';
        if (!element.closest('code, pre, .type-code, .lume-code, [data-type-code]')) issue = 'Mono senza ruolo codice';
      } else issue = 'Famiglia non prevista';
      if (!document.fonts.check(`${weight} ${style.fontSize} ${style.fontFamily.split(',')[0]}`)) issue = 'Carattere non caricato';
      samples.push({ text: text.trim().slice(0, 90), element: `${element.tagName.toLowerCase()}.${element.getAttribute('class') || ''}${pseudo || ''}`, family, weight, size, issue });
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const element = node.parentElement;
      // Framework dev chrome is a separate shadow tree; scripts and SVG icons are not product text.
      if (!element || element.closest('script, style, noscript, nextjs-portal, svg:not(:has(text))')) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      if ([...range.getClientRects()].some(rect => rect.width > 0 && rect.height > 0)) record(element, node.textContent || '');
    }
    for (const field of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea')) {
      record(field, field.value || field.placeholder, !field.value && field.placeholder ? '::placeholder' : undefined);
    }
    for (const select of document.querySelectorAll('select')) record(select, select.selectedOptions[0]?.textContent || '');
    for (const element of document.querySelectorAll('body *')) {
      if (element.closest('script, style, svg, nextjs-portal')) continue;
      for (const pseudo of ['::before', '::after']) {
        const content = getComputedStyle(element, pseudo).content;
        // Pure dots, arrows and clinical glyphs are decorative shapes, not type samples.
        if (/^['"].*[\p{L}\p{N}].*['"]$/u.test(content)) record(element, content.slice(1, -1), pseudo);
      }
    }
    return { families, samples, combinations: [...new Set(samples.map(({ family, weight, size }) => `${family} / ${weight} / ${size.toFixed(2)}`))].sort() };
  });
}

async function assertType(page: Page, label: string, info: TestInfo, minimum = 10) {
  const measured = await measureText(page);
  expect(measured.samples.length, `${label}: la pagina deve contenere testo`).toBeGreaterThan(minimum);
  await info.attach(`${label.replace(/[^\w-]/g, '_')}-type.json`, { body: JSON.stringify(measured, null, 2), contentType: 'application/json' });
  expect.soft(measured.samples.filter(sample => sample.issue), label).toEqual([]);
}

async function expandDetails(page: Page) {
  for (const detail of await page.locator('main details:not([open]), [data-testid="settings-subroute-content"] details:not([open])').all()) {
    if (await detail.isVisible()) await detail.locator('summary').first().click();
  }
}

async function screenshot(page: Page, name: string, theme: string) {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}-after-${theme}.png`), fullPage: true, animations: 'disabled' });
}

async function createFixture(page: Page) {
  return page.evaluate(async suffix => {
    async function post(route: string, body: unknown) {
      const response = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
      return response.json();
    }
    const patient = await post('/api/patients', {
      firstName: 'Ada', lastName: `Tipografia${suffix}`, taxCode: `TYP${suffix}`, birthDate: '1972-04-12T00:00:00.000Z',
      notes: 'Nota esclusivamente sintetica per la verifica della tipografia.',
      diagnoses: [{ system: 'ICD-11', code: 'SC00', description: 'Diagnosi sintetica', date: '2026-10-15T08:00:00.000Z' }],
    });
    await post('/api/therapies', { patientId: patient.id, drugName: 'Farmaco sintetico', dosage: '5 mg', status: 'active', startDate: '2026-10-15T08:00:00.000Z' });
    await post('/api/entries', { patientId: patient.id, type: 'note', title: 'Visita sintetica',
      content: 'Prosa clinica sintetica con **enfasi** e `SC00`.\n\n## Valutazione\n\nControllo programmato.',
      date: new Date().toISOString(), setting: 'ambulatory', metadata: { workflowStatus: 'draft' } });
    return { id: patient.id as string, name: `Tipografia${suffix} Ada` };
  }, `${Date.now()}`.slice(-10) + Math.random().toString(36).slice(2, 5));
}

async function cleanupFixture(page: Page, id: string) {
  await page.evaluate(async patientId => {
    const entries = await fetch(`/api/entries?patientId=${patientId}`);
    if (!entries.ok) throw new Error('Rilettura voci sintetiche fallita');
    for (const entry of await entries.json() as { id: string; version: number }[]) {
      const response = await fetch(`/api/entries/${entry.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: entry.version }) });
      if (!response.ok) throw new Error('Cleanup voce sintetica fallito');
    }
    const response = await fetch(`/api/patients/${patientId}`);
    if (!response.ok) throw new Error('Rilettura paziente sintetico fallita');
    const patient = await response.json() as { version: number };
    const removed = await fetch(`/api/patients/${patientId}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: patient.version }) });
    if (!removed.ok) throw new Error('Cleanup paziente sintetico fallito');
  }, id);
}

const ROUTES = ['/', '/?area=incarico', '/?area=turno', '/?area=diario', '/?area=repertori', '/analytics', '/scales',
  '/patients/[id]/modules', '/patients/[id]/scales', '/patients/[id]/scales/adl',
  '/patients/[id]/entries/new', '/patients/[id]/edit', '/patients/new', '/patients/import', ...settingsRoutes()];

const typographyTest = test.extend<{ patientFixture: { id: string; name: string } }>({
  patientFixture: async ({ page }, runTest) => {
    const fixture = await createFixture(page);
    try {
      await runTest(fixture);
    } finally {
      await cleanupFixture(page, fixture.id);
    }
  },
});

for (const routePattern of ROUTES) {
  typographyTest.describe(`Punto: testo renderizzato ${routePattern}`, () => {
    typographyTest.setTimeout(routePattern.endsWith('/modules') ? 180_000 : 120_000);
    for (const theme of ['light', 'dark'] as const) {
      typographyTest.describe(theme, () => {
        typographyTest.beforeEach(async ({ page }) => {
          await page.setViewportSize({ width: 1440, height: 960 });
          await page.addInitScript(value => localStorage.setItem('mediflow-theme', value), theme);
          await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
        });
        typographyTest('pagina e dettagli', async ({ page, patientFixture: fixture }, info) => {
          const route = routePattern.replace('[id]', fixture.id);
          const response = await page.goto(route);
          expect(response?.ok(), route).toBeTruthy();
          await page.waitForLoadState('networkidle');
          if (route === '/') {
            await expect(page.locator('h1').or(page.getByTestId('work-profile-onboarding')).first()).toBeVisible();
            const onboarding = page.getByTestId('work-profile-onboarding');
            if (await onboarding.isVisible()) {
              await expect(onboarding).toHaveAttribute('aria-busy', 'false');
              await screenshot(page, 'onboarding', theme);
            }
          } else await expect(page.locator('h1').first()).toBeVisible();
          await expect(page.getByLabel('MediFlow lock screen')).toHaveCount(0);
          await expect(page.locator('.mf-skeleton:visible')).toHaveCount(0);
          await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`));
          if (route.endsWith('/modules')) {
            const person = page.getByRole('heading', { name: fixture.name, exact: true });
            await expect(person).toBeVisible();
            await expect(person).toHaveCSS('font-size', '28px');
            await expect(person).toHaveCSS('font-weight', '400');
          }
          if (route === '/settings/ai/modelli') await expect(page.getByRole('button', { name: 'Salva Configurazione', exact: true })).toBeEnabled();
          await assertType(page, route, info);
          if (route === '/analytics') await screenshot(page, 'analisi', theme);
          if (route === '/settings/ai/modelli') await screenshot(page, 'modelli', theme);
          if (route.endsWith('/modules')) {
            await screenshot(page, 'scheda', theme);
            for (const pane of PANES) {
              await openPatientSection(page, pane);
              if (pane === 'diario') await expect(page.locator('#diario > h3 .apple-chip')).toHaveText('1 voce');
              await expandDetails(page);
              await assertType(page, `scheda-${pane}`, info);
            }
          } else {
            await expandDetails(page);
            await assertType(page, `${route}-dettagli`, info);
          }
          if (route === '/settings/profilo') {
            const onboarding = page.getByTestId('work-profile-onboarding');
            await expect(onboarding).toHaveAttribute('aria-busy', 'false');
            await assertType(page, 'onboarding', info);
            await screenshot(page, 'profilo', theme);
          }
        });
      });
    }
  });
}

for (const theme of ['light', 'dark'] as const) {
  typographyTest.describe(`Punto: preferenze di lettura, ${theme}`, () => {
    typographyTest.setTimeout(120_000);
    typographyTest.beforeEach(async ({ page }) => {
      await page.addInitScript(value => localStorage.setItem('mediflow-theme', value), theme);
      await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    });
    typographyTest('scheda a larghezze e dimensioni del testo diverse', async ({ page, patientFixture: fixture }, info) => {
      await page.goto(`/patients/${fixture.id}/modules`);
      await expect(page.getByRole('heading', { name: fixture.name, exact: true })).toBeVisible();
      for (const [width, rootSize] of [[390, 16], [1440, 20], [768, 32]]) {
        await page.setViewportSize({ width, height: 960 });
        await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, rootSize);
        await assertType(page, `preferenza-${width}-${rootSize}`, info);
      }
    });
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`Punto: marchio e tipografia di avvio e sblocco, ${theme}`, async ({ page }, info) => {
    await page.addInitScript(value => localStorage.setItem('mediflow-theme', value), theme);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/auth/check', async route => { await held; await route.continue(); });
    try {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Avvio di MediFlow', exact: true })).toBeVisible();
      await expect(page.locator('.type-brand')).toHaveText('MediFlow');
      await expect(page.locator('.type-brand')).toHaveCSS('font-size', '21px');
      await assertType(page, `avvio-${theme}`, info, 2);
    } finally {
      release();
      await page.unrouteAll({ behavior: 'wait' });
    }
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    await page.getByRole('button', { name: 'Blocca', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sblocca MediFlow', exact: true })).toBeVisible();
    await expect(page.locator('.type-brand')).toHaveCSS('font-size', '21px');
    await assertType(page, `sblocco-${theme}`, info, 2);
  });
}

test('il misuratore intercetta ereditarietà serif, controlli, stili inline e testo nascosto', async ({ page }) => {
  await page.setContent(`<style>:root { --font-voce: Georgia; --font-registro: monospace; font-size:16px }
    body { font:400 14px system-ui } .hidden { display:none } .voice { font:400 26px Georgia }</style>
    <p>Testo valido</p><p style="font-weight:550">Peso errato</p><p style="font-size:11px">Corpo errato</p>
    <button class="voice">Comando serif</button><input value="Campo errato" style="font:600 13px Georgia">
    <div class="hidden"><span style="font:700 10px Georgia">Non visibile</span></div>`);
  const measured = await measureText(page);
  expect(measured.samples.filter(sample => sample.issue).map(sample => sample.text).sort())
    .toEqual(['Campo errato', 'Comando serif', 'Corpo errato', 'Peso errato']);
  expect(measured.samples.some(sample => sample.text === 'Non visibile')).toBe(false);
});
