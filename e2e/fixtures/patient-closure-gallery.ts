import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { assertNoHorizontalOverflow } from '../utils';
import { openBrowserZoomFixture } from './browser-zoom';

const zooms = new WeakMap<Page, Awaited<ReturnType<typeof openBrowserZoomFixture>>>();
export const test = base.extend({
  page: async ({ page, baseURL }, runPage) => {
    if (!process.env.PATIENT_CLOSURE_EVIDENCE) return runPage(page);
    const zoom = await openBrowserZoomFixture(baseURL!);
    zooms.set(zoom.page, zoom);
    try { await runPage(zoom.page); } finally { await zoom.close(); }
  },
});

test.beforeEach(({ baseURL }) => {
  if (process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR || !baseURL ||
      new URL(baseURL).hostname !== '127.0.0.1' || new URL(baseURL).port === '3000') {
    throw new Error('Owned synthetic archive and non-3000 loopback required');
  }
});

export function registerClosureZoom(page: Page, zoom: Awaited<ReturnType<typeof openBrowserZoomFixture>>) { zooms.set(page, zoom); }

export async function closureGallery(page: Page, area: string, state: string, target: Locator) {
  const root = process.env.PATIENT_CLOSURE_EVIDENCE;
  if (!root) return false;
  const previousFocus = await page.evaluateHandle(() => document.activeElement);
  const zoom = zooms.get(page)!;
  const directory = `${root}/${area}`;
  await mkdir(directory, { recursive: true });
  for (const theme of ['giorno', 'grafite']) for (const size of ['1440', '768', '320', '390', '200', '400']) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await zoom.setZoom(1);
    await page.setViewportSize({ width: Number(size) < 500 && ['200', '400'].includes(size) ? 1440 : Number(size), height: 1000 });
    if (size === '200' || size === '400') await zoom.setZoom(Number(size) / 100);
    await page.evaluate(theme => {
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(theme === 'giorno' ? 'light' : 'dark');
    }, theme);
    await target.scrollIntoViewIfNeeded();
    await assertNoHorizontalOverflow(page, [{ label: area, selector: 'document' }]);
    const focused = target.locator('button:visible, a:visible, input:visible').first();
    if (await focused.count()) {
      await focused.focus();
      await expect(focused).toBeFocused();
      await focused.scrollIntoViewIfNeeded();
      const rect = await focused.boundingBox();
      expect(rect!.x).toBeGreaterThanOrEqual(-1);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth) + 1);
    }
    const stem = `${directory}/${state}-${theme}-${size}`;
    await page.screenshot({ path: `${stem}.png`, animations: 'disabled', fullPage: !['200', '400'].includes(size) });
    await writeFile(`${stem}.json`, JSON.stringify({ product: process.env.PATIENT_CLOSURE_PRODUCT_SHA,
      area, state, theme, size, viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
      text: await target.innerText() }, null, 2));
    if (size === '200' || size === '400') {
      const details = await target.locator('tbody tr, [role=status], [role=alert]').all();
      if (!details.length) details.push(target);
      for (const [index, detail] of details.entries()) {
        await detail.evaluate(element => element.scrollIntoView({ block: 'center' }));
        await page.screenshot({ path: `${stem}-lettura-${index}.png`, animations: 'disabled' });
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await zoom.setZoom(1);
  await previousFocus.asElement()?.focus();
  await previousFocus.dispose();
  return true;
}
