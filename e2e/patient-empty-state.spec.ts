import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { bootstrapUnlockedSession } from './utils';
import { installWorklistTodoFixture } from './fixtures/worklist-todo';

for (const width of [1440, 1024, 768, 390]) for (const theme of ['light', 'dark']) {
  test(`stato vuoto unico e lente stabile ${width} ${theme}`, async ({ page, baseURL }, info) => {
    await page.setViewportSize({ width, height: 960 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(theme => localStorage.setItem('mediflow-theme', theme), theme);
    const fixture = await installWorklistTodoFixture(page, baseURL!);
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    await page.goto('/?area=incarico');
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    const search = page.getByRole('searchbox', { name: 'Cerca nella lista pazienti', exact: true });
    const list = page.getByTestId('lume-worklist');
    const lens = page.getByRole('complementary', { name: /^Lente paziente/u });
    const frames: Record<string, unknown> = {};
    const capture = async (state: string) => {
      await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
      const geometry = await page.evaluate(() => {
        const box = (selector: string) => {
          const { x, y, width } = document.querySelector(selector)!.getBoundingClientRect();
          return { x, y, width };
        };
        return { list: box('[data-testid="lume-worklist"]'), toolbar: box('[aria-label="Cerca nella lista pazienti"]') };
      });
      frames[state] = geometry;
      if (process.env.EMPTY_STATE_EVIDENCE_DIR) {
        fs.mkdirSync(process.env.EMPTY_STATE_EVIDENCE_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.EMPTY_STATE_EVIDENCE_DIR, `${state}-${theme}-${width}.png`), fullPage: true });
      }
      return geometry;
    };
    try {
      await expect(list.getByText('3 risultati', { exact: true })).toBeVisible();
      if (width > 900) await expect(lens).toBeVisible();
      else await expect(lens).not.toBeVisible();
      const initial = await capture('risultati');
      await search.fill('AssenteHCUndici');
      await expect(list.getByText('0 risultati', { exact: true })).toBeVisible();
      const empty = await capture('zero');
      expect.soft(empty).toEqual(initial);
      await expect.soft(page.getByText(/Nessun (risultato|paziente)/u).filter({ visible: true })).toHaveCount(1, { timeout: 1000 });
      const message = page.getByRole('status').filter({ hasText: 'Nessun risultato per “AssenteHCUndici”. Modifica la ricerca o cambia ambito.' });
      await expect.soft(message).toHaveCount(1, { timeout: 1000 });
      await expect.soft(lens).toHaveCount(0, { timeout: 1000 });
      await search.fill('Inventata A');
      await expect(list.getByText('1 risultato', { exact: true })).toBeVisible();
      if (width > 900) await expect(lens).toBeVisible();
      else await expect(lens).not.toBeVisible();
      expect(await capture('uno')).toEqual(initial);
      await search.clear();
      await expect(list.getByText('3 risultati', { exact: true })).toBeVisible();
      expect(await capture('ripristinato')).toEqual(initial);
      await expect(message).toHaveCount(0);
    } finally {
      await info.attach('geometry', { body: JSON.stringify(frames, null, 2), contentType: 'application/json' });
      if (process.env.EMPTY_STATE_EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.EMPTY_STATE_EVIDENCE_DIR, `geometry-${theme}-${width}.json`), JSON.stringify(frames, null, 2));
      await fixture.close();
      expect(fixture.blocked).toEqual([]);
    }
  });
}
