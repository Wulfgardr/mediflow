import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { bootstrapUnlockedSession } from './utils';

for (const width of [768, 1440]) for (const percent of [100, 200]) for (const theme of ['light', 'dark']) {
  test(`ricerca stabile ${width} testo ${percent}% ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(theme => localStorage.setItem('mediflow-theme', theme), theme);
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    await page.goto('/?area=incarico');
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    const search = page.getByRole('searchbox', { name: 'Cerca nella lista pazienti', exact: true });
    const clear = page.getByRole('button', { name: 'Cancella la ricerca', exact: true });
    const field = search.locator('..');
    await page.evaluate(percent => { document.documentElement.style.fontSize = `${16 * percent / 100}px`; }, percent);
    await expect(search).toHaveCSS('font-size', `${14 * percent / 100}px`);
    const worklist = page.getByTestId('lume-worklist');
    await expect(worklist.getByText(/^\d+ risultat[oi]$/u)).toBeVisible();
    const unmatchedQuery = `Assente${randomUUID().replaceAll('-', '')}`;
    const settle = async () => {
      await page.waitForLoadState('networkidle');
      await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
    };
    const geometry = async () => search.evaluate(input => {
      const rect = (element: Element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      };
      return { field: rect(input.parentElement!), input: rect(input), list: rect(document.querySelector('[data-testid="lume-worklist"]')!), lineHeight: parseFloat(getComputedStyle(input).lineHeight) };
    });
    const states: Record<string, Awaited<ReturnType<typeof geometry>>> = {};
    const evidence = async (state: string) => {
      await settle();
      states[state] = await geometry();
      const directory = process.env.SEARCH_STABILITY_EVIDENCE_DIR;
      if (directory) await page.screenshot({ path: path.join(directory, `${state}-${theme === 'light' ? 'giorno' : 'grafite'}-${width}-${percent}.png`), fullPage: true, animations: 'disabled' });
    };
    await expect(clear).toHaveCount(0);
    await expect(field.locator('button:visible')).toHaveCount(0);
    await search.focus();
    await evidence('vuoto');
    await search.press('Tab');
    expect(await field.evaluate(node => node.contains(document.activeElement))).toBe(false);
    await search.fill(unmatchedQuery);
    await expect(worklist.getByText('0 risultati', { exact: true })).toBeVisible();
    await evidence('testo');
    expect.soft(states.testo.field).toEqual(states.vuoto.field);
    expect.soft(states.testo.input).toEqual(states.vuoto.input);
    expect.soft(states.testo.list.x).toBe(states.vuoto.list.x);
    expect.soft(states.testo.list.y).toBe(states.vuoto.list.y);
    expect.soft(states.testo.list.width).toBe(states.vuoto.list.width);
    const button = (await clear.boundingBox())!;
    const input = states.testo.input;
    expect.soft(button.height).toBe(44);
    expect.soft(button.width).toBe(44);
    expect.soft(Math.abs(button.y + button.height / 2 - input.y - input.height / 2)).toBeLessThan(1);
    expect.soft(states.testo.field.height).toBeLessThanOrEqual(Math.max(44, states.testo.lineHeight) + 2);
    await search.press('Tab');
    await expect(clear).toBeFocused();
    await clear.press('Enter');
    await expect(search).toBeFocused();
    await expect(clear).toHaveCount(0);
    await expect(field.locator('button:visible')).toHaveCount(0);
    await evidence('cancellato');
    expect.soft(states.cancellato).toEqual(states.vuoto);
    const directory = process.env.SEARCH_STABILITY_EVIDENCE_DIR;
    if (directory) fs.writeFileSync(path.join(directory, `geometry-${theme}-${width}-${percent}.json`), JSON.stringify(states, null, 2));
  });
}
