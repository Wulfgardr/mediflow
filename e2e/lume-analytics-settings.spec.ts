/* @Codex LUME-110/68 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { bootstrapUnlockedSession } from './utils';

type ViewCase = {
  register: 'giorno' | 'grafite';
  viewport: 'wide' | 'narrow';
  width: number;
  height: number;
};

const CASES: ViewCase[] = [
  { register: 'giorno', viewport: 'wide', width: 1440, height: 960 },
  { register: 'grafite', viewport: 'wide', width: 1440, height: 960 },
  { register: 'giorno', viewport: 'narrow', width: 390, height: 844 },
  { register: 'grafite', viewport: 'narrow', width: 390, height: 844 },
];

async function createAnalyticsFixture(page: Page): Promise<void> {
  const suffix = `${Date.now()}`.slice(-8) + Math.random().toString(36).slice(2, 7).toUpperCase();
  const response = await page.request.post('/api/patients', {
    data: {
      firstName: `Analisi${suffix.slice(0, 5)}`,
      lastName: `Sintetica${suffix.slice(5)}`,
      taxCode: `ANA${suffix}`,
      birthDate: '1970-04-12T00:00:00.000Z',
      address: 'Fixture sintetica analytics',
      phone: '0000000110',
      isAdi: true,
      diagnoses: [{
        system: 'ICD-11',
        code: 'QA68',
        description: 'Rilevazione sintetica analytics',
        date: '2026-07-17T08:00:00.000Z',
      }],
    },
  });
  expect(response.ok(), `Fixture analytics: HTTP ${response.status()}`).toBe(true);
}

async function gotoWithRegister(
  page: Page,
  path: string,
  register: ViewCase['register'],
): Promise<void> {
  await page.evaluate((value) => {
    const theme = value === 'grafite' ? 'dark' : 'light';
    localStorage.setItem('mediflow-theme', theme);
  }, register);
  await page.goto(path);
  await expect(page.locator('html')).toHaveClass(register === 'grafite' ? /dark/ : /light/);
}

async function expectRegisterFont(locator: Locator, minimum: number): Promise<void> {
  const specimens = await locator.evaluateAll(async (elements) => {
    await document.fonts.ready;
    return elements
      .filter((element) => (element as HTMLElement).offsetParent !== null)
      .map((element) => {
        const style = getComputedStyle(element);
        return {
          available: document.fonts.check(`${style.fontWeight} ${style.fontSize} "IBM Plex Mono"`),
          family: style.fontFamily,
          numericVariant: style.fontVariantNumeric,
        };
      });
  });
  expect(specimens.length).toBeGreaterThanOrEqual(minimum);
  for (const specimen of specimens) {
    expect(specimen.family).toContain('IBM Plex Mono');
    expect(specimen.available).toBe(true);
    expect(specimen.numericVariant).toMatch(/tabular-nums|normal/);
  }
}

async function expectNoSemanticSideBorders(page: Page, rootSelector: string): Promise<void> {
  const offenders = await page.locator(rootSelector).locator('*').evaluateAll((elements) => {
    const root = getComputedStyle(document.documentElement);
    const semanticColors = [
      '--lume-accent',
      '--lume-signal-warning',
      '--lume-signal-critical',
      '--lume-signal-success',
      '--lume-signal-plum',
    ].map((token) => root.getPropertyValue(token).trim());

    return elements.flatMap((element) => {
      const style = getComputedStyle(element);
      const leftWidth = Number.parseFloat(style.borderLeftWidth);
      const rightWidth = Number.parseFloat(style.borderRightWidth);
      const semantic = semanticColors.includes(style.borderLeftColor);
      const asymmetric = leftWidth !== rightWidth || style.borderLeftColor !== style.borderRightColor;
      return leftWidth > 1 || (leftWidth > 0 && semantic && asymmetric)
        ? [element.getAttribute('data-testid') || element.tagName.toLowerCase()]
        : [];
    });
  });
  expect(offenders).toEqual([]);
}

async function setRange(page: Page, label: string, value: number): Promise<void> {
  await page.getByLabel(label).evaluate((element, nextValue) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, String(nextValue));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function expectNarrowAnalytics(page: Page): Promise<void> {
  const layout = await page.evaluate(() => {
    const focus = document.querySelector<HTMLElement>('[data-testid="analytics-focus-surface"]')!;
    const answer = focus.firstElementChild!.getBoundingClientRect();
    const filters = document.querySelector<HTMLElement>('[data-testid="analytics-filter-field"]')!.getBoundingClientRect();
    const scroller = document.querySelector<HTMLElement>('[data-testid="analytics-table-overflow"]')!;
    return {
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      focusOverflow: focus.scrollWidth - focus.clientWidth,
      answerBeforeFilters: answer.top < filters.top,
      tableDeclared: scroller.dataset.horizontalOverflow,
      tableOwnsOverflow: scroller.scrollWidth > scroller.clientWidth,
    };
  });
  expect(layout.documentOverflow).toBeLessThanOrEqual(1);
  expect(layout.focusOverflow).toBeLessThanOrEqual(1);
  expect(layout.answerBeforeFilters).toBe(true);
  expect(layout.tableDeclared).toBe('declared');
  expect(layout.tableOwnsOverflow).toBe(true);
}

async function verifyAnalytics(page: Page, viewCase: ViewCase): Promise<void> {
  await gotoWithRegister(page, '/analytics', viewCase.register);

  const focus = page.getByTestId('analytics-focus-surface');
  await expect(focus).toBeVisible();
  await expect(focus).toHaveAttribute('data-lume-focus', '');
  await expect(page.locator('[data-lume-analytics-focus="true"]')).toHaveCount(1);
  await expect(page.locator('#indicatori > dl')).toHaveCount(1);

  const downstream = page.locator('#diagnosi');
  await downstream.evaluate((element) => element.scrollIntoView({ behavior: 'auto', block: 'center' }));
  await expect(focus).not.toHaveAttribute('data-lume-focus', '');
  await expect(page.locator('[data-lume-focus]')).toHaveCount(1);
  expect(await page.locator('[data-lume-focus]').getAttribute('id')).not.toBe('domanda');
  await focus.evaluate((element) => element.scrollIntoView({ behavior: 'auto', block: 'center' }));
  await expect(focus).toHaveAttribute('data-lume-focus', '');

  const indicatorRows = await page.locator('#indicatori > dl > div').evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element);
    return { shadow: style.boxShadow, radius: Number.parseFloat(style.borderRadius), background: style.backgroundColor };
  }));
  expect(indicatorRows.length).toBe(3);
  for (const row of indicatorRows) {
    expect(row.shadow).toBe('none');
    expect(row.radius).toBe(0);
    expect(row.background).toBe('rgba(0, 0, 0, 0)');
  }

  await expectRegisterFont(page.locator('[data-lume-register-value="true"]'), 8);
  await expectNoSemanticSideBorders(page, '[data-testid="analytics-focus-surface"], #indicatori, #eta, #diagnosi, #audit');
  const progressTransitionDurations = await page.getByTestId('analytics-progress-fill').evaluateAll((elements) =>
    elements.map((element) => getComputedStyle(element).transitionDuration),
  );
  expect(progressTransitionDurations.length).toBeGreaterThan(0);
  expect(new Set(progressTransitionDurations)).toEqual(new Set(['0s']));

  await setRange(page, 'Età minima', 120);
  await setRange(page, 'Età massima', 120);
  await expect(page.getByTestId('analytics-primary-value')).toHaveText('0');
  await expect(page.getByText('Nessuna scheda attiva con età nota rientra nel filtro corrente.')).toBeVisible();
  await setRange(page, 'Età minima', 0);
  await expect(page.getByTestId('analytics-primary-value')).not.toHaveText('0');

  if (viewCase.viewport === 'narrow') await expectNarrowAnalytics(page);
  await page.screenshot({
    path: `/tmp/lume-analytics-${viewCase.register}-${viewCase.viewport}.png`,
    animations: 'disabled',
  });
}

async function verifySettings(page: Page, viewCase: ViewCase): Promise<void> {
  await gotoWithRegister(page, '/settings/profilo', viewCase.register);

  if (viewCase.viewport === 'narrow') {
    const toggle = page.getByTestId('settings-nav-mobile-toggle');
    await toggle.click();
    const active = page.getByTestId('settings-nav-mobile-profilo');
    await expect(active).toHaveAttribute('aria-current', 'page');
    await expect(active.getByText('Attiva')).toBeVisible();
    await active.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
    await toggle.click();
    await page.getByTestId('settings-nav-mobile-backup').click();
    await expect(page).toHaveURL(/\/settings\/backup$/);
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAccessibleName(/Sezione attiva: Backup/);
  } else {
    const active = page.getByTestId('settings-nav-profilo');
    await expect(active).toHaveAttribute('aria-current', 'page');
    await expect(active.getByText('Attiva')).toBeVisible();
  }

  await gotoWithRegister(page, '/settings', viewCase.register);

  const settingsSections = page.locator('[data-settings-section]');
  await expect(settingsSections).toHaveCount(2);
  const primaryCounts = await settingsSections.evaluateAll((sections) => sections.map((section) => ({
    section: section.getAttribute('data-settings-section'),
    primary: section.querySelectorAll('[data-settings-primary="true"]').length,
  })));
  expect(primaryCounts).toEqual([
    { section: 'system-status', primary: 1 },
    { section: 'appearance-preview', primary: 1 },
  ]);

  const networkValue = page.getByTestId('settings-network-mode-value');
  const networkAction = page.getByTestId('settings-network-mode-action');
  expect((await networkAction.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect(networkValue).toHaveText('Locale');
  await networkAction.click();
  await expect(networkValue).toHaveText('Rete disponibile');
  await expect(networkAction).toHaveText('Disattiva home-base');
  await networkAction.click();
  await expect(networkValue).toHaveText('Locale');

  const preview = page.getByTestId('settings-preview-section');
  const initialBackground = await preview.evaluate((element) => getComputedStyle(element).backgroundColor);
  const oppositeTheme = viewCase.register === 'grafite' ? 'Chiaro' : 'Scuro';
  await page.getByRole('button', { name: `Tema ${oppositeTheme}` }).click();
  await expect(page.locator('html')).toHaveClass(viewCase.register === 'grafite' ? /light/ : /dark/);
  const changedBackground = await preview.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(changedBackground).not.toBe(initialBackground);
  const originalTheme = viewCase.register === 'grafite' ? 'Scuro' : 'Chiaro';
  await page.getByRole('button', { name: `Tema ${originalTheme}` }).click();
  await expect(page.locator('html')).toHaveClass(viewCase.register === 'grafite' ? /dark/ : /light/);

  await expectNoSemanticSideBorders(page, '[data-testid="settings-nav-sidebar"], [data-testid="settings-overview-section"]');
  if (viewCase.viewport === 'narrow') {
    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      overview: document.querySelector<HTMLElement>('[data-testid="settings-overview-section"]')!.scrollWidth
        - document.querySelector<HTMLElement>('[data-testid="settings-overview-section"]')!.clientWidth,
    }));
    expect(overflow.document).toBeLessThanOrEqual(1);
    expect(overflow.overview).toBeLessThanOrEqual(1);
  }

  await page.screenshot({
    path: `/tmp/lume-settings-${viewCase.register}-${viewCase.viewport}.png`,
    animations: 'disabled',
  });
}

for (const viewCase of CASES) {
  test(`analytics Lume ${viewCase.register} ${viewCase.viewport}`, async ({ page }) => {
    await page.setViewportSize({ width: viewCase.width, height: viewCase.height });
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    await createAnalyticsFixture(page);
    await verifyAnalytics(page, viewCase);
  });

  test(`settings Lume fixture-free ${viewCase.register} ${viewCase.viewport}`, async ({ page }) => {
    await page.setViewportSize({ width: viewCase.width, height: viewCase.height });
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    await verifySettings(page, viewCase);
  });
}
