import { expect, test } from '@playwright/test';
import { installGestureMeter } from './fixtures/gesture-meter';
import { assertGestureRatchet } from './fixtures/gesture-ratchet';

test.use({ actionTimeout: 10_000, screenshot: 'off', video: 'off', trace: 'off' });

test('contatore: clic, Tab, Invio, freccia, Esc, scorciatoia e testo separato', async ({ page }) => {
  await page.route('http://127.0.0.1:39999/counter', route => route.fulfill({ body:
    '<input aria-label="Testo"><button>Comando</button><div role="textbox" contenteditable="true" aria-label="Nota"></div>', contentType: 'text/html' }));
  await page.addInitScript(installGestureMeter);
  await page.goto('http://127.0.0.1:39999/counter');
  await page.evaluate(() => window.gestureMeter.start());
  await page.getByRole('textbox', { name: 'Testo', exact: true }).click();
  expect(await page.evaluate(() => window.gestureMeter.stop())).toMatchObject({ gesti: 1, clic: 1, tasti: 0, comandi: 0 });
  await page.evaluate(() => window.gestureMeter.start());
  await page.keyboard.type('abcdefghij');
  let reading = await page.evaluate(() => window.gestureMeter.stop());
  expect(reading).toMatchObject({ gesti: 0, clic: 0, tasti: 10, comandi: 0 });
  await page.evaluate(() => window.gestureMeter.start());
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Comando' })).toBeFocused();
  const clicks: number[] = [];
  await page.exposeFunction('observeSyntheticClick', (detail: number) => clicks.push(detail));
  await page.evaluate(() => document.addEventListener('click', event => {
    void (window as unknown as { observeSyntheticClick(n: number): Promise<void> }).observeSyntheticClick(event.detail);
  }));
  for (const key of ['Enter', 'ArrowDown', 'Escape', 'ControlOrMeta+KeyK']) await page.keyboard.press(key);
  reading = await page.evaluate(() => window.gestureMeter.stop());
  expect(reading).toMatchObject({ gesti: 5, clic: 0, tasti: 0, comandi: 5 });
  expect(reading.events.map(event => event.key)).toEqual(['Tab', 'Enter', 'ArrowDown', 'Escape', 'k']);
  expect(clicks).toContain(0);
  expect(reading.events.every(event => event.responseMs !== null && event.responseMs >= 0)).toBe(true);
  await page.getByRole('textbox', { name: 'Nota' }).click();
  await page.evaluate(() => window.gestureMeter.start());
  await page.keyboard.type('abcdefghij');
  await page.keyboard.press('Backspace');
  for (const key of ['Shift', 'Control', 'Meta', 'Alt']) await page.keyboard.press(key);
  expect(await page.evaluate(() => window.gestureMeter.stop())).toMatchObject({ gesti: 0, tasti: 11 });
});

test('cricchetto: stesso conto verde, un gesto in più rosso', () => {
  const base = { gesti: 4, clic: 2, tasti: 10, comandi: 2 };
  expect(() => assertGestureRatchet(base, base, 'prova')).not.toThrow();
  for (const metric of ['gesti', 'clic', 'tasti', 'comandi'] as const)
    expect(() => assertGestureRatchet({ ...base, [metric]: base[metric] + 1 }, base, 'prova')).toThrow(`${metric} ${base[metric] + 1} > base ${base[metric]}`);
  // Deliberate persistent falsification switch; never updates the baseline.
  assertGestureRatchet({ ...base, gesti: base.gesti + (process.env.GESTURE_PROVE_RED === '1' ? 1 : 0) }, base, 'prova');
});
