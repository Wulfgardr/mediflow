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
    throw new Error('MEDIFLOW_DATA_DIR is required for ai-rollout-readiness E2E smoke');
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

  writeArtifact('patient_insight', {
    status: 'shadow-ready',
    currentState: 'hold',
    selectedModel: 'qwen3.5:35b-a3b',
    blockers: [],
    warnings: [{ id: 'shadow-window', message: 'Shadow window active for review.' }],
    evidence: {
      benchmarkFresh: true,
      owner: 'leonardo',
      reportGeneratedAt: '2026-04-03T09:00:00.000Z',
    },
  }, '# Patient Insight\n\nStatus: `shadow-ready`');

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

test('settings shows rollout readiness lanes, missing artifacts and markdown preview', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';

  await bootstrapUnlockedSession(page, pin);

  await page.getByRole('link', { name: 'Impostazioni' }).click();
  await expect(page).toHaveURL(/\/settings$/);

  const panel = page.getByTestId('ai-rollout-readiness-panel');
  await expect(panel.getByRole('heading', { name: 'AI rollout readiness' })).toBeVisible();

  await expect(page.getByTestId('ai-rollout-metric-ready')).toContainText('1');
  await expect(page.getByTestId('ai-rollout-metric-hold')).toContainText('1');
  await expect(page.getByTestId('ai-rollout-metric-missing')).toContainText('3');

  const missingRedactionLane = page.getByTestId('ai-rollout-lane-redaction');
  await expect(missingRedactionLane).toContainText('Redaction');
  await expect(page.getByTestId('ai-rollout-missing-redaction')).toContainText('Artifact locale mancante');

  const patientInsightLane = page.getByTestId('ai-rollout-lane-patient_insight');
  await expect(patientInsightLane).toContainText('qwen3.5:35b-a3b');

  const markdownPreview = page.getByTestId('ai-rollout-markdown-patient_insight');
  await markdownPreview.locator('summary').click();
  await expect(markdownPreview).toContainText('Status: `shadow-ready`');
});
