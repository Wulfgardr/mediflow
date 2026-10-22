import { expect, test, type Locator, type Page } from '@playwright/test';
import { bootstrapUnlockedSession, assertNoHorizontalOverflow, assertNotClippedInViewport } from './utils';

const roles = ['primary', 'secondary', 'text', 'destructive', 'icon'] as const;

async function openFixture(page: Page, theme = 'giorno') {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await page.goto('/mockups/commands');
  await expect(page.getByTestId('command-roles')).toBeVisible();
  await page.evaluate(theme => {
    document.documentElement.classList.toggle('dark', theme === 'grafite');
    document.documentElement.classList.toggle('light', theme === 'giorno');
  }, theme);
}

async function geometry(locator: Locator) {
  return locator.evaluate(element => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return { minHeight: style.minHeight, minWidth: style.minWidth, padding: style.padding, radius: style.borderRadius,
      fontSize: style.fontSize, weight: style.fontWeight, leading: style.lineHeight, border: style.borderWidth, width: box.width, height: box.height };
  });
}

for (const theme of ['giorno', 'grafite']) for (const width of [1440, 768, 390, 320]) {
  test(`cattura comandi ${theme} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1100 });
    await openFixture(page, theme);
    await assertNoHorizontalOverflow(page, [{ label: 'fixture comandi', selector: 'document' }]);
    for (const button of await page.getByTestId('command-roles').getByRole('button').all()) {
      await assertNotClippedInViewport(button, await button.innerText());
    }
    await page.screenshot({ path: test.info().outputPath(`commands-${theme}-${width}.png`), fullPage: true, animations: 'disabled' });
    await page.locator('[data-command-role="icon"] button').first().focus();
    await page.locator('[data-command-role="text"] button').first().hover();
    await page.screenshot({ path: test.info().outputPath(`commands-states-${theme}-${width}.png`), fullPage: true, animations: 'disabled' });
  });
}

for (const theme of ['giorno', 'grafite']) test(`stesso ruolo stessa geometria e stati accessibili ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await openFixture(page, theme);
  for (const role of roles) {
    const buttons = page.locator(`[data-command-role="${role}"] button`);
    const enabled = buttons.first();
    await expect(enabled, `${role}: anello nel wrapper`).toHaveCSS('position', 'relative');
    const expected = await geometry(enabled);
    expect(await geometry(buttons.nth(1)), `${role}: classe e wrapper`).toEqual(expected);
    expect(await geometry(buttons.last()), `${role}: disabled`).toEqual(expected);
    expect(expected).toMatchObject({ minHeight: '40px', minWidth: '40px', radius: '10px', padding: role === 'icon' ? '8px' : '8px 16px', fontSize: '14px', border: '1px' });
    const background = await enabled.evaluate(element => getComputedStyle(element).backgroundColor);
    await enabled.hover();
    await expect.poll(() => enabled.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(background);
    expect(await geometry(enabled), `${role}: hover`).toEqual(expected);
    await page.keyboard.press('Tab');
    await enabled.focus();
    await expect(enabled).toBeFocused();
    await expect(enabled).toHaveCSS('outline-style', 'solid');
    await expect(enabled).toHaveCSS('outline-width', '2px');
    expect(await geometry(enabled), `${role}: focus`).toEqual(expected);
    await expect(buttons.last()).toBeDisabled();
    await page.keyboard.press('Enter');
  }
  await expect(page.getByRole('status')).toHaveText('Attivazioni di prova: 5');
  await expect(page.getByRole('button', { name: 'Apri altre azioni', exact: true })).toHaveAccessibleName('Apri altre azioni');
  const primary = page.locator('[data-command-role="primary"] button').first();
  const secondary = page.locator('[data-command-role="secondary"] button').first();
  const text = page.locator('[data-command-role="text"] button').first();
  const aliases = page.getByTestId('command-aliases');
  for (const [index, exemplar] of [[0, primary], [1, secondary], [2, secondary], [3, text]] as const) {
    expect(await geometry(aliases.getByRole('button').nth(index))).toEqual(await geometry(exemplar));
  }
  expect(await geometry(aliases.getByRole('link'))).toEqual(await geometry(primary));
  const legacyCritical = page.getByTestId('command-legacy-critical');
  await expect(legacyCritical).toHaveCSS('background-color', await page.getByTestId('command-confirmation').evaluate(element => getComputedStyle(element).backgroundColor));
  await legacyCritical.hover();
  await expect(legacyCritical).toHaveCSS('background-color', await page.getByTestId('command-confirmation').evaluate(element => getComputedStyle(element).backgroundColor));
  const destructive = page.locator('[data-command-role="destructive"] button').first();
  await expect(destructive).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.getByTestId('command-confirmation')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  expect(await primary.evaluate(element => getComputedStyle(element).backgroundColor))
    .not.toBe(await page.locator('[data-command-role="primary"] button').last().evaluate(element => getComputedStyle(element).backgroundColor));
});

test.describe('comandi al tocco', () => {
  test.use({ hasTouch: true });
  test('bersagli di almeno 44 px anche su schermo largo', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await openFixture(page);
    for (const button of await page.getByTestId('command-roles').getByRole('button').all()) {
      const box = await button.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
  });
});

for (const scale of [2, 4]) test(`comandi con ingrandimento CSS ${scale * 100}% (proxy zoom)`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await openFixture(page);
  await page.evaluate(scale => { document.body.style.zoom = String(scale); }, scale);
  await assertNoHorizontalOverflow(page, [{ label: 'comandi ingranditi', selector: 'document' }]);
  const icon = page.getByRole('button', { name: 'Apri altre azioni', exact: true });
  await icon.focus();
  await expect(icon).toBeFocused();
  await assertNotClippedInViewport(icon, 'icona ingrandita');
  await page.screenshot({ path: test.info().outputPath(`commands-css-zoom-${scale}.png`), fullPage: true, animations: 'disabled' });
});
