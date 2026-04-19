/* @Codex */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { bootstrapUnlockedSession } from './utils';
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
      owner: 'leonardo',
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
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'aiPatientInsightKillSwitch', value: 'disabled' }),
    });
  });
  await page.getByRole('link', { name: 'Impostazioni' }).click();
  await expect(page).toHaveURL(/\/settings$/);

  const guardNotice = page.getByTestId('ai-rollout-guard-notice');
  await expect(guardNotice).toBeVisible();
  await expect(guardNotice).toContainText('Patient Insight');
  await expect(guardNotice).toContainText('disabled locally');

  const clinicalSelector = page.getByTestId('ai-model-selector-clinical');
  const resetToRecommended = clinicalSelector.getByRole('button', { name: 'Torna ai consigliati' });
  if (await resetToRecommended.count()) {
    await resetToRecommended.click();
  }
  await clinicalSelector.getByRole('button', { name: 'Usa un modello personalizzato' }).click();
  await clinicalSelector.getByPlaceholder('es. llama3').fill('gemma4:e4b');

  await expect(guardNotice).toBeVisible();
  await expect(guardNotice).toContainText('gemma4:e4b');
  await expect(guardNotice).toContainText('hold');
  await expect(guardNotice).toContainText('Generative Challenger');
  await expect(guardNotice).toContainText('therapyStateRecall 0.7 < 0.95');
  await expect(guardNotice).toContainText('Patient Insight');
  await expect(guardNotice).toContainText('disabled locally');
  await expect(page.getByTestId('ai-rollout-local-guard-patient_insight')).toBeVisible();
});
