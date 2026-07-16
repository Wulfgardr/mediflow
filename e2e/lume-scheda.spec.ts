/* @Codex LUME-104/68 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

type SchedaCase = { register: 'giorno' | 'grafite'; viewport: 'wide' | 'narrow'; width: number; height: number };
const CASES: SchedaCase[] = [
  { register: 'giorno', viewport: 'wide', width: 1440, height: 960 },
  { register: 'grafite', viewport: 'wide', width: 1440, height: 960 },
  { register: 'giorno', viewport: 'narrow', width: 390, height: 844 },
  { register: 'grafite', viewport: 'narrow', width: 390, height: 844 },
];

async function createFixture(page: Page): Promise<{ id: string; name: string }> {
  const marker = `${Date.now()}`.slice(-8) + Math.random().toString(36).slice(2, 7).toUpperCase();
  return page.evaluate(async (suffix) => {
    const firstName = `Scheda${suffix.slice(0, 5)}`;
    const lastName = `Lume${suffix.slice(5)}`;
    const patientResponse = await fetch('/api/patients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName, lastName, taxCode: `SCH${suffix}`, birthDate: '1972-04-12T00:00:00.000Z',
        address: 'Indirizzo sintetico Scheda', phone: '0000000104',
        diagnoses: [{ system: 'ICD-11', code: 'SC00', description: 'Controllo sintetico della Scheda', date: '2026-07-16T08:00:00.000Z' }],
      }),
    });
    if (!patientResponse.ok) throw new Error(`Fixture paziente: HTTP ${patientResponse.status}`);
    const { id } = await patientResponse.json() as { id: string };
    const therapyResponse = await fetch('/api/therapies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientId: id, drugName: 'Ramipril sintetico', activePrinciple: 'Ramipril', dosage: '5 mg · 1-0-0', status: 'active', startDate: '2026-07-01T08:00:00.000Z' }),
    });
    if (!therapyResponse.ok) throw new Error(`Fixture terapia: HTTP ${therapyResponse.status}`);
    return { id, name: `${lastName} ${firstName}` };
  }, marker);
}

async function setRegister(page: Page, register: SchedaCase['register']): Promise<void> {
  await page.evaluate((value) => {
    const theme = value === 'grafite' ? 'dark' : 'light';
    localStorage.setItem('mediflow-theme', theme);
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
  }, register);
}

async function expectInViewport(locator: Locator): Promise<void> {
  expect(await locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.top >= 0 && box.bottom <= window.innerHeight;
  })).toBe(true);
}

async function expectRegisterFont(locator: Locator): Promise<void> {
  const families = await locator.evaluateAll((elements) => elements
    .filter((element) => (element as HTMLElement).offsetParent !== null)
    .map((element) => getComputedStyle(element).fontFamily));
  expect(families.length).toBeGreaterThan(4);
  for (const family of families) expect(family).toContain('IBM Plex Mono');
}

async function expectNarrowContract(page: Page, surface: Locator, header: Locator): Promise<void> {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    scroll: document.querySelector<HTMLElement>('[data-testid="lume-scheda-scroll"]')!.scrollWidth
      - document.querySelector<HTMLElement>('[data-testid="lume-scheda-scroll"]')!.clientWidth,
    surface: document.querySelector<HTMLElement>('[data-testid="lume-scheda-surface"]')!.scrollWidth
      - document.querySelector<HTMLElement>('[data-testid="lume-scheda-surface"]')!.clientWidth,
  }));
  for (const [name, delta] of Object.entries(overflow)) expect(delta, `overflow ${name}`).toBeLessThanOrEqual(1);
  const sections = await surface.locator(':scope > div > section').evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().top));
  expect(sections.length).toBeGreaterThan(8);
  expect(sections).toEqual([...sections].sort((left, right) => left - right));
  await expectInViewport(header);
}

for (const schedaCase of CASES) {
  test(`Scheda Lume ${schedaCase.register} ${schedaCase.viewport}`, async ({ page }) => {
    await page.setViewportSize({ width: schedaCase.width, height: schedaCase.height });
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const patient = await createFixture(page);
    await page.goto(`/patients/${patient.id}/modules`);
    await setRegister(page, schedaCase.register);
    await expect(page.locator('html')).toHaveClass(schedaCase.register === 'grafite' ? /dark/ : /light/);

    const scroll = page.getByTestId('lume-scheda-scroll');
    const header = page.getByTestId('lume-scheda-header');
    const surface = page.getByTestId('lume-scheda-surface');
    await expect(header.getByRole('heading', { name: patient.name, level: 1 })).toBeVisible();
    await expectInViewport(header);
    expect(await scroll.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await scroll.evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await expectInViewport(header);

    await expect(page.locator('[data-lume-elevation]')).toHaveCount(1);
    await expect(surface.locator('[data-lume-elevation]')).toHaveCount(0);
    expect(await surface.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe('none');
    await page.evaluate(() => document.fonts.ready);
    await expectRegisterFont(page.getByTestId('lume-register-value'));

    await scroll.evaluate((element) => element.scrollTo(0, 0));
    const therapies = page.getByRole('button', { name: /Terapie farmacologiche/ });
    await therapies.focus();
    await expect(therapies).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(therapies).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Space');
    await expect(therapies).toHaveAttribute('aria-expanded', 'false');

    const semanticStates = await surface.locator('[data-lume-clinical-state]').evaluateAll((elements) => elements
      .filter((element) => (element as HTMLElement).offsetParent !== null)
      .map((element) => {
        const style = getComputedStyle(element);
        return { text: element.textContent?.trim(), left: style.borderLeftWidth, right: style.borderRightWidth,
          pill: parseFloat(style.borderRadius) >= element.getBoundingClientRect().height / 2 };
      }));
    for (const state of semanticStates) {
      expect(state.text).toBeTruthy();
      expect(state.left).toBe(state.right);
      expect(state.pill).toBe(false);
    }
    const statusLabels = await surface.locator('[data-testid^="review-queue-row-"] [class*="rounded-full"]').evaluateAll((elements) =>
      elements.filter((element) => (element as HTMLElement).offsetParent !== null).map((element) => ({
        background: getComputedStyle(element).backgroundColor,
        radius: parseFloat(getComputedStyle(element).borderRadius),
        text: element.textContent?.trim(),
      })));
    expect(statusLabels.length).toBeGreaterThan(0);
    for (const label of statusLabels) {
      expect(label.text).toBeTruthy();
      expect(label.background).toBe('rgba(0, 0, 0, 0)');
      expect(label.radius).toBe(0);
    }
    if (schedaCase.viewport === 'narrow') await expectNarrowContract(page, surface, header);

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await scroll.evaluate((element) => element.scrollTo(0, 0));
    await page.screenshot({ path: `/tmp/lume-scheda-${schedaCase.register}-${schedaCase.viewport}.png`, animations: 'disabled' });
  });
}
