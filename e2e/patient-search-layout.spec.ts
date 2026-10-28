import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

for (const width of [768, 1024, 1440, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`ricerca pazienti leggibile ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 960 });
      await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
      await page.goto('/?area=incarico');
      await page.evaluate(theme => {
        localStorage.setItem('mediflow-theme', theme);
        document.documentElement.classList.remove('light', 'dark');
        document.documentElement.classList.add(theme);
      }, theme);
      const search = page.getByRole('searchbox', { name: 'Cerca nella lista pazienti', exact: true });
      const clear = page.getByRole('button', { name: 'Cancella la ricerca', exact: true });
      await expect(clear).toHaveCount(0);
      await search.fill('Paziente inesistente sintetico');
      await page.evaluate(() => document.fonts.ready);
      const geometry = await search.evaluate(input => {
        const rect = (element: Element) => {
          const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
          return { x, y, width, height, right, bottom };
        };
        const field = input.parentElement!;
        const toolbar = field.parentElement!;
        const style = getComputedStyle(input);
        const canvas = document.createElement('canvas').getContext('2d')!;
        canvas.font = style.font;
        return {
          input: rect(input), field: rect(field), toolbar: rect(toolbar),
          title: rect(toolbar.querySelector('h1')!),
          filter: rect(toolbar.querySelector('[aria-label="Stato elenco"]')!),
          create: rect(toolbar.querySelector('a[href="/patients/new"]')!),
          textWidth: canvas.measureText((input as HTMLInputElement).value).width,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(geometry.input.width).toBeGreaterThanOrEqual(geometry.textWidth + 2);
      expect(geometry.overflow).toBe(false);
      if (width === 1440) {
        expect(Math.abs(geometry.field.y - geometry.filter.y)).toBeLessThan(8);
        expect(geometry.field.x).toBeGreaterThan(geometry.title.right);
      } else {
        expect(geometry.field.y).toBeGreaterThanOrEqual(geometry.title.bottom);
        expect(geometry.filter.y).toBeGreaterThanOrEqual(geometry.field.bottom);
        expect(Math.abs(geometry.field.width - geometry.toolbar.width)).toBeLessThan(2);
        expect(Math.abs(geometry.filter.y - geometry.create.y)).toBeLessThan(2);
        expect(geometry.create.x).toBeGreaterThanOrEqual(geometry.filter.right);
        if (width !== 390) expect(geometry.input.width).toBeGreaterThanOrEqual(320);
      }
      await expect(clear).toBeVisible();
      const box = (await clear.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(geometry.input.right);
      expect(box.x + box.width).toBeLessThanOrEqual(geometry.field.right);
      await clear.click();
      await expect(search).toHaveValue('');
      await expect(search).toBeFocused();
      await expect(clear).toHaveCount(0);
    });
  }
}
