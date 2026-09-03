/* @Codex */
import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession, openAiFunzioniSettings, setAiLaneKillSwitch } from './utils';

test('smart import kill switch disables analysis on patient detail', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';
  const suffix = `${Date.now()}`.slice(-4);
  const firstName = `Smart${suffix}`;
  const lastName = `Switch${suffix}`;
  const taxCode = `SMRTSW80A01H${suffix}`;
  const patientNotes = 'Paziente con ipertensione. Terapia domiciliare con ramipril 5 mg 1 compressa al giorno.';

  await bootstrapUnlockedSession(page, pin);

  const disableSmartImport = async () => {
    // The lane is fail-closed when the setting row is absent (fresh e2e DB): pin it to
    // 'enabled' so the toggle below always starts from the ON state.
    await setAiLaneKillSwitch(page, 'aiSmartImportKillSwitch', 'enabled');

    // WUL-297: kill switches now live on the dedicated AI sub-route. The helper waits
    // for the async settings load, whose completion resets the switches to the stored
    // values and would otherwise undo a click that landed too early.
    await openAiFunzioniSettings(page);

    const killSwitch = page.getByRole('switch', { name: 'Smart Import locale' });
    await killSwitch.click();
    await expect(killSwitch).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('smart-import-kill-switch-card')).toContainText('Spento');
    const saveButton = page.getByRole('button', { name: 'Salva Configurazione' });
    await saveButton.click();
    await expect(page.getByRole('button', { name: 'Salvataggio...' })).toHaveCount(0);
    await expect(saveButton).toBeEnabled();
  };

  const restoreSmartImport = async () => {
    await page.evaluate(async () => {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'aiSmartImportKillSwitch',
          value: 'enabled',
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }
    });
  };

  try {
    await disableSmartImport();

    // WUL-274/Kree8: create via API and open the primary Scheda route (/modules), where the
    // Fabric preview mounts. The legacy new-patient submit ("Crea Nuova Scheda") and the
    // cockpit patient-search navigation no longer expose a patients-search-input testid.
    const patientId = await page.evaluate(async (body) => {
      const response = await fetch('/api/patients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { id?: string; error?: string };
      if (!response.ok || !payload.id) {
        throw new Error(payload.error || `Patient creation failed with HTTP ${response.status}`);
      }
      return payload.id;
    }, { firstName, lastName, taxCode, address: 'Via Test 1', phone: '1234567890', notes: patientNotes });

    await page.goto(`/patients/${patientId}/modules`);
    await expect(page).toHaveURL(new RegExp(`/patients/${patientId}/modules$`));
    const documents = page.getByRole('button', { name: /Documenti Archivio documenti ed evidenze/u });
    await expect(documents).toBeVisible({ timeout: 20_000 });
    if (await documents.getAttribute('aria-expanded') !== 'true') await documents.click();
    await expect(documents).toHaveAttribute('aria-expanded', 'true');

    const reviewRow = page.getByTestId('review-queue-row-smart-import');
    await expect(reviewRow).toContainText('Bloccato');
    await expect(reviewRow).toContainText('Smart Import è disattivato localmente');

    const fabricCard = page.getByTestId('fabric-preview-card');
    await expect(fabricCard).toContainText('Fabric · anteprima sola lettura');
    await expect(fabricCard.getByRole('button', { name: 'Carica contesto' })).toBeDisabled();
  } finally {
    await restoreSmartImport();
  }
});
