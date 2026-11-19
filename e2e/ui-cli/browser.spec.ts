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
    { op: 'goto', url: 'http://127.0.0.1' },
    { op: 'eval', code: '1+1' },
    { op: 'click', target: { css: 'button' } },
    { op: 'click', target: { role: 'button', name: '', nth: 0 } },
    { op: 'uploadText', target: { role: 'button', name: 'Carica' }, file: '../file', value: 'Test' },
    { op: 'screenshot', file: '../file' },
  ]) expect(actionSchema.safeParse(input).success).toBe(false);
});
