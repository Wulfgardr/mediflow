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
          title: rect(document.querySelector('main h1')!),
          filter: rect(toolbar.querySelector('[aria-label="Stato elenco"]')!),
          create: rect(document.querySelector('main [data-page-frame] a[href="/patients/new"]')!),
          textWidth: canvas.measureText((input as HTMLInputElement).value).width,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(geometry.input.width).toBeGreaterThanOrEqual(geometry.textWidth + 2);
      expect(geometry.overflow).toBe(false);
      const boxes = { title: geometry.title, create: geometry.create, field: geometry.field, filter: geometry.filter };
      const overlaps = Object.entries(boxes).flatMap(([a, first], index) => Object.entries(boxes).slice(index + 1)
        .filter(([, second]) => Math.min(first.right, second.right) - Math.max(first.x, second.x) > 1
          && Math.min(first.bottom, second.bottom) - Math.max(first.y, second.y) > 1)
        .map(([b]) => `${a}/${b}`));
      expect(overlaps).toEqual([]);
      expect(geometry.field.y).toBeGreaterThanOrEqual(geometry.title.bottom);
      expect(geometry.field.y).toBeGreaterThanOrEqual(geometry.create.bottom);
      expect(geometry.create.x).toBeGreaterThanOrEqual(geometry.title.right);
      expect(geometry.create.right).toBeLessThanOrEqual(width);
      if (width === 1440) {
        expect(Math.abs(geometry.field.y - geometry.filter.y)).toBeLessThan(8);
      } else {
        expect(geometry.filter.y).toBeGreaterThanOrEqual(geometry.field.bottom);
        expect(Math.abs(geometry.field.width - geometry.toolbar.width)).toBeLessThan(2);
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
