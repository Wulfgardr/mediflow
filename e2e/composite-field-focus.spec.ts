import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { bootstrapUnlockedSession } from './utils';

async function indicator(element: Locator) {
  return element.evaluate(node => {
    const style = getComputedStyle(node);
    return {
      outline: !['none', 'hidden'].includes(style.outlineStyle) && parseFloat(style.outlineWidth) > 0 && !['transparent', 'rgba(0, 0, 0, 0)'].includes(style.outlineColor),
      shadow: style.boxShadow !== 'none',
    };
  });
}

for (const width of [768, 1440]) for (const theme of ['light', 'dark']) {
  test(`un solo indicatore nei campi composti ${width} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(theme => localStorage.setItem('mediflow-theme', theme), theme);
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    await page.goto('/?area=incarico');
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    const search = page.getByRole('searchbox', { name: 'Cerca nella lista pazienti', exact: true });
    const field = search.locator('..');
    const clear = page.getByRole('button', { name: 'Cancella la ricerca', exact: true });
    await search.fill('Paziente inesistente sintetico');
    await expect(page.getByText('0 risultati', { exact: true })).toBeVisible();
    await search.focus();
    await page.evaluate(() => document.fonts.ready);
    const evidence = async (state: string) => {
      const directory = process.env.COMPOSITE_FOCUS_EVIDENCE_DIR;
      const name = `${state}-${theme === 'light' ? 'giorno' : 'grafite'}-${width}`;
      const file = directory ? path.join(directory, name) : test.info().outputPath(name);
      await page.screenshot({ path: `${file}.png`, fullPage: true, animations: 'disabled' });
      fs.writeFileSync(`${file}.json`, JSON.stringify({ field: await indicator(field), input: await indicator(search), button: await indicator(clear) }, null, 2));
    };
    await evidence('pazienti-input');
    expect.soft(await indicator(search)).toEqual({ outline: false, shadow: false });
    expect.soft(await indicator(field)).toEqual({ outline: false, shadow: true });
    await search.press('Tab');
    await expect(clear).toBeFocused();
    await evidence('pazienti-cancella');
    expect.soft(await indicator(field)).toEqual({ outline: false, shadow: false });
    expect.soft(await indicator(clear)).toEqual({ outline: true, shadow: true });
    await clear.press('Enter');
    await expect(search).toBeFocused();
    expect.soft(await indicator(search)).toEqual({ outline: false, shadow: false });
    expect.soft(await indicator(field)).toEqual({ outline: false, shadow: true });

    await page.emulateMedia({ forcedColors: 'active' });
    await search.focus();
    expect.soft(await indicator(search)).toEqual({ outline: false, shadow: false });
    expect.soft(await indicator(field)).toEqual({ outline: true, shadow: false });
    await page.emulateMedia({ forcedColors: 'none' });

    await page.getByRole('link', { name: 'Nuova scheda', exact: true }).focus();
    await page.keyboard.press('ControlOrMeta+KeyK');
    const command = page.getByRole('combobox', { name: 'Cerca un comando', exact: true });
    await expect(command).toBeFocused();
    expect.soft(await indicator(command)).toEqual({ outline: false, shadow: false });
    expect.soft(await indicator(command.locator('..'))).toEqual({ outline: false, shadow: true });
    await page.keyboard.press('Escape');

    await page.evaluate(() => {
      const fixture = document.createElement('section');
      fixture.id = 'search-recipe-fixture';
      fixture.innerHTML = ['mf-input', 'input-field'].map((recipe, index) => `<div><input aria-label="Ricerca sintetica ${index}" class="${recipe} mf-search-input" value="Test sintetico"><button type="button" class="mf-button-icon" aria-label="Cancella sintetico ${index}">×</button></div>`).join('');
      document.body.append(fixture);
    });
    for (const index of [0, 1]) {
      const input = page.getByRole('textbox', { name: `Ricerca sintetica ${index}`, exact: true });
      await input.focus();
      expect.soft(await indicator(input)).toEqual({ outline: false, shadow: true });
      await input.press('Tab');
      const button = page.getByRole('button', { name: `Cancella sintetico ${index}`, exact: true });
      await expect(button).toBeFocused();
      expect.soft(await indicator(input)).toEqual({ outline: false, shadow: false });
      expect.soft(await indicator(button)).toEqual({ outline: true, shadow: true });
    }
  });
}
