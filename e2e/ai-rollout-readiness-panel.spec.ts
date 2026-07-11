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

  await page.evaluate(async () => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'aiPatientInsightKillSwitch', value: 'disabled' }),
    });
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'aiSmartImportKillSwitch', value: 'enabled' }),
    });
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'aiDocumentSynthesisKillSwitch', value: 'disabled' }),
    });
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'aiTreatmentReasoningKillSwitch', value: 'enabled' }),
    });
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'aiOcrKillSwitch', value: 'disabled' }),
    });
  });

  // WUL-297: governance/readiness now lives on the AI functions sub-route.
  await page.goto('/settings/ai/funzioni');
  await expect(page).toHaveURL(/\/settings\/ai\/funzioni$/);

  const panel = page.getByTestId('ai-rollout-readiness-panel');
  // WUL-297: the panel heading is now Italian ("Stato rilascio AI locale").
  await expect(panel.getByRole('heading', { name: 'Stato rilascio AI locale' })).toBeVisible();

  await expect(page.getByTestId('ai-rollout-metric-ready')).toContainText('1');
  await expect(page.getByTestId('ai-rollout-metric-hold')).toContainText('1');
  await expect(page.getByTestId('ai-rollout-metric-missing')).toContainText('3');
  await expect(page.getByTestId('ai-rollout-local-control-summary')).toContainText('3 disattivati su 5');
  await expect(page.getByTestId('ai-rollout-local-control-patient_insight')).toContainText('disabled');
  await expect(page.getByTestId('ai-rollout-local-control-smart_import')).toContainText('enabled');
  await expect(page.getByTestId('ai-rollout-local-control-document_synthesis')).toContainText('disabled');
  await expect(page.getByTestId('ai-rollout-local-control-treatment_reasoning')).toContainText('enabled');
  await expect(page.getByTestId('ai-rollout-local-control-ocr')).toContainText('disabled');

  const missingRedactionLane = page.getByTestId('ai-rollout-lane-redaction');
  await expect(missingRedactionLane).toContainText('Redaction');
  // WUL-297: the missing-artifact copy is now "Report locale mancante".
  await expect(page.getByTestId('ai-rollout-missing-redaction')).toContainText('Report locale mancante');

  const patientInsightLane = page.getByTestId('ai-rollout-lane-patient_insight');
  await expect(patientInsightLane).toContainText('qwen3.5:35b-a3b');
  await expect(patientInsightLane).toContainText('Local control');
  await expect(patientInsightLane).toContainText('disabled');

  const markdownPreview = page.getByTestId('ai-rollout-markdown-patient_insight');
  await markdownPreview.locator('summary').click();
  await expect(markdownPreview).toContainText('Status: `shadow-ready`');
});
