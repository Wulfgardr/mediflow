/* @Codex */
import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

test('smart import kill switch disables analysis on patient detail', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';
  const suffix = `${Date.now()}`.slice(-4);
  const firstName = `Smart${suffix}`;
  const lastName = `Switch${suffix}`;
  const taxCode = `SMRTSW80A01H${suffix}`;
  const patientNotes = 'Paziente con ipertensione. Terapia domiciliare con ramipril 5 mg 1 compressa al giorno.';

  await bootstrapUnlockedSession(page, pin);

  await page.goto('/settings');
  await expect(page).toHaveURL(/\/settings$/);

  const killSwitch = page.getByLabel('Disabilita Smart Import localmente');
  await killSwitch.check();
  await expect(page.getByTestId('smart-import-kill-switch-card')).toContainText('Disabled');
  const saveButton = page.getByRole('button', { name: 'Salva Configurazione' });
  await saveButton.click();
  await expect(page.getByRole('button', { name: 'Salvataggio...' })).toHaveCount(0);
  await expect(saveButton).toBeEnabled();

  await page.goto('/patients/new');
  await expect(page.getByPlaceholder('Es. Mario')).toBeVisible();
  await page.getByPlaceholder('Es. Mario').fill(firstName);
  await page.getByPlaceholder('Es. Rossi').fill(lastName);
  await page.getByPlaceholder('RSSMRA80A01H501U').fill(taxCode);
  await page.getByPlaceholder('Informazioni aggiuntive, contesto familiare, codici accesso, preferenze del paziente...').fill(patientNotes);
  await page.getByRole('button', { name: 'Crea Nuova Scheda' }).click();
  await expect(page).toHaveURL(/\/$/);

  const search = page.getByTestId('patients-search-input');
  await search.fill(taxCode);
  await page.getByText(taxCode).click();
  await expect(page).toHaveURL(/\/patients\/.+/);

  const disabledCard = page.getByTestId('smart-import-disabled-card');
  await expect(disabledCard).toBeVisible();
  await expect(disabledCard).toContainText('Smart Import disabilitato');
  await expect(disabledCard).toContainText('Apri Impostazioni AI');
  await expect(page.getByRole('button', { name: 'Analizza fonti' })).toHaveCount(0);
});
