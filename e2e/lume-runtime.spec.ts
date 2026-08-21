/* @Codex */
import { expect, test, type Page } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

const GIORNO_CANVAS_RGB = 'rgb(238, 240, 242)'; // #eef0f2
const GRAFITE_CANVAS_RGB = 'rgb(18, 20, 23)'; // #121417

// Custom properties compute to raw var() text, so resolve an alias by consuming
// it on a throwaway probe element.
async function resolveActiveVar(page: Page, varName: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('div');
    probe.style.color = `var(${name})`;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }, varName);
}

async function readNamespacedVar(page: Page, varName: string): Promise<string> {
  return page.evaluate(
    (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim().toLowerCase(),
    varName,
  );
}

// Flip the theme class the way the bootstrap does — F2a adds no Lume selector.
async function setThemeClass(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((next) => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(next);
  }, theme);
}

test('lume runtime tokens are the live default across theme changes, reload and cockpit routes', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-lume', 'true');
  // The redesign identity (ADR 0078) still coexists; F2a does not replace it.
  await expect(html).toHaveAttribute('data-ui-style', 'redesign');
  // Both register-scoped mirrors are present regardless of the active theme.
  expect(await readNamespacedVar(page, '--lume-giorno-surface-canvas')).toBe('#eef0f2');
  expect(await readNamespacedVar(page, '--lume-grafite-surface-canvas')).toBe('#121417');
  // The active alias selects giorno under light and grafite under .dark.
  await setThemeClass(page, 'light');
  expect(await resolveActiveVar(page, '--lume-surface-canvas')).toBe(GIORNO_CANVAS_RGB);
  await setThemeClass(page, 'dark');
  expect(await resolveActiveVar(page, '--lume-surface-canvas')).toBe(GRAFITE_CANVAS_RGB);
  await setThemeClass(page, 'light');
  // The live cockpit is visible on the app root and paints the Lume giorno canvas.
  const liveCockpit = page.getByLabel('MediFlow · spazio clinico Kree8');
  await expect(liveCockpit).toBeVisible({ timeout: 20_000 });
  expect(await liveCockpit.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(GIORNO_CANVAS_RGB);
  // A patient-facing cockpit route reachable with only synthetic review data.
  await page.goto('/mockups/kree8');
  await page.waitForLoadState('domcontentloaded');
  await expect(html).toHaveAttribute('data-lume', 'true');
  await setThemeClass(page, 'light');
  const reviewCockpit = page.getByLabel('MediFlow · Kree8 review surface');
  await expect(reviewCockpit).toBeVisible({ timeout: 20_000 });
  expect(await reviewCockpit.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(GIORNO_CANVAS_RGB);
  // The bootstrap restores the persisted theme and matching alias on reload.
  await page.evaluate(() => localStorage.setItem('mediflow-theme', 'dark'));
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(html).toHaveAttribute('data-lume', 'true');
  await expect(html).toHaveClass(/dark/);
  expect(await resolveActiveVar(page, '--lume-surface-canvas')).toBe(GRAFITE_CANVAS_RGB);
});

test('lume registered properties drive neutral canvas depth and SVG filo fill', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');

  const canvas = page.locator('[data-lume-context]').first();
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  const lightSamples = await canvas.evaluate((element) => {
    (element as HTMLElement).style.transition = 'none';
    const read = () => {
      const style = getComputedStyle(element);
      return {
        light: style.getPropertyValue('--lume-surface-l').trim(),
        depth: style.getPropertyValue('--lume-surface-depth').trim(),
        temperature: style.getPropertyValue('--lume-surface-temp').trim(),
        background: style.backgroundColor,
      };
    };
    element.setAttribute('data-lume-context', 'incarico');
    const incarico = read();
    element.setAttribute('data-lume-context', 'scheda');
    const scheda = read();
    return { incarico, scheda };
  });
  expect(lightSamples.incarico.light).toBe('5.5%');
  expect(lightSamples.incarico.depth).toBe('1.8%');
  expect(lightSamples.incarico.temperature).toBe('');
  expect(lightSamples.scheda.light).toBe('7%');
  expect(lightSamples.scheda.depth).toBe('2.4%');
  expect(lightSamples.scheda.temperature).toBe('');
  expect(lightSamples.scheda.background).not.toBe(lightSamples.incarico.background);

  const filoSamples = await page.evaluate(() => {
    const namespace = 'http://www.w3.org/2000/svg';
    const path = document.createElementNS(namespace, 'path');
    path.classList.add('lume-filo-draw');
    path.setAttribute('pathLength', '100');
    path.style.transition = 'none';
    document.body.appendChild(path);
    const read = (fill: string) => {
      path.style.setProperty('--lume-filo-fill', fill);
      return getComputedStyle(path).strokeDashoffset;
    };
    const result = { quarter: read('25%'), threeQuarters: read('75%') };
    path.remove();
    return result;
  });
  expect(filoSamples.quarter).toBe('75%');
  expect(filoSamples.threeQuarters).toBe('25%');
});
