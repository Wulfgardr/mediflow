/* @Codex */

import { expect, test } from '@playwright/test';

test('Kree8: indice virtuale, Enter, palette e aiuto restano tastierabili', async ({ page }) => {
  await page.goto('/mockups/kree8?area=incarico&patientCount=120');

  const listbox = page.getByRole('listbox', { name: 'Elenco pazienti in carico' });
  await expect(listbox).toBeVisible();
  await expect(page.getByText('120 risultati')).toBeVisible();

  const firstRow = page.getByRole('option', { name: /Caso sintetico 001/ });
  await firstRow.focus();
  await firstRow.press('End');
  const lastRow = page.getByRole('option', { name: /Caso sintetico 120/ });
  await expect(lastRow).toBeFocused();
  await expect(lastRow).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Caso sintetico 120', exact: true })).toBeVisible();

  await lastRow.press('PageUp');
  const pageUpIndex = await page.evaluate(() => Number(document.activeElement?.getAttribute('data-patient-index')));
  expect(pageUpIndex).toBeGreaterThanOrEqual(0);
  expect(pageUpIndex).toBeLessThan(119);

  await page.keyboard.press('ArrowUp');
  const arrowIndex = await page.evaluate(() => Number(document.activeElement?.getAttribute('data-patient-index')));
  expect(arrowIndex).toBe(pageUpIndex - 1);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('lume-frame-canvas')).toHaveAttribute('data-lume-context', 'scheda');

  await page.goto('/mockups/kree8?area=incarico&patientCount=120');
  const commandTrigger = page.getByRole('button', { name: 'Apri comandi e aiuto tastiera' });
  await commandTrigger.click();
  const commandDialog = page.getByRole('dialog', { name: 'Comandi MediFlow' });
  await expect(commandDialog).toBeVisible();
  const commandSearch = page.getByRole('combobox', { name: 'Cerca un comando' });
  await expect(commandSearch).toBeFocused();
  await commandSearch.fill('Diario');
  await expect(commandDialog.getByRole('option')).toHaveCount(1);
  await commandSearch.press('Enter');
  await expect(page.getByTestId('lume-frame-canvas')).toHaveAttribute('data-lume-context', 'diario');

  await page.keyboard.press('?');
  const helpDialog = page.getByRole('dialog', { name: 'Aiuto e scorciatoie' });
  await expect(helpDialog).toBeVisible();
  await expect(helpDialog.getByText('Apri la Scheda della riga attiva')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(helpDialog).toHaveCount(0);

  await page.getByRole('button', { name: /Pazienti/ }).click();
  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox', { name: 'Cerca nella lista pazienti' })).toBeFocused();
});
