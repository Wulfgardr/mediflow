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

  const providers = page.getByTestId('fabric-provider-section');
  await expect(providers).toBeVisible();
  for (const provider of ['ollama', 'athena_mlx', 'openai', 'anthropic']) {
    await expect(page.getByTestId(`fabric-provider-${provider}`)).toBeVisible();
  }
  await expect(providers).toContainText('Dichiarato');
  await expect(providers).toContainText('Effettivo');
  await expect(page.getByTestId('fabric-provider-ollama')).toContainText('Ollama');
  await expect(page.getByTestId('fabric-provider-athena_mlx')).toContainText('ATHENA');
  await expect(page.getByTestId('fabric-provider-openai')).toContainText('Esecuzione disabilitata');
  await expect(page.getByTestId('fabric-provider-anthropic')).toContainText('Un abbonamento consumer non equivale all’accesso API.');
  await expect(providers).toContainText('Non osservata: serve una receipt dell’operazione corrente.');
  await expect(providers).not.toContainText(/actorRef|receiptRef|hostTimestamp|endpoint|token|segreto|\bOCR\b/i);
  await expect(providers.locator('form, input, select, textarea, button, a, [role="switch"], [contenteditable="true"]')).toHaveCount(0);

  for (const venue of ['local_process', 'home_base', 'on_device', 'cloud']) {
    await expect(page.getByTestId(`fabric-venue-${venue}`)).toBeVisible();
  }
  await expect(surface).toContainText('Questo Mac');
  await expect(surface).toContainText('Postazione principale');
  await expect(surface).toContainText('Sul dispositivo');
  await expect(surface).toContainText('Fuori dalla postazione');
  await expect(surface).toContainText('la richiesta viene rifiutata');

  await expect(page.getByTestId('fabric-capability-patient_insight')).toBeVisible();
  await expect(page.getByTestId('fabric-capability-icd_lookup')).toBeVisible();
  await expect(page.getByTestId('fabric-group-generative')).toBeVisible();
  await expect(page.getByTestId('fabric-group-deterministic')).toBeVisible();
  await expect(page.getByTestId('fabric-egress-section')).toContainText('Uscita esterna chiusa');

  for (const capability of ['patient_insight', 'smart_import', 'document_synthesis', 'treatment_reasoning']) {
    await expect(page.getByTestId(`fabric-availability-${capability}`)).toContainText('Solo proposta');
  }
  await expect(page.getByTestId('fabric-availability-icd_lookup')).toContainText('Disponibile nell’app');
  await expect(page.getByTestId('fabric-availability-ocr')).toContainText('Non disponibile');
  await expect(page.getByTestId('fabric-capability-ocr')).toContainText('Nessuna sede: funzione non eseguibile');
  await expect(page.getByTestId('fabric-capability-ocr')).toContainText('Stato terminale: nessun interruttore può riattivarla');

  const registry = page.getByTestId('fabric-capability-registry');
  await expect(registry).not.toContainText('consumer_login');
  await expect(registry).not.toContainText('API key');
  await expect(registry).not.toContainText('OAuth');

  await expect(surface.locator('form')).toHaveCount(0);
  await expect(surface.locator('input, select, textarea, button, [role="switch"], [contenteditable="true"]')).toHaveCount(0);

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
});

test('Models settings scopes Ollama roles and keeps ATHENA on its separate lane', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await page.goto('/settings/ai/modelli');

  const surface = page.getByTestId('settings-ai-models-section');
  await expect(surface).toBeVisible();
  await expect(surface).toContainText('Ollama per i ruoli generali');
  await expect(surface).toContainText('Treatment Reasoning usa la lane locale ATHENA separata');
  await expect(surface).not.toContainText('Ollama è l’unico provider supportato');
  await expect(surface).not.toContainText('Ollama è l\'unico provider supportato');
});
