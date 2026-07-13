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
