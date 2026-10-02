/* @Codex */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { bootstrapUnlockedSession, openAiModelsSettings } from './utils';
import {
  ensureAiRolloutReadinessArtifactDirectory,
  type RolloutReadinessArtifactLane,
} from '../lib/ai-rollout-readiness-storage.ts';

function requireRolloutDataDir() {
  const dataDir = process.env.MEDIFLOW_DATA_DIR;
  if (!dataDir) {
    throw new Error('MEDIFLOW_DATA_DIR is required for ai-rollout-guard E2E smoke');
  }

  return dataDir;
}

function resetRolloutArtifacts() {
  const dataDir = requireRolloutDataDir();
  fs.rmSync(path.join(dataDir, 'ai', 'rollout-readiness'), { recursive: true, force: true });
}

function writeArtifact(lane: RolloutReadinessArtifactLane, artifact: Record<string, unknown>, markdown: string) {
  const paths = ensureAiRolloutReadinessArtifactDirectory(lane);
  fs.writeFileSync(paths.jsonPath, JSON.stringify(artifact, null, 2), 'utf8');
  fs.writeFileSync(paths.markdownPath, markdown, 'utf8');
}

test.beforeEach(() => {
  resetRolloutArtifacts();

  writeArtifact('generative_challenger', {
    status: 'hold',
    currentState: 'hold',
    selectedModel: 'gemma4:e4b',
    blockers: [{ id: 'smart-import', message: 'therapyStateRecall 0.7 < 0.95' }],
    warnings: [],
    evidence: {
      benchmarkFresh: true,
      owner: 'operatore-e2e',
      reportGeneratedAt: '2026-04-03T09:05:00.000Z',
    },
  }, '# Generative Challenger\n\nStatus: `hold`');
});

test.afterEach(() => {
  resetRolloutArtifacts();
});

test('settings warns when selected AI model is still on hold in rollout readiness artifacts', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';

  await bootstrapUnlockedSession(page, pin);
  await page.evaluate(async () => {
    // Reset model selections so the clinical selector starts from a known
    // recommended state; other specs share this DB and may leave a custom model.
    for (const key of ['aiModel_clinical', 'aiModel_reasoning']) {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: '' }),
      });
    }
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'aiPatientInsightKillSwitch', value: 'disabled' }),
    });
  });
  // WUL-297: model selectors and the rollout guard live on the AI models sub-route.
  await openAiModelsSettings(page);
  await expect(page).toHaveURL(/\/settings\/ai\/modelli$/);

  const guardNotice = page.getByTestId('ai-rollout-guard-notice');
  await expect(guardNotice).toBeVisible();
  await expect(guardNotice).toContainText('Patient Insight');
  // A disabled local control stays explicit even if a model has readiness evidence.
  await expect(guardNotice).toContainText('Spenta nelle impostazioni');

  const clinicalSelector = page.getByTestId('ai-model-selector-clinical');
  const resetToRecommended = clinicalSelector.getByRole('button', { name: 'Torna ai consigliati' });
  if (await resetToRecommended.count()) {
    await resetToRecommended.click();
  }
  await clinicalSelector.getByRole('button', { name: 'Usa un modello personalizzato' }).click();
  await clinicalSelector.getByPlaceholder('es. llama3').fill('gemma4:e4b');

  await expect(guardNotice).toBeVisible();
  await expect(guardNotice).toContainText('gemma4:e4b');
  // The hold state remains explicit while a different model is selected.
  await expect(guardNotice).toContainText('In attesa di verifica');
  await expect(guardNotice).toContainText('Generative Challenger');
  await expect(guardNotice).toContainText('therapyStateRecall 0.7 < 0.95');
  await expect(guardNotice).toContainText('Patient Insight');
  await expect(guardNotice).toContainText('Spenta nelle impostazioni');
  await expect(page.getByTestId('ai-rollout-local-guard-patient_insight')).toBeVisible();
});

for (const route of ['modelli', 'funzioni'] as const) {
  test(`AI ${route}: controls wait for the stored configuration before allowing edits`, async ({ page }, testInfo) => {
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    let readStarted!: () => void;
    const pendingRead = new Promise<void>((resolve) => { readStarted = resolve; });
    await page.route('**/api/settings/aiInsightManualConfig', async (request) => {
      const response = await request.fetch();
      readStarted();
      await readGate;
      await request.fulfill({ response });
    });
    try {
      await page.goto(`/settings/ai/${route}`);
      await pendingRead;
      const controls = page.getByTestId('ai-settings-controls');
      const save = page.getByRole('button', { name: 'Salva Configurazione', exact: true });
      await expect(controls).toHaveAttribute('disabled', '');
      await expect(controls).toHaveAttribute('aria-busy', 'true');
      await expect(save).toBeDisabled();
      await expect(page.getByText('Caricamento delle impostazioni…', { exact: true })).toBeVisible();

      if (route === 'modelli') {
        await expect(page.getByTestId('ai-model-selector-clinical')
          .getByRole('button', { name: 'Usa un modello personalizzato' })).toBeDisabled();
        await expect(page.getByLabel('URL provider Ollama')).toBeDisabled();
      }

      releaseRead();
      await expect(controls).not.toHaveAttribute('disabled', '');
      await expect(controls).toHaveAttribute('aria-busy', 'false');
      await expect(save).toBeEnabled();
      await expect(page.getByText('Caricamento delle impostazioni…', { exact: true })).toBeHidden();

      if (route === 'modelli') {
        const selector = page.getByTestId('ai-model-selector-clinical');
        await selector.getByRole('button', { name: 'Usa un modello personalizzato' }).click();
        const input = selector.getByPlaceholder('es. llama3');
        await input.fill('gemma4:e4b');
        await expect(input).toHaveValue('gemma4:e4b');
        await save.click();
        await expect(page.getByText('Configurazione AI salvata', { exact: true })).toBeVisible();
        await expect(input).toHaveValue('gemma4:e4b');
        const storedModel = await page.evaluate(async () => {
          const response = await fetch('/api/settings/aiModel_clinical');
          if (!response.ok) throw new Error('Stored model could not be read');
          return (await response.json()).value;
        });
        expect(storedModel).toBe('gemma4:e4b');
      }

      const screenshot = testInfo.outputPath(`ai-${route}-ready.png`);
      await page.screenshot({ path: screenshot });
      await testInfo.attach('loaded settings controls', { path: screenshot, contentType: 'image/png' });
    } finally {
      releaseRead();
    }
  });
}

test('AI settings stay unavailable when the initial configuration cannot be read', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await page.route('**/api/settings/aiModelDefaultVersion', (request) => request.fulfill({
    status: 500, json: { error: 'Synthetic settings read failure' },
  }));
  await page.goto('/settings/ai/modelli');
  await expect(page.getByText(
    'Impossibile leggere le impostazioni. Ricarica questa pagina prima di modificarle.',
    { exact: true },
  )).toBeVisible();
  await expect(page.getByTestId('ai-settings-controls')).toHaveAttribute('disabled', '');
  await expect(page.getByRole('button', { name: 'Salva Configurazione', exact: true })).toBeDisabled();
  await expect(page.getByTestId('ai-model-selector-clinical')
    .getByRole('button', { name: 'Usa un modello personalizzato' })).toBeDisabled();
});
