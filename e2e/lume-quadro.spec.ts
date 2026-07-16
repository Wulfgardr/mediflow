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

async function resolveRegisterFamily(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement('span');
    probe.className = 'lume-registro';
    document.body.appendChild(probe);
    const family = getComputedStyle(probe).fontFamily;
    probe.remove();
    return family;
  });
}

async function assertQuadroContract(page: Page, quadro: Locator): Promise<void> {
  await expect(quadro.getByRole('heading', { name: 'M. R.', level: 1 })).toBeVisible();
  await expect(quadro.locator('[aria-pressed]')).toHaveCount(0);

  const area = page.getByTestId('lume-frame-focus');
  const elevated = await area.evaluate((root) =>
    [root, ...root.querySelectorAll('*')].filter((element) => getComputedStyle(element).boxShadow !== 'none').length,
  );
  expect(elevated).toBe(1);
  await expect(quadro.locator('[data-lume-surface="focal"]')).toHaveCount(0);
  await expect(quadro.locator('[data-lume-surface="field"]')).toHaveCount(4);

  const muted = await resolveColor(page, '--lume-ink-muted');
  const labelColors = await quadro.getByTestId('lume-quadro-metric-label').evaluateAll((elements) =>
    elements.map((element) => getComputedStyle(element).color),
  );
  expect(new Set(labelColors)).toEqual(new Set([muted]));

  const registerFamily = await resolveRegisterFamily(page);
  const valueFamilies = await quadro.getByTestId('lume-quadro-metric-value').evaluateAll((elements) =>
    elements.map((element) => getComputedStyle(element).fontFamily),
  );
  expect(new Set(valueFamilies)).toEqual(new Set([registerFamily]));

  const warningValues = quadro.locator('[data-testid="lume-quadro-metric-value"][data-lume-signal="warning"]');
  await expect(warningValues).toHaveCount(1);
  await expect(warningValues).toHaveAttribute('data-lume-clinical-state', 'warning');
  await expect(quadro.locator('[data-testid="lume-quadro-metric-value"][data-lume-clinical-state]:not([data-lume-signal])')).toHaveCount(0);

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
