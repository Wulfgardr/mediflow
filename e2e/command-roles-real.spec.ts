import { expect, test, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { bootstrapUnlockedSession, openPatientSection } from './utils';

async function seedPatient(page: Page) {
  const id = `command-roles-${randomUUID()}`;
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  for (const [route, body] of [
    ['/api/patients', { id, taxCode: `SYNTHETIC-${id}`, firstName: 'Giulia', lastName: 'Fervi', birthDate: '1958-04-17', notes: 'Caso sintetico per verifica comandi.', diagnoses: [{ code: 'I10', description: 'Ipertensione essenziale', system: 'ICD-10' }] }],
    ['/api/therapies', { id: `${id}-therapy`, patientId: id, drugName: 'Ramipril', activePrinciple: 'Ramipril', dosage: '5 mg al mattino', status: 'active', startDate: '2025-01-15T08:00:00.000Z' }],
  ] as const) {
    await page.evaluate(async ({ route, body }) => {
      const response = await fetch(route, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(`${route}: ${response.status} ${await response.text()}`);
    }, { route, body });
  }
  return id;
}

async function setTheme(page: Page, theme: string) {
  await page.evaluate(theme => {
    const mode = theme === 'giorno' ? 'light' : 'dark';
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(mode);
    localStorage.setItem('mediflow-theme', mode);
  }, theme);
}

async function contrast(button: Locator) {
  return button.evaluate(element => {
    const rgba = (value: string) => {
      if (value.startsWith('color(srgb ')) {
        const channels = value.match(/[\d.]+/g)!.map(Number);
        return [...channels.slice(0, 3).map(c => c * 255), channels[3] ?? 1];
      }
      if (!/^rgba?\(/.test(value)) throw new Error(`Unsupported color: ${value}`);
      const channels = value.match(/[\d.]+/g)!.map(Number);
      return [...channels.slice(0, 3), channels[3] ?? 1];
    };
    const blend = (front: number[], back: number[], alpha: number) => front.slice(0, 3).map((c, i) => c * alpha + back[i] * (1 - alpha));
    const ancestors: Element[] = [];
    for (let parent = element.parentElement; parent; parent = parent.parentElement) ancestors.unshift(parent);
    let backdrop = [255, 255, 255];
    for (const ancestor of ancestors) {
      const style = getComputedStyle(ancestor);
      if (Number(style.opacity) !== 1) throw new Error('Ancestor opacity needs group compositing');
      const color = rgba(style.backgroundColor);
      backdrop = blend(color, backdrop, color[3]);
    }
    const style = getComputedStyle(element);
    const opacity = Number(style.opacity);
    const bg = rgba(style.backgroundColor), fg = rgba(style.color);
    const fill = blend(bg, backdrop, bg[3]);
    const background = blend(fill, backdrop, opacity);
    const foreground = blend(blend(fg, fill, fg[3]), backdrop, opacity);
    const luminance = (rgb: number[]) => rgb.map(c => c / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
      .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    const a = luminance(foreground), b = luminance(background);
    return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), color: style.color, backgroundColor: style.backgroundColor, opacity, foreground, background, cursor: style.cursor };
  });
}

async function evidence(page: Page, name: string, metrics: unknown) {
  const directory = process.env.COMMAND_ROLES_EVIDENCE_DIR;
  const file = directory ? path.join(directory, name) : test.info().outputPath(name);
  await page.screenshot({ path: `${file}.png`, fullPage: true, animations: 'disabled' });
  fs.writeFileSync(`${file}.json`, `${JSON.stringify(metrics, null, 2)}\n`);
}

for (const theme of ['giorno', 'grafite']) for (const width of [1440, 768]) {
  test(`conferma distruttiva leggibile ${theme} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme === 'giorno' ? 'light' : 'dark' });
    const id = await seedPatient(page);
    await page.goto(`/patients/${id}/modules`);
    await openPatientSection(page, 'terapie');
    await setTheme(page, theme);
    await page.getByRole('button', { name: 'Elimina Ramipril solo se inserito per errore', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const confirm = dialog.getByRole('button', { name: 'Elimina', exact: true });
    await expect(confirm).toBeDisabled();
    const disabled = await contrast(confirm);
    await evidence(page, `real-after-conferma-elimina-terapia-${theme}-${width}`, disabled);
    expect.soft(disabled.ratio, JSON.stringify(disabled)).toBeGreaterThanOrEqual(4.5);
    expect.soft(disabled.cursor).toBe('not-allowed');
    await dialog.getByRole('textbox').fill('Inserimento sintetico errato');
    await expect(confirm).toBeEnabled();
    await expect.poll(() => confirm.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(disabled.backgroundColor);
    const enabled = await contrast(confirm);
    expect.soft(enabled.ratio).toBeGreaterThanOrEqual(4.5);
    expect.soft(enabled.backgroundColor).not.toBe(disabled.backgroundColor);
    await evidence(page, `real-after-conferma-attiva-${theme}-${width}`, enabled);
    await dialog.getByRole('textbox').fill('   ');
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('button', { name: 'Annulla', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Elimina Ramipril solo se inserito per errore', exact: true })).toBeVisible();
  });

  test(`rimozioni ancorate alla scheda ${theme} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1800 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme === 'giorno' ? 'light' : 'dark' });
    const id = await seedPatient(page);
    await page.goto(`/patients/${id}/edit`);
    await setTheme(page, theme);
    await page.getByRole('button', { name: 'Aggiungi passaggio', exact: true }).click();
    for (const [label, state] of [['Rimuovi diagnosi', 'diagnosi'], ['Rimuovi pianificazione', 'pianificazione']]) {
      const remove = page.getByRole('button', { name: label, exact: true }).first();
      await remove.focus();
      const position = await remove.evaluate(element => {
        const style = getComputedStyle(element), box = element.getBoundingClientRect(), card = element.parentElement!.getBoundingClientRect();
        const parent = getComputedStyle(element.parentElement!);
        return { position: style.position, top: box.top - card.top, right: card.right - box.right, cardBorderTop: parseFloat(parent.borderTopWidth), cardBorderRight: parseFloat(parent.borderRightWidth), width: box.width, height: box.height };
      });
      await evidence(page, `real-after-rimozione-${state}-${theme}-${width}`, position);
      expect.soft(position.position, label).toBe('absolute');
      expect.soft(position.top, label).toBeCloseTo(-8 + position.cardBorderTop, 1);
      expect.soft(position.right, label).toBeCloseTo(-8 + position.cardBorderRight, 1);
    }
  });
}
