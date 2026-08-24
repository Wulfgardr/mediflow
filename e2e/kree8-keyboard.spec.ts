/* @Codex */

import { expect, test } from '@playwright/test';

import { bootstrapUnlockedSession } from './utils';

test('K4: tastiera cross-packet attraversa worklist, comandi e ricerca senza duplicazioni', async ({ page }) => {
  test.setTimeout(90_000);
  const fixtureMarker = `K4Synthetic${Date.now().toString().slice(-8)}`;
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const patients = await page.evaluate(async (marker) => {
    const created: Array<{ id: string; name: string }> = [];
    for (let index = 0; index < 120; index += 1) {
      const firstName = `Caso ${String(index + 1).padStart(3, '0')}`;
      const response = await fetch('/api/patients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName,
          lastName: marker,
          taxCode: `${marker.slice(-8)}${String(index).padStart(3, '0')}`,
          birthDate: '1972-04-12T00:00:00.000Z',
        }),
      });
      if (!response.ok) throw new Error(`Fixture K4 ${index + 1}: HTTP ${response.status}`);
      const { id } = await response.json() as { id: string };
      created.push({ id, name: `${marker} ${firstName}` });
    }
    return created;
  }, fixtureMarker);
  await page.goto('/?area=incarico');

  const listbox = page.getByRole('listbox', { name: 'Elenco pazienti in carico', exact: true });
  const search = page.getByRole('searchbox', { name: 'Cerca nella lista pazienti', exact: true });
  await expect(listbox).toBeVisible();
  await search.fill(fixtureMarker);
  await expect(page.getByText('120 risultati', { exact: true })).toBeVisible();

  const firstRow = page.getByRole('option').first();
  await firstRow.focus();
  await firstRow.press('End');
  const lastRow = page.locator('[data-patient-index="119"]');
  await expect(lastRow).toBeFocused();
  await expect(lastRow).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('PageUp');
  await expect.poll(() => page.evaluate(() => Number(document.activeElement?.getAttribute('data-patient-index'))))
    .toBeLessThan(119);
  const pageUpIndex = await page.evaluate(() => Number(document.activeElement?.getAttribute('data-patient-index')));
  expect(pageUpIndex).toBeGreaterThanOrEqual(0);
  expect(pageUpIndex).toBeLessThan(119);
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => page.evaluate(() => Number(document.activeElement?.getAttribute('data-patient-index'))))
    .toBe(pageUpIndex - 1);
  await page.keyboard.press('End');
  const lastRowText = await lastRow.textContent();
  const selectedPatient = patients.find((patient) => lastRowText?.includes(patient.name));
  if (!selectedPatient) throw new Error('La riga attiva non corrisponde a una fixture K4 sintetica.');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/patients/${selectedPatient.id}/modules$`));
  await expect(page.getByTestId('lume-scheda-header')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: selectedPatient.name, level: 1 })).toHaveCount(1);

  await page.goto('/?area=incarico');

  const commandTrigger = page.getByRole('button', { name: 'Apri comandi e aiuto tastiera', exact: true });
  await commandTrigger.click();
  const commandDialog = page.getByRole('dialog', { name: 'Comandi MediFlow', exact: true });
  const commandSearch = page.getByRole('combobox', { name: 'Cerca un comando', exact: true });
  await expect(commandDialog).toHaveCount(1);
  await expect(commandSearch).toBeFocused();
  await commandSearch.fill('Diario');
  await expect(commandDialog.getByRole('option')).toHaveCount(1);
  await commandSearch.press('Enter');
  await expect(page.getByTestId('lume-frame-canvas')).toHaveAttribute('data-lume-context', 'diario');
  await expect(search).not.toBeVisible();

  await page.keyboard.press('?');
  const helpDialog = page.getByRole('dialog', { name: 'Aiuto e scorciatoie', exact: true });
  await expect(helpDialog).toHaveCount(1);
  await expect(helpDialog.getByText('Apri la Scheda della riga attiva', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(helpDialog).toHaveCount(0);
  await expect(commandTrigger).toBeFocused();

  await commandTrigger.click();
  await expect(commandSearch).toBeFocused();
  await commandSearch.fill('Pazienti');
  await expect(commandDialog.getByRole('option')).toHaveCount(1);
  await commandSearch.press('Enter');
  await expect(search).toBeVisible();
  await page.keyboard.press('/');
  await expect(search).toBeFocused();
  await search.fill('');
  await search.press('?');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(search).toHaveValue('?');
  await search.fill('');
  await commandTrigger.focus();
  await expect(commandTrigger).toBeFocused();
  await expect(search).not.toBeFocused();
  await page.keyboard.press('/');
  await expect(search).toBeFocused();

  expect(consoleErrors).toEqual([]);
});

test('L9: i comandi raggiungono Analisi e Scale una sola volta senza scorciatoie di authority', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await page.goto('/?area=incarico');

  const commandTrigger = page.getByRole('button', { name: 'Apri comandi e aiuto tastiera', exact: true });
  await commandTrigger.focus();
  await page.keyboard.press('ControlOrMeta+KeyK');

  const commandDialog = page.getByRole('dialog', { name: 'Comandi MediFlow', exact: true });
  const commandSearch = page.getByRole('combobox', { name: 'Cerca un comando', exact: true });
  await expect(commandDialog).toHaveCount(1);
  await expect(commandSearch).toBeFocused();

  await commandSearch.fill('Analisi');
  const analyticsCommand = commandDialog.getByRole('option', { name: /Apri Analisi/ });
  await expect(commandDialog.getByRole('option')).toHaveCount(1);
  await expect(analyticsCommand).toHaveCount(1);
  await expect(analyticsCommand).not.toHaveAttribute('aria-disabled', 'true');
  await commandSearch.press('Enter');
  await expect(page).toHaveURL(/\/analytics$/);
  await expect(page.getByRole('heading', { name: 'Cruscotto locale', level: 1 })).toBeVisible();

  await page.goto('/?area=incarico');
  await commandTrigger.focus();
  await page.keyboard.press('ControlOrMeta+KeyK');
  await expect(commandSearch).toBeFocused();
  await commandSearch.fill('Scale');
  const scalesCommand = commandDialog.getByRole('option', { name: /Apri Scale cliniche/ });
  await expect(commandDialog.getByRole('option')).toHaveCount(1);
  await expect(scalesCommand).toHaveCount(1);
  await expect(scalesCommand).not.toHaveAttribute('aria-disabled', 'true');
  await commandSearch.press('Escape');
  await expect(commandDialog).toHaveCount(0);
  await expect(commandTrigger).toBeFocused();

  await page.keyboard.press('ControlOrMeta+KeyK');
  await commandSearch.fill('Scale');
  await commandSearch.press('Enter');
  await expect(page).toHaveURL(/\/scales$/);
  await expect(page.getByRole('heading', { name: 'Scale cliniche', level: 1 })).toBeVisible();

  expect(consoleErrors).toEqual([]);
});
