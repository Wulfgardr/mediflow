/* @Codex */
import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession, openAiFunzioniSettings, openPatientSection, setAiLaneKillSwitch } from './utils';

test('[E2E fixture] smart import kill switch disables analysis on patient detail', async ({ page }) => {
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

    // @Codex: ordinary preferences require preview and a separate apply gesture.
    const preferences = page.getByTestId('function-preferences');
    const card = preferences.locator('article').filter({
      has: page.getByRole('heading', { name: 'Importazione assistita', exact: true }),
    });
    const killSwitch = card.getByRole('switch', { name: 'Importazione assistita nella proposta', exact: true });
    await expect(killSwitch).toHaveAttribute('aria-checked', 'true');
    await killSwitch.click();
    await expect(killSwitch).toHaveAttribute('aria-checked', 'false');
    const previewResponse = page.waitForResponse(response =>
      response.url().endsWith('/api/settings/ai/functions/preview') && response.request().method() === 'POST');
    await card.getByRole('button', { name: 'Anteprima modifica', exact: true }).click();
    const preview = await previewResponse;
    expect(preview.status()).toBe(200);
    expect(await preview.json()).toMatchObject({
      writesPerformed: 0, command: { action: 'set_activation', functionId: 'smart_import', enabled: false },
    });
    const readEnabled = () => page.evaluate(async () => {
      const response = await fetch('/api/settings/ai/functions', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Preferences read failed: ${response.status}`);
      const value = await response.json() as { functions: { id: string; enabled: boolean }[] };
      return value.functions.find(row => row.id === 'smart_import')?.enabled;
    });
    expect(await readEnabled()).toBe(true);
    await preferences.getByRole('region', { name: 'Anteprima impostazioni', exact: true })
      .getByRole('button', { name: 'Applica alle impostazioni', exact: true }).click();
    await expect(preferences.getByRole('status').filter({
      hasText: /^Impostazioni salvate e rilette\. Nessuna modifica clinica\.$/u,
    })).toBeVisible();
    await expect(killSwitch).toHaveAttribute('aria-checked', 'false');
    await expect(card.getByText('Spento', { exact: true })).toBeVisible();
    expect(await readEnabled()).toBe(false);
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
    // @Codex: the blocked reason is disclosed in Riepilogo; the disabled
    // generation control remains in the assisted summary disclosure.
    const summaryLink = page.getByRole('navigation', { name: 'Sezioni della vista', exact: true })
      .getByRole('link', { name: 'Riepilogo', exact: true });
    await summaryLink.click();
    await expect(summaryLink).toHaveAttribute('aria-current', 'location');
    const reviewRow = page.getByTestId('review-queue-row-smart-import');
    await expect(reviewRow).toBeVisible();
    await expect(reviewRow).toContainText('Bloccato');
    await reviewRow.locator('summary').click();
    await expect(reviewRow.getByText('Smart Import è disattivato localmente', { exact: false })).toBeVisible();

    await openPatientSection(page, 'quadro');
    await page.getByText('Proposte dalle fonti cliniche · Smart Import', { exact: true }).click();
    const fabricCard = page.getByTestId('fabric-preview-card');
    await expect(fabricCard).toContainText('Raccogli dalle fonti della cartella');
    await expect(fabricCard.getByRole('button', { name: 'Prepara proposta' })).toBeDisabled();
  } finally {
    await restoreSmartImport();
  }
});
