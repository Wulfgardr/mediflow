/* @Codex #98, #68 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

type QuadroCase = {
  register: 'giorno' | 'grafite';
  viewport: 'wide' | 'narrow';
  width: number;
  height: number;
};

const QUADRO_CASES: QuadroCase[] = [
  { register: 'giorno', viewport: 'wide', width: 1440, height: 960 },
  { register: 'grafite', viewport: 'wide', width: 1440, height: 960 },
  { register: 'giorno', viewport: 'narrow', width: 390, height: 844 },
  { register: 'grafite', viewport: 'narrow', width: 390, height: 844 },
];

type LivePatientFixture = { id: string; name: string };

async function createLivePatientFixture(page: Page): Promise<LivePatientFixture> {
  const marker = Date.now().toString().slice(-8);
  const firstName = `Quadro${marker}`;
  const lastName = `Live${marker}`;

  return page.evaluate(async ({ firstName: fixtureFirstName, lastName: fixtureLastName, marker: fixtureMarker }) => {
    const response = await fetch('/api/patients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: fixtureFirstName,
        lastName: fixtureLastName,
        taxCode: `QDR${fixtureMarker.padStart(13, '0')}`,
        birthDate: '1980-01-01T00:00:00.000Z',
        address: 'Indirizzo sintetico Quadro',
        phone: '0000000098',
        diagnoses: [{
          system: 'ICD-11',
          code: 'QC00',
          description: 'Controllo sintetico del Quadro',
          date: new Date().toISOString(),
        }],
      }),
    });
    if (!response.ok) throw new Error(`Failed to create Quadro fixture: ${response.status}`);
    const data = await response.json() as { id: string };
    return { id: data.id, name: `${fixtureLastName} ${fixtureFirstName}` };
  }, { firstName, lastName, marker });
}

async function setRegister(page: Page, register: QuadroCase['register']): Promise<void> {
  await page.evaluate((nextRegister) => {
    const theme = nextRegister === 'grafite' ? 'dark' : 'light';
    localStorage.setItem('mediflow-theme', theme);
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
  }, register);
}

async function openSyntheticQuadro(page: Page, quadroCase: QuadroCase): Promise<Locator> {
  await page.setViewportSize({ width: quadroCase.width, height: quadroCase.height });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await page.goto('/mockups/kree8');
  await page.waitForLoadState('domcontentloaded');
  await setRegister(page, quadroCase.register);
  await page.getByRole('button', { name: /Pazienti/ }).click();
  await expect(page.getByTestId('lume-patient-lens')).toBeVisible();
  await page.getByRole('button', { name: 'Quadro', exact: true }).click();
  const quadro = page.getByTestId('lume-quadro');
  await expect(quadro).toBeVisible();
  return quadro;
}

async function resolveColor(page: Page, variable: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, variable);
}

async function assertIbmPlexMono(locator: Locator, label: string): Promise<void> {
  const families = await locator.evaluateAll((elements) =>
    elements.map((element) => getComputedStyle(element).fontFamily),
  );
  expect(families.length, `${label}: nessun elemento osservabile`).toBeGreaterThan(0);
  for (const family of families) {
    expect(family, `${label}: famiglia tipografica risolta`).toContain('IBM Plex Mono');
  }
}

async function assertSingleFocalShadow(page: Page): Promise<void> {
  const frameFocus = page.locator(
    '[data-testid="lume-frame-focus"][data-lume-focus="true"][data-lume-frame-element="focus"]',
  );
  await expect(frameFocus).toHaveCount(1);

  const shadowOwners = await frameFocus.evaluate((root) =>
    [root, ...root.querySelectorAll('*')]
      .filter((element) => getComputedStyle(element).boxShadow !== 'none')
      .map((element) => ({
        isFrameFocus: element === root,
        testId: element.getAttribute('data-testid'),
        frameElement: element.getAttribute('data-lume-frame-element'),
        lumeFocus: element.getAttribute('data-lume-focus'),
      })),
  );
  expect(shadowOwners).toEqual([{
    isFrameFocus: true,
    testId: 'lume-frame-focus',
    frameElement: 'focus',
    lumeFocus: 'true',
  }]);
}

async function assertQuadroContract(page: Page, quadro: Locator): Promise<void> {
  await expect(quadro.getByRole('heading', { name: 'M. R.', level: 1 })).toBeVisible();
  await expect(quadro.locator('[aria-pressed]')).toHaveCount(0);

  await assertSingleFocalShadow(page);
  await expect(quadro.locator('[data-lume-surface="focal"]')).toHaveCount(0);
  await expect(quadro.locator('[data-lume-surface="field"]')).toHaveCount(4);

  const muted = await resolveColor(page, '--lume-ink-muted');
  const labelColors = await quadro.getByTestId('lume-quadro-metric-label').evaluateAll((elements) =>
    elements.map((element) => getComputedStyle(element).color),
  );
  expect(new Set(labelColors)).toEqual(new Set([muted]));

  await assertIbmPlexMono(quadro.getByTestId('lume-quadro-metric-value'), 'Valori metrici');
  await assertIbmPlexMono(quadro.getByTestId('lume-quadro-atom'), 'Atomi della testata');

  const warningValues = quadro.locator('[data-testid="lume-quadro-metric-value"][data-lume-signal="warning"]');
  await expect(warningValues).toHaveCount(1);
  await expect(warningValues).toHaveAttribute('data-lume-clinical-state', 'warning');
  await expect(quadro.locator('[data-testid="lume-quadro-metric-value"][data-lume-clinical-state]:not([data-lume-signal])')).toHaveCount(0);

  const neutralValue = quadro
    .locator('[data-lume-surface="field"]', { hasText: 'Pressione' })
    .getByTestId('lume-quadro-metric-value');
  await expect(neutralValue).toHaveCount(1);
  expect(await neutralValue.evaluate((element) => ({
    hasSignal: element.hasAttribute('data-lume-signal'),
    hasClinicalState: element.hasAttribute('data-lume-clinical-state'),
    color: getComputedStyle(element).color,
  }))).toEqual({
    hasSignal: false,
    hasClinicalState: false,
    color: await resolveColor(page, '--lume-ink'),
  });
  expect(await warningValues.evaluate((element) => getComputedStyle(element).color))
    .not.toBe(await neutralValue.evaluate((element) => getComputedStyle(element).color));

  const primary = quadro.locator('[data-lume-action="primary"]');
  const quiet = quadro.locator('[data-lume-action="quiet"]');
  await expect(primary).toHaveCount(1);
  await expect(quiet).toHaveCount(7);
  await expect(primary).toHaveCSS('background-color', await resolveColor(page, '--lume-ink'));
  await expect(primary).toHaveCSS('color', await resolveColor(page, '--lume-surface-focal'));

  await primary.focus();
  await page.keyboard.press('Tab');
  await expect(quiet.first()).toBeFocused();
}

async function assertNarrowStack(page: Page, quadro: Locator): Promise<void> {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    quadro: document.querySelector<HTMLElement>('[data-testid="lume-quadro"]')
      ? document.querySelector<HTMLElement>('[data-testid="lume-quadro"]')!.scrollWidth
        - document.querySelector<HTMLElement>('[data-testid="lume-quadro"]')!.clientWidth
      : Number.POSITIVE_INFINITY,
  }));
  for (const [surface, delta] of Object.entries(overflow)) {
    expect(delta, `Overflow orizzontale su ${surface}`).toBeLessThanOrEqual(1);
  }

  const sections = await quadro.getByTestId('lume-quadro-section').evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom };
    }),
  );
  expect(sections[1].top).toBeGreaterThanOrEqual(sections[0].bottom - 1);
  expect(sections[3].top).toBeGreaterThanOrEqual(sections[2].bottom - 1);
}

test('quadro live usa il paziente selezionato dal database sintetico', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const patient = await createLivePatientFixture(page);

  await page.goto(`/?area=incarico&paziente=${patient.id}`);
  const lens = page.getByTestId('lume-patient-lens');
  await expect(lens.getByRole('heading', { name: patient.name, level: 2 })).toBeVisible();
  await lens.getByRole('button', { name: 'Quadro', exact: true }).click();

  const quadro = page.getByTestId('lume-quadro');
  await expect(page.getByTestId('lume-frame-canvas')).toHaveAttribute('data-lume-context', 'scheda');
  await expect(quadro.getByRole('heading', { name: patient.name, level: 1 })).toBeVisible();
  await expect(quadro.getByRole('list', { name: 'Diagnosi', exact: true })).toContainText(
    'QC00Controllo sintetico del Quadro',
  );
  await expect(quadro.getByTestId('lume-quadro-metric-value')).toHaveCount(4);
  await expect(quadro.getByTestId('lume-quadro-metric-value').first()).not.toHaveText('in attesa');
  await assertIbmPlexMono(quadro.getByTestId('lume-quadro-metric-value'), 'Valori metrici live');
  await assertIbmPlexMono(quadro.getByTestId('lume-quadro-atom'), 'Atomi della testata live');
  await assertSingleFocalShadow(page);
  await expect(quadro.locator('[data-lume-action="primary"]')).toHaveAttribute(
    'href',
    `/patients/${patient.id}/modules`,
  );
});

for (const quadroCase of QUADRO_CASES) {
  test(`quadro Lume ${quadroCase.register} ${quadroCase.viewport}`, async ({ page }) => {
    const quadro = await openSyntheticQuadro(page, quadroCase);
    await expect(page.locator('html')).toHaveClass(quadroCase.register === 'grafite' ? /dark/ : /light/);
    await assertQuadroContract(page, quadro);
    if (quadroCase.viewport === 'narrow') await assertNarrowStack(page, quadro);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await quadro.evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({
      path: `/tmp/lume-quadro-${quadroCase.register}-${quadroCase.viewport}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  });
}
