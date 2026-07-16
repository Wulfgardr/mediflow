/* @Codex */
import { expect, test, type Page } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

type FrameCase = {
  register: 'giorno' | 'grafite';
  viewport: 'wide' | 'narrow';
  width: number;
  height: number;
};

const FRAME_CASES: FrameCase[] = [
  { register: 'giorno', viewport: 'wide', width: 1440, height: 960 },
  { register: 'grafite', viewport: 'wide', width: 1440, height: 960 },
  { register: 'giorno', viewport: 'narrow', width: 390, height: 844 },
  { register: 'grafite', viewport: 'narrow', width: 390, height: 844 },
];

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
  await page.goto('/mockups/kree8');
  await page.waitForLoadState('domcontentloaded');
  await setRegister(page, register);
  await expect(page.getByTestId('lume-frame')).toBeVisible();
}

for (const frameCase of FRAME_CASES) {
  test(`frame Lume ${frameCase.register} ${frameCase.viewport}`, async ({ page }) => {
    await page.setViewportSize({ width: frameCase.width, height: frameCase.height });
    await openSyntheticFrame(page, frameCase.register);

    const patientsNav = page.getByRole('button', { name: /Pazienti/ });
    await patientsNav.click();
    await expect(patientsNav).toHaveAttribute('aria-current', 'page');

    const rail = page.getByTestId('lume-frame-rail');
    const canvas = page.getByTestId('lume-frame-canvas');
    const panel = page.getByTestId('lume-frame-panel');
    const focus = page.getByTestId('lume-frame-focus');
    const expected = {
      chrome: await resolveColorVariable(page, '--lume-surface-chrome'),
      canvas: await resolveColorVariable(page, '--lume-surface-canvas'),
      field: await resolveColorVariable(page, '--lume-surface-field'),
      focal: await resolveColorVariable(page, '--lume-surface-focal'),
    };

    await expect(rail).toHaveCSS('background-color', expected.chrome);
    await expect(canvas).toHaveCSS('background-color', expected.canvas);
    await expect(panel).toHaveCSS('background-color', expected.field);
    await expect(focus).toHaveCSS('background-color', expected.focal);
    await expect(focus).toHaveCSS('border-top-width', '1px');
    expect(await focus.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe('none');

    const turnNav = page.getByRole('button', { name: /Agenda/ });
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
    const countFamilies = await page.locator('[data-lume-frame-nav] .lume-registro').evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).fontFamily),
    );
    expect(countFamilies.length).toBeGreaterThan(1);
    expect(countFamilies.every((family) => family === registerProbeFamily)).toBe(true);

    const semanticColors = await Promise.all([
      resolveColorVariable(page, '--lume-accent'),
      resolveColorVariable(page, '--lume-signal-warning'),
      resolveColorVariable(page, '--lume-signal-critical'),
      resolveColorVariable(page, '--lume-signal-success'),
      resolveColorVariable(page, '--lume-signal-plum'),
    ]);
    const coloredSideBorders = await page.locator('[data-lume-frame-element]').evaluateAll((elements, colors) =>
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

    if (frameCase.viewport === 'narrow') {
      const overflow = await page.evaluate(() => {
        const canvasElement = document.querySelector('[data-testid="lume-frame-canvas"]');
        if (!(canvasElement instanceof HTMLElement)) throw new Error('Canvas Lume assente');
        return {
          document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          canvas: canvasElement.scrollWidth - canvasElement.clientWidth,
        };
      });
      expect(overflow.document).toBeLessThanOrEqual(1);
      expect(overflow.canvas).toBeLessThanOrEqual(1);
    }
  });
}

test.describe('frame Lume con movimento ridotto', () => {
  test('il cambio area non mantiene transizioni oltre soglia', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openSyntheticFrame(page, 'giorno');
    await page.getByRole('button', { name: /Pazienti/ }).click();

    const motion = await page.getByTestId('lume-frame').evaluate((frame) => {
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
