/* @Claude */
import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession, openAiFunzioniSettings, setAiLaneKillSwitch } from './utils';

// This DB is shared across specs; leaving Treatment Reasoning disabled would break
// specs that expect it enabled. Restore the switch after the test.
test.afterEach(async ({ page }) => {
  await page.evaluate(async () => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'aiTreatmentReasoningKillSwitch', value: 'enabled' }),
    }).catch(() => undefined);
  });
});

test('treatment reasoning kill switch blocks new drafts on the Scheda', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';

  await bootstrapUnlockedSession(page, pin);

  // The lane is fail-closed when the setting row is absent (fresh e2e DB): pin it to
  // 'enabled' so the toggle below always starts from the ON state.
  await setAiLaneKillSwitch(page, 'aiTreatmentReasoningKillSwitch', 'enabled');

  await openAiFunzioniSettings(page);

  const killSwitch = page.getByRole('switch', { name: 'Treatment Reasoning locale' });
  await expect(killSwitch).toHaveAttribute('aria-checked', 'true');
  await killSwitch.click();
  await expect(killSwitch).toHaveAttribute('aria-checked', 'false');
  const saveButton = page.getByRole('button', { name: 'Salva Configurazione' });
  await saveButton.click();
  await expect(page.getByRole('button', { name: 'Salvataggio...' })).toHaveCount(0);
  await expect(saveButton).toBeEnabled();

  const patientId = await page.evaluate(async () => {
    const response = await fetch('/api/patients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Reasoning',
        lastName: 'KillSwitch',
        taxCode: `TRKILL${Date.now()}`,
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

  // The panel renders only when the patient has at least one reasoning source:
  // seed one active therapy so the disabled state stays observable.
  await page.evaluate(async (id: string) => {
    const response = await fetch('/api/therapies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patientId: id,
        drugName: 'Ramipril Test',
        activePrinciple: 'Ramipril',
        dosage: '5 mg 1 cp/die',
        status: 'active',
        startDate: new Date('2026-06-01T08:00:00Z').toISOString(),
      }),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }
  }, patientId);

  // The reasoning panel mounts on the primary Scheda route (/modules), inside the
  // "Terapie farmacologiche" collapsible section, which starts collapsed: expand it
  // first so visibility assertions observe the panel and not the keepMounted DOM.
  await page.goto(`/patients/${patientId}/modules`);
  await expect(page).toHaveURL(new RegExp(`/patients/${patientId}/modules$`));
  await page.getByRole('button', { name: /Terapie farmacologiche/ }).click();

  const panel = page.getByTestId('treatment-reasoning-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Treatment Reasoning disabilitato');
  await expect(panel).toContainText('Apri Impostazioni AI');
  await expect(panel.getByRole('button', { name: 'Genera bozza' })).toBeDisabled();
});
