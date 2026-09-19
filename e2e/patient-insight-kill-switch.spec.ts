/* @Codex */
import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession, openAiFunzioniSettings, openPatientSection, setAiLaneKillSwitch } from './utils';

// This DB is shared across specs; leaving Patient Insight disabled would break
// specs that expect it enabled. Restore the switch after the test.
test.afterEach(async ({ page }) => {
  await page.evaluate(async () => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'aiPatientInsightKillSwitch', value: 'enabled' }),
    }).catch(() => undefined);
  });
});

test('patient insight kill switch disables generation on patient detail', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';

  await bootstrapUnlockedSession(page, pin);

  // The lane is fail-closed when the setting row is absent (fresh e2e DB): pin it to
  // 'enabled' so the toggle below always starts from the ON state.
  await setAiLaneKillSwitch(page, 'aiPatientInsightKillSwitch', 'enabled');

  // WUL-297: kill switches now live on the dedicated AI sub-route. The helper waits
  // for the async settings load, whose completion resets the switches to the stored
  // values and would otherwise undo a click that landed too early.
  await openAiFunzioniSettings(page);

  const killSwitch = page.getByRole('switch', { name: 'Quadro paziente nella proposta' });
  await expect(killSwitch).toHaveAttribute('aria-checked', 'true');
  await killSwitch.click();
  await expect(killSwitch).toHaveAttribute('aria-checked', 'false');
  const preferenceCard = killSwitch.locator('xpath=ancestor::article');
  await preferenceCard.getByRole('button', { name: 'Anteprima modifica' }).click();
  const settingsPreview = page.getByRole('region', { name: 'Anteprima impostazioni' });
  await expect(settingsPreview).toContainText('Quadro paziente: spento');
  await settingsPreview.getByRole('button', { name: 'Applica alle impostazioni' }).click();
  await expect(page.getByRole('status')).toContainText('Impostazioni salvate e rilette. Nessuna modifica clinica.');

  const patientId = await page.evaluate(async () => {
    const response = await fetch('/api/patients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Kill',
        lastName: 'Switch',
        taxCode: `KILLSWITCH${Date.now()}`,
        address: 'Via Test 1',
        phone: '1234567890',
      }),
    });

    const payload = await response.json() as { id?: string; error?: string };
    if (!response.ok || !payload.id) {
      throw new Error(payload.error || `Patient creation failed with HTTP ${response.status}`);
    }

    return payload.id;
  });

  // WUL-274/Kree8: the AI insight (and its disabled card) live on the primary Scheda
  // route (/modules), not the cockpit "Quadro" landing at /patients/:id.
  await page.goto(`/patients/${patientId}/modules`);
  await expect(page).toHaveURL(new RegExp(`/patients/${patientId}/modules$`));
  await openPatientSection(page, 'quadro');
  const insightDisclosure = page.locator('#patient-insight');
  await insightDisclosure.locator(':scope > summary').click();
  await expect(insightDisclosure).toHaveAttribute('open', '');

  const disabledCard = page.getByTestId('patient-insight-disabled-card');
  await expect(disabledCard).toBeVisible();
  await expect(disabledCard).toContainText('Patient Insight disabilitata');
  await expect(disabledCard).toContainText('Apri Impostazioni AI');
  // Generation was renamed ("Aggiorna" / "Disabilitata"); the legacy "Genera Insight"
  // action no longer exists.
  await expect(page.getByRole('button', { name: 'Genera Insight' })).toHaveCount(0);
});
