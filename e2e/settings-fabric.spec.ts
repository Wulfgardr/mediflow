/* @Codex */
import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

test('Fabric settings renders the read-only venue and capability registry', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await page.goto('/settings/ai/fabric');
  await expect(page).toHaveURL(/\/settings\/ai\/fabric$/);

  const surface = page.getByTestId('settings-ai-fabric-section');
  await expect(surface).toBeVisible();
  await expect(page.getByTestId('fabric-loading-state')).toHaveCount(0);
  await expect(page.getByTestId('fabric-error-state')).toHaveCount(0);

  for (const venue of ['local_process', 'home_base', 'on_device', 'cloud']) {
    await expect(page.getByTestId(`fabric-venue-${venue}`)).toBeVisible();
  }
  await expect(surface).toContainText('Questo Mac');
  await expect(surface).toContainText('Postazione principale');
  await expect(surface).toContainText('Sul dispositivo');
  await expect(surface).toContainText('Fuori dalla postazione');
  await expect(surface).toContainText('la richiesta viene rifiutata');

  const providerDisclosure = page.getByTestId('fabric-provider-disclosure');
  await expect(providerDisclosure).toBeVisible();
  for (const provider of ['ollama', 'athena', 'apple_vision_ocr', 'openai', 'anthropic']) {
    await expect(page.getByTestId(`fabric-provider-${provider}`)).toBeVisible();
  }
  await expect(providerDisclosure).toContainText('Il modello è configurato per capacità e non è esposto qui.');
  await expect(providerDisclosure).toContainText('ATHENA-R1-Qwen3-8B');
  await expect(providerDisclosure).toContainText('Non è una capacità Fabric on-device');
  await expect(providerDisclosure).toContainText('Accesso non configurabile. Egress chiuso.');
  await expect(providerDisclosure).toContainText('Disponibilità non qualificata');

  await expect(page.getByTestId('fabric-capability-patient_insight')).toBeVisible();
  await expect(page.getByTestId('fabric-capability-icd_lookup')).toBeVisible();
  await expect(page.getByTestId('fabric-group-generative')).toBeVisible();
  await expect(page.getByTestId('fabric-group-deterministic')).toBeVisible();
  await expect(page.getByTestId('fabric-egress-section')).toContainText('Uscita esterna chiusa');

  await expect(surface.locator('form')).toHaveCount(0);
  await expect(surface.locator('input, select, textarea, button, [role="switch"], [contenteditable="true"]')).toHaveCount(0);
  await expect(providerDisclosure.locator('a, [role="link"]')).toHaveCount(0);

  await page.screenshot({
    path: '/tmp/mediflow-settings-fabric.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByTestId('fabric-egress-section').screenshot({
    path: '/tmp/mediflow-settings-fabric-egress.png',
    animations: 'disabled',
  });
  await page.getByTestId('fabric-capability-registry').screenshot({
    path: '/tmp/mediflow-settings-fabric-registry.png',
    animations: 'disabled',
  });
  await providerDisclosure.screenshot({
    path: '/tmp/mediflow-settings-fabric-providers.png',
    animations: 'disabled',
  });
});
