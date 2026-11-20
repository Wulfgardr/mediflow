import { expect, test } from '@playwright/test';
import { drive } from './browser';
import { actionSchema } from './commands';

test('censisce e guida un controllo appena scoperto con ruolo e nome', async ({ page }, info) => {
  const output = info.outputDir;
  await page.setContent('<label for="input">Testo di prova</label><input id="input"><button>Continua</button>');
  const target = { role: 'textbox', name: 'Testo di prova' };
  await expect(drive(page, { op: 'discover' }, output)).resolves.toMatchObject({
    tree: expect.stringContaining('textbox "Testo di prova"'),
  });
  await drive(page, { op: 'fill', target, value: 'Dato sintetico' }, output);
  await drive(page, { op: 'expectValue', target, value: 'Dato sintetico' }, output);
  await drive(page, { op: 'focus', target }, output);
  await drive(page, { op: 'press', key: 'Tab' }, output);
  await drive(page, { op: 'expect', target: { role: 'button', name: 'Continua' }, state: 'focused' }, output);
});

test('blocca un controllo ambiguo, anche se il primo sarebbe azionabile', async ({ page }, info) => {
  await page.setContent('<button>Conferma</button><section aria-label="Dettaglio"><button>Conferma</button></section>');
  const target = { role: 'button', name: 'Conferma' };
  await expect(drive(page, { op: 'click', target }, info.outputDir)).rejects.toThrow('Controllo ambiguo');
  await drive(page, { op: 'focus', target: [{ role: 'region', name: 'Dettaglio' }, target] }, info.outputDir);
});

test('rifiuta azioni, percorsi e selettori fuori dal formato', () => {
  for (const input of [
    { op: 'resize', width: 390.5, height: 880 },
    { op: 'resize', width: 0, height: 880 },
    { op: 'resize', width: 390, height: 5000 },
    { op: 'resize', width: '390', height: 880 },
    { op: 'goto', url: 'http://127.0.0.1' },
    { op: 'eval', code: '1+1' },
    { op: 'click', target: { css: 'button' } },
    { op: 'click', target: { role: 'button', name: '', nth: 0 } },
    { op: 'uploadText', target: { role: 'button', name: 'Carica' }, file: '../file', value: 'Test' },
    { op: 'screenshot', file: '../file' },
  ]) expect(actionSchema.safeParse(input).success).toBe(false);
});


test('ridimensiona la stessa pagina, aziona il menu compatto e conserva il campo', async ({ page }, info) => {
  await page.setViewportSize({ width: 1320, height: 880 });
  await page.setContent(`
    <style>@media (min-width: 600px) { details { display: none; } }</style>
    <label for="draft">Bozza</label><textarea id="draft">Testo di prova</textarea>
    <details><summary>Altro</summary><details><summary>Apri dettaglio</summary>Dettaglio disponibile</details></details>
  `);
  const output = info.outputDir;
  const menu = { text: 'Altro' };
  await drive(page, { op: 'expect', target: menu, state: 'hidden' }, output);
  await expect(drive(page, { op: 'resize', width: 390, height: 880 }, output)).resolves.toMatchObject({
    viewport: { width: 390, height: 880 },
  });
  await drive(page, { op: 'click', target: menu }, output);
  await drive(page, { op: 'click', target: { text: 'Apri dettaglio' } }, output);
  await expect(page.getByText('Dettaglio disponibile')).toBeVisible();
  await expect(drive(page, { op: 'resize', width: 1320, height: 880 }, output)).resolves.toMatchObject({
    viewport: { width: 1320, height: 880 },
  });
  await drive(page, { op: 'expectValue', target: { role: 'textbox', name: 'Bozza' }, value: 'Testo di prova' }, output);
});
