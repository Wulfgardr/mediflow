/* @Codex */
import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

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

  // WUL-297: kill switches now live on the dedicated AI sub-route.
  await page.goto('/settings/ai/funzioni');
  await expect(page).toHaveURL(/\/settings\/ai\/funzioni$/);

  const killSwitch = page.getByRole('switch', { name: 'Patient Insight locale' });
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

  const disabledCard = page.getByTestId('patient-insight-disabled-card');
  await expect(disabledCard).toBeVisible();
  await expect(disabledCard).toContainText('Patient Insight disabilitata');
  await expect(disabledCard).toContainText('Apri Impostazioni AI');
  // Generation was renamed ("Aggiorna" / "Disabilitata"); the legacy "Genera Insight"
  // action no longer exists.
  await expect(page.getByRole('button', { name: 'Genera Insight' })).toHaveCount(0);
});
