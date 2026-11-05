import { expect, test, type Page } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

// Scala web dei raggi di Punto d'inchiostro (docs/design/punto-inchiostro/01-specifica.md):
// righe e record 0, controlli 10, voce in scrittura 12, piano 16. Cerchi e
// pillole (raggio pari almeno a metà del lato corto) sono misurati a parte.
const WEB_RADIUS_SCALE = [0, 10, 12, 16];

const VIEWPORTS = [
  { name: 'wide', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
] as const;

type Theme = 'light' | 'dark';

async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate((next) => {
    localStorage.setItem('mediflow-theme', next);
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(next);
  }, theme);
}

async function createPatient(page: Page): Promise<string> {
  const marker = Date.now().toString().slice(-8) + Math.random().toString(36).slice(2, 6);
  return page.evaluate(async (fixtureMarker) => {
    const response = await fetch('/api/patients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: `Geometria${fixtureMarker}`,
        lastName: `Sintetica${fixtureMarker}`,
        taxCode: `GEO${fixtureMarker.padStart(13, '0')}`,
        birthDate: '1975-03-02T00:00:00.000Z',
        notes: 'Paziente sintetico per la scala dei raggi. Nessun dato reale.',
        diagnoses: [{ system: 'ICD-11', code: 'GE00', description: 'Condizione sintetica con una descrizione lunga per la geometria', date: new Date().toISOString() }],
      }),
    });
    if (!response.ok) throw new Error(`Fixture geometria: HTTP ${response.status}`);
    return ((await response.json()) as { id: string }).id;
  }, marker);
}

/** Superfici visibili (bordo, fondo o ombra) con raggio fuori scala. */
async function offScaleRadii(page: Page): Promise<string[]> {
  return page.evaluate((scale) => {
    const allowed = new Set(scale);
    const found = new Set<string>();
    const transparent = (value: string) => value === 'rgba(0, 0, 0, 0)' || value === 'transparent';
    for (const element of document.querySelectorAll<HTMLElement>('body *')) {
      const box = element.getBoundingClientRect();
      if (box.width < 4 || box.height < 4) continue;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      const bordered = ['Top', 'Right', 'Bottom', 'Left'].some((side) =>
        Number.parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0
        && style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none'
        && !transparent(style.getPropertyValue(`border-${side.toLowerCase()}-color`)));
      if (!bordered && transparent(style.backgroundColor) && style.boxShadow === 'none') continue;
      for (const corner of ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'] as const) {
        const raw = style[corner];
        if (raw.endsWith('%')) continue;
        const radius = Math.round(Number.parseFloat(raw) * 10) / 10;
        if (radius >= Math.min(box.width, box.height) / 2 - 0.5) continue;
        if (!allowed.has(radius)) {
          const name = typeof element.className === 'string' ? element.className.trim().split(/\s+/)[0] : '';
          found.add(`${element.tagName.toLowerCase()}${name ? `.${name}` : ''} ${raw}`);
        }
      }
    }
    return [...found];
  }, WEB_RADIUS_SCALE);
}

for (const viewport of VIEWPORTS) {
  for (const theme of ['light', 'dark'] as const) {
    test(`raggi nella scala Punto d'inchiostro, ${theme} ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
      await setTheme(page, theme);
      const patientId = await createPatient(page);
      const routes = [
        '/?area=incarico',
        '/?area=turno',
        `/patients/${patientId}/modules`,
        '/patients/new',
        `/patients/${patientId}/entries/new`,
      ];
      const violations: string[] = [];
      for (const route of routes) {
        await page.goto(route);
        await page.waitForLoadState('networkidle');
        await expect(page.locator('main').first()).toBeVisible();
        for (const item of await offScaleRadii(page)) violations.push(`${route} ${item}`);
      }
      expect(violations).toEqual([]);
    });
  }
}

test('nuova scheda: è segnata solo la sezione corrente', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await page.goto('/patients/new');
  const current = page.locator('a[href="#documento"]');
  const other = page.locator('a[href="#dati"]');
  await expect(current).toHaveAttribute('aria-current', 'location');
  await expect(other).not.toHaveAttribute('aria-current', 'location');
  const look = (locator: typeof current) => locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, border: style.borderTopWidth, shadow: style.boxShadow };
  });
  const [currentLook, otherLook] = await Promise.all([look(current), look(other)]);
  // La sezione non corrente resta testo: nessun fondo pieno, nessuna cornice.
  expect(otherLook).toEqual({ background: 'rgba(0, 0, 0, 0)', border: '0px', shadow: 'none' });
  // La sezione corrente porta il filetto d'inchiostro sotto, come le linguette della Scheda.
  expect(currentLook.shadow).toMatch(/inset 0px -2px 0px 0px/);
});
