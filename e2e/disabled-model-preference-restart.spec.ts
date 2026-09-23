/* @Codex: two real-browser phases run against one synthetic DB, with a server restart between them. */
import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { bootstrapUnlockedSession, openAiFunzioniSettings } from './utils';

type FunctionRow = { id: string; enabled: boolean; defaultModelOptionId: string | null; defaultSource: string;
  bindingState: string; options: { modelOptionId: string; label: string; state: string }[] };
type Snapshot = { revision: string; catalogRevision: string; functions: FunctionRow[] };
const receiptPath = process.env.E2E_PREFERENCE_RECEIPT;
const phase = process.env.E2E_PREFERENCE_PHASE;

async function readPreferences(page: import('@playwright/test').Page): Promise<Snapshot> {
  return page.evaluate(async () => {
    const response = await fetch('/api/settings/ai/functions', {
      headers: { 'x-mediflow-function-preferences': '2' }, cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Preference read failed: HTTP ${response.status}`);
    return await response.json() as Snapshot;
  });
}

test('explicit local default is saved with Patient Insight off', async ({ page }) => {
  test.skip(phase !== 'save' || !receiptPath, 'Run with an isolated DB and an explicit receipt path.');
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await openAiFunzioniSettings(page);
  const before = await readPreferences(page);
  const row = before.functions.find(item => item.id === 'patient_insight');
  expect(row).toBeDefined();
  expect(row!.enabled).toBe(false);
  expect(row!.defaultSource).toBe('host_configuration');
  const option = row!.options.find(item => item.modelOptionId === row!.defaultModelOptionId);
  expect(option, 'The host catalog must expose its synthetic default.').toBeDefined();
  const card = page.getByRole('switch', { name: 'Quadro paziente nella proposta' }).locator('xpath=ancestor::article');
  await card.getByRole('combobox', { name: 'Modello predefinito · Quadro paziente' }).selectOption(option!.modelOptionId);
  const previewRequest = page.waitForRequest(request => request.url().endsWith('/api/settings/ai/functions/preview') && request.method() === 'POST');
  const previewResponse = page.waitForResponse(response => response.url().endsWith('/api/settings/ai/functions/preview') && response.request().method() === 'POST');
  await card.getByRole('button', { name: 'Anteprima modifica' }).click();
  const command = (await previewRequest).postDataJSON() as Record<string, unknown>;
  expect(command).toMatchObject({ action: 'set', functionId: 'patient_insight', enabled: false,
    defaultModelOptionId: option!.modelOptionId });
  const response = await previewResponse;
  expect(response.status()).toBe(200);
  const preview = await response.json() as { writesPerformed: number; proposed: Snapshot };
  expect(preview.writesPerformed).toBe(0);
  expect(preview.proposed.functions.find(item => item.id === 'patient_insight')).toMatchObject({
    enabled: false, defaultSource: 'saved_preference', defaultModelOptionId: option!.modelOptionId,
  });
  const region = page.getByRole('region', { name: 'Anteprima impostazioni' });
  await expect(region).toBeVisible();
  await region.getByRole('button', { name: 'Applica alle impostazioni' }).click();
  await expect(page.getByTestId('function-preferences').getByRole('status').filter({ hasText: 'Impostazioni salvate e rilette' })).toBeVisible();
  const saved = await readPreferences(page);
  expect(saved.revision).not.toBe(before.revision);
  expect(saved.functions.find(item => item.id === 'patient_insight')).toMatchObject({
    enabled: false, defaultSource: 'saved_preference', defaultModelOptionId: option!.modelOptionId,
  });
  writeFileSync(receiptPath!, JSON.stringify({ before, command, preview, saved }, null, 2));
});

test('saved disabled default survives a real server restart and new browser', async ({ page }) => {
  test.skip(phase !== 'restart' || !receiptPath, 'Run after the save phase and a real server restart.');
  const earlier = JSON.parse(readFileSync(receiptPath!, 'utf8')) as { saved: Snapshot };
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await openAiFunzioniSettings(page);
  const observed = await readPreferences(page);
  expect(observed.revision).toBe(earlier.saved.revision);
  expect(observed.catalogRevision).toBe(earlier.saved.catalogRevision);
  const row = observed.functions.find(item => item.id === 'patient_insight');
  expect(row).toMatchObject(earlier.saved.functions.find(item => item.id === 'patient_insight')!);
  const card = page.getByRole('switch', { name: 'Quadro paziente nella proposta' }).locator('xpath=ancestor::article');
  await expect(card.getByRole('combobox', { name: 'Modello predefinito · Quadro paziente' })).toHaveValue(row!.defaultModelOptionId!);
  await expect(card.getByRole('switch', { name: 'Quadro paziente nella proposta' })).toHaveAttribute('aria-checked', 'false');
  writeFileSync(receiptPath!.replace(/\.json$/u, '-restart.json'), JSON.stringify({ observed }, null, 2));
});
