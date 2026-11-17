import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession, openAiFunzioniSettings, openPatientSection, setAiLaneKillSwitch } from './utils';

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

  await setAiLaneKillSwitch(page, 'aiPatientInsightKillSwitch', 'enabled');

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
  await expect(page.getByTestId('function-preferences').getByRole('status').filter({
    hasText: /^Impostazioni salvate e rilette\. Nessuna modifica clinica\.$/u,
  })).toBeVisible();

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

  await page.goto(`/patients/${patientId}/modules`);
  await expect(page).toHaveURL(new RegExp(`/patients/${patientId}/modules$`));
  await openPatientSection(page, 'attenzione');
  const insightDisclosure = page.locator('#patient-insight');
  await insightDisclosure.locator(':scope > div > [data-disclosure-control]').click();
  await expect(insightDisclosure.locator(':scope > div > [data-disclosure-control]')).toHaveAttribute('aria-expanded', 'true');

  const disabledCard = page.getByTestId('patient-insight-disabled-card');
  await expect(disabledCard).toBeVisible();
  await expect(disabledCard).toContainText('Quadro paziente disabilitato');
  await expect(disabledCard).toContainText('Apri Impostazioni IA');
  await expect(page.getByRole('button', { name: 'Genera proposta' })).toHaveCount(0);
});
