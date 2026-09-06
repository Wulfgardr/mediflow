/* @Codex */
import { expect, test, type Page } from '@playwright/test';
import {
  assertKeyboardFocusProgresses,
  assertNoHorizontalOverflow,
  assertNotClippedInViewport,
  bootstrapUnlockedSession,
  REFLOW_PROXY_VIEWPORTS,
  type ReflowProxyViewport,
} from './utils';

type FrameCase = {
  register: 'giorno' | 'grafite';
  viewport: ReflowProxyViewport['viewport'];
  width: number;
  height: number;
};

const FRAME_CASES: FrameCase[] = (['giorno', 'grafite'] as const).flatMap((register) =>
  REFLOW_PROXY_VIEWPORTS.map((viewport) => ({ register, ...viewport })),
);

async function setRegister(page: Page, register: FrameCase['register']): Promise<void> {
  await page.evaluate((nextRegister) => {
    const theme = nextRegister === 'grafite' ? 'dark' : 'light';
    localStorage.setItem('mediflow-theme', theme);
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
  }, register);
}

async function resolveColorVariable(page: Page, variable: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, variable);
}

async function openSyntheticFrame(page: Page, register: FrameCase['register']): Promise<void> {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await page.goto('/?area=turno');
  await page.waitForLoadState('domcontentloaded');
  await setRegister(page, register);
  await expect(page.getByTestId('lume-frame')).toBeVisible();
}

for (const frameCase of FRAME_CASES) {
  test(`frame Lume ${frameCase.register} ${frameCase.viewport}`, async ({ page }) => {
    await page.setViewportSize({ width: frameCase.width, height: frameCase.height });
    await openSyntheticFrame(page, frameCase.register);

    // @Codex ADR 0123: ordinary navigation owns links; the review mockup has no app rail.
    const navigation = page.getByRole('navigation', { name: 'Navigazione principale' });
    const patientsNav = navigation.getByRole('link', { name: 'Pazienti', exact: true });
    await patientsNav.focus();
    await page.keyboard.press('Enter');
    await expect(patientsNav).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: /Pazienti in carico/, level: 1 })).toBeVisible();
    await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);

    const rail = page.getByRole('complementary', { name: 'MediFlow', exact: true });
    const canvas = page.getByTestId('lume-frame-canvas');
    const panel = page.getByTestId('lume-frame-panel');
    const focus = page.getByTestId('lume-frame-focus');
    const expected = {
      chrome: await resolveColorVariable(page, '--lume-surface-chrome'),
      focal: await resolveColorVariable(page, '--lume-surface-focal'),
    };

    await expect(rail).toHaveCSS('background-color', expected.chrome);
    await expect(canvas).toHaveCSS('background-color', expected.focal);
    // The selected redesign removes decorative nested sheets at every width.
    // Keep the depth check on the rendered surfaces, including the outer rail.
    for (const layer of [panel, focus]) {
      await expect(layer).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(layer).toHaveCSS('border-top-width', '0px');
    }
    for (const layer of [rail, canvas, panel, focus]) await expect(layer).toHaveCSS('box-shadow', 'none');

    const turnNav = navigation.getByRole('link', { name: 'Agenda', exact: true });
    const weights = await Promise.all([
      patientsNav.evaluate((element) => Number(getComputedStyle(element).fontWeight)),
      turnNav.evaluate((element) => Number(getComputedStyle(element).fontWeight)),
    ]);
    expect(weights[0]).toBeGreaterThan(weights[1]);

    const selectedGeometry = await patientsNav.evaluate((element) => {
      const style = getComputedStyle(element);
      return { radius: Number.parseFloat(style.borderTopLeftRadius), height: element.getBoundingClientRect().height };
    });
    expect(selectedGeometry.radius * 2).toBeLessThan(selectedGeometry.height);

    const registerProbeFamily = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.className = 'lume-registro';
      document.body.appendChild(probe);
      const family = getComputedStyle(probe).fontFamily;
      probe.remove();
      return family;
    });
    expect(registerProbeFamily.toLowerCase()).toContain('registro');
    // Counts moved from the navigation into the directory they describe.
    const countFamilies = await page.getByTestId('lume-worklist').locator('.lume-registro').evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).fontFamily),
    );
    expect(countFamilies.length).toBeGreaterThan(0);
    expect(countFamilies.every((family) => family === registerProbeFamily)).toBe(true);

    const semanticColors = await Promise.all([
      resolveColorVariable(page, '--lume-accent'),
      resolveColorVariable(page, '--lume-signal-warning'),
      resolveColorVariable(page, '--lume-signal-critical'),
      resolveColorVariable(page, '--lume-signal-success'),
      resolveColorVariable(page, '--lume-signal-plum'),
    ]);
    const coloredSideBorders = await page.locator('[data-twin-workspace] > aside, nav[aria-label="Navigazione principale"] a, [data-lume-frame-element]').evaluateAll((elements, colors) =>
      elements.flatMap((element) => {
        const style = getComputedStyle(element);
        const width = Number.parseFloat(style.borderLeftWidth);
        const isSideOnly = style.borderLeftColor !== style.borderTopColor || style.borderLeftStyle !== style.borderTopStyle;
        return width > 1 || (width > 0 && isSideOnly && colors.includes(style.borderLeftColor))
          ? [element.getAttribute('data-lume-frame-element') || element.tagName]
          : [];
      }), semanticColors,
    );
    expect(coloredSideBorders).toEqual([]);

    await assertNoHorizontalOverflow(page, [
      { label: 'documento frame', selector: 'document' },
      { label: 'canvas frame', selector: '[data-testid="lume-frame-canvas"]' },
      { label: 'pannello frame', selector: '[data-testid="lume-frame-panel"]' },
      { label: 'focus frame', selector: '[data-testid="lume-frame-focus"]' },
    ]);
    await assertNotClippedInViewport(patientsNav, 'navigazione Pazienti');
    await assertKeyboardFocusProgresses(page, patientsNav, 'navigazione frame');
    await expect(turnNav).toBeFocused();
    for (const link of await navigation.getByRole('link').all()) {
      await assertNotClippedInViewport(link, `destinazione ${await link.getAttribute('aria-label')}`);
    }
    await page.screenshot({ path: test.info().outputPath('frame.png'), animations: 'disabled' });
  });
}

test.describe('frame Lume con movimento ridotto', () => {
  test('il cambio area non mantiene transizioni oltre soglia', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openSyntheticFrame(page, 'giorno');
    await page.getByRole('navigation', { name: 'Navigazione principale' })
      .getByRole('link', { name: 'Pazienti', exact: true }).click();

    const motion = await page.locator('[data-twin-workspace]').evaluate((frame) => {
      const parseDurations = (value: string) => value.split(',').map((duration) => {
        const trimmed = duration.trim();
        return trimmed.endsWith('ms') ? Number.parseFloat(trimmed) : Number.parseFloat(trimmed) * 1000;
      });
      const longTransitions = Array.from(frame.querySelectorAll('*')).flatMap((element) => {
        const durations = parseDurations(getComputedStyle(element).transitionDuration);
        return durations.some((duration) => duration > 50) ? [element.className] : [];
      });
      const running = document.getAnimations().filter((animation) => {
        const duration = animation.effect?.getTiming().duration;
        const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
        return target instanceof Node && frame.contains(target)
          && animation.playState === 'running' && typeof duration === 'number' && duration > 50;
      });
      return { longTransitions, running: running.length };
    });

    expect(motion.longTransitions).toEqual([]);
    expect(motion.running).toBe(0);
  });
});
