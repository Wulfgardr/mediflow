import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';

import type { FunctionModelPreferences } from '../lib/function-models/browser';
import {
  parsePatientInsightPreviewRequest,
  type PatientInsightPreviewRequest,
} from '../lib/ai-providers/fabric/patient-insight-preview-contract';
import { bootstrapUnlockedSession, openPatientSection, setAiLaneKillSwitch, assertNoHorizontalOverflow, assertNotClippedInViewport } from './utils';

const MODEL = 'synthetic-patient-insight:latest';
const REVIEW_REF = `review_${'b'.repeat(32)}`;
const MODEL_OPTION_ID = `model_option_${'a'.repeat(32)}`;
const PATIENT_INSIGHT_CATALOG = {
  schemaVersion: 'mediflow.function-preferences.v1',
  revision: `sha256_${'c'.repeat(64)}`,
  catalogRevision: `sha256_${'d'.repeat(64)}`,
  check: 'configuration_only',
  apply: 'denied',
  presets: ['host_defaults', 'all_off'],
  functions: (['patient_insight', 'smart_import', 'document_synthesis', 'treatment_reasoning'] as const).map(id => ({
    id,
    enabled: id === 'patient_insight',
    defaultModelOptionId: MODEL_OPTION_ID,
    defaultSource: 'host_configuration',
    bindingState: 'current',
    options: [{ modelOptionId: MODEL_OPTION_ID, label: MODEL, provider: 'ollama', state: 'available_unqualified' }],
  })),
} satisfies FunctionModelPreferences;

async function createSyntheticPatient(page: Page): Promise<string> {
  return await page.evaluate(async (taxCode: string) => {
    const response = await fetch('/api/patients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Fabric',
        lastName: 'Review',
        taxCode,
        birthDate: '1980-01-01T00:00:00.000Z',
        address: 'Via Sintetica 1',
        phone: '0000000000',
      }),
    });
    const payload = await response.json() as { id?: string; error?: string };
    if (!response.ok || !payload.id) {
      throw new Error(payload.error || `Patient creation failed with HTTP ${response.status}`);
    }
    return payload.id;
  }, `PIFABRIC${Date.now()}`);
}

function availablePreview(request: PatientInsightPreviewRequest) {
  return {
    preview: {
      writesPerformed: 0,
      apply: 'denied',
      status: 'available',
      code: null,
      proposal: {
        schemaVersion: 'mediflow.patient-insight.review-proposal.v2',
        reviewOnly: true,
        summary: 'Sintesi Patient Insight sintetica da revisionare. [S1]',
        currentState: ['Quadro sintetico stabile da verificare. [S1]'],
        alerts: ['Attenzione sintetica da confermare. [S1]'],
        nextSteps: ['Rivedere la fonte sintetica durante il follow-up. [S1]'],
        gaps: ['Dato sintetico ancora da integrare.'],
        generatedAt: request.capturedAt,
        currentness: {
          selectionEpoch: 7,
          patientRevision: request.patientRevision,
          projectionDigest: `sha256_${'a'.repeat(64)}`,
          capturedAt: request.capturedAt,
          verifiedAt: request.capturedAt,
        },
      },
      receipt: {
        schemaVersion: 'mediflow.ai.fabric-resolution.v1',
        capability: 'patient_insight',
        venue: 'local_process',
        provider: 'ollama',
        model: MODEL,
        egress: 'none',
      },
      provenance: {
        schemaVersion: 'mediflow.ai.fabric-provenance.v1',
        capability: 'patient_insight',
        venue: 'local_process',
        provider: 'ollama',
        model: MODEL,
        preprocessing: ['context_minimization', 'envelope_validation'],
      },
      reviewRef: REVIEW_REF,
    },
  };
}

test.describe.configure({ retries: 0 });

test('Patient Insight UI invia un payload strict e mostra una proposta review-only', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';
  let previewCalls = 0;
  let capturedRequest: PatientInsightPreviewRequest | null = null;
  let generationStarted = false;
  const postGestureMutations: string[] = [];

  page.on('request', (request) => {
    if (!generationStarted || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) return;
    const pathname = new URL(request.url()).pathname;
    postGestureMutations.push(`${request.method()} ${pathname}`);
  });

  await bootstrapUnlockedSession(page, pin);
  await setAiLaneKillSwitch(page, 'aiPatientInsightKillSwitch', 'enabled');
  const patientId = await createSyntheticPatient(page);

  await page.route('**/api/ai/patient-insight/preview', async (route) => {
    previewCalls += 1;
    capturedRequest = parsePatientInsightPreviewRequest(route.request().postDataJSON());
    if (!capturedRequest) throw new Error('La UI Patient Insight ha inviato un payload preview non conforme.');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(availablePreview(capturedRequest)),
    });
  });
  await page.route('**/api/settings/ai/functions', async (route) => {
    expect(route.request().method()).toBe('GET');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PATIENT_INSIGHT_CATALOG) });
  });

  await page.goto(`/patients/${patientId}/modules#quadro`);
  await expect(page).toHaveURL(new RegExp(`/patients/${patientId}/modules#quadro$`));
  await openPatientSection(page, 'quadro');
  await expect(page.locator('#quadro #patient-insight')).toHaveCount(0);
  await expect(page.getByTestId('patient-proposals-summary')).toContainText('Nessuna proposta da rivedere');
  await openPatientSection(page, 'attenzione');
  const insightDisclosure = page.locator('#patient-insight');
  await expect(insightDisclosure.locator(':scope > div > [data-disclosure-control]')).toHaveAttribute('aria-expanded', 'false');
  expect(previewCalls).toBe(0);
  await insightDisclosure.locator(':scope > div > [data-disclosure-control]').click();
  await expect(insightDisclosure.locator(':scope > div > [data-disclosure-control]')).toHaveAttribute('aria-expanded', 'true');
  // this spec already owns a synthetic preview transport; make its local
  // catalog prerequisite explicit without claiming a real provider invocation.
  await page.getByTestId('model-picker-patient_insight').getByRole('button', { name: 'Cambia', exact: true }).click();
  const modelPicker = page.getByRole('combobox', { name: 'Modello per questa proposta' });
  await expect(modelPicker).toBeEnabled();
  // the picker reads its catalog on first focus, matching ordinary UI use.
  await modelPicker.focus();
  await expect(modelPicker.locator('option')).toHaveText([
    `Predefinito · ${MODEL}`,
    'OpenAI · abbonamento ChatGPT · prepara',
    `${MODEL} · Ollama · locale`,
  ]);
  await modelPicker.selectOption(MODEL_OPTION_ID);
  await expect(modelPicker).toHaveValue(MODEL_OPTION_ID);
  generationStarted = true;
  await page.getByRole('button', { name: 'Avvia supporto' }).click();

  const proposal = page.getByTestId('patient-insight-review-proposal');
  await expect(proposal).toBeVisible();
  await expect(proposal).toContainText('Proposta · da rivedere');
  await expect(proposal.locator('[data-ink="pencil"]')).toBeVisible();
  await expect(proposal).toContainText('Fonti della proposta');
  await expect(proposal).toContainText('0 scritture');
  await expect(proposal).toContainText('Applicazione non consentita');
  await expect(proposal).toContainText('Sintesi Patient Insight sintetica da revisionare. [S1]');
  await expect(proposal).toContainText('Receipt, provenance e currentness');
  await expect(proposal).toContainText(`ollama · ${MODEL} · local_process · egress none`);
  await expect(proposal).toContainText('context_minimization → envelope_validation');
  await expect(proposal).toContainText('epoch 7 · revisione 1');

  expect(previewCalls).toBe(1);
  expect(capturedRequest).not.toBeNull();
  expect(Object.keys(capturedRequest!)).toEqual([
    'schemaVersion', 'requestId', 'patientId', 'ambulatoryId', 'patientRevision', 'capturedAt', 'sources',
  ]);
  expect(capturedRequest).toMatchObject({
    schemaVersion: 'mediflow.patient-insight.preview-request.v1',
    patientId,
    patientRevision: 1,
    sources: {
      focus: { summary: 'Valutazione manuale del follow-up clinico attuale' },
      conditions: [],
      activeTherapies: [],
      recentEvents: [],
    },
  });
  expect(capturedRequest!.requestId).toMatch(/^pi_[0-9a-f-]{36}$/u);
  expect(capturedRequest!.ambulatoryId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
  expect(new Date(capturedRequest!.capturedAt).toISOString()).toBe(capturedRequest!.capturedAt);
  expect(Object.keys(capturedRequest!.sources)).toEqual([
    'focus', 'conditions', 'activeTherapies', 'recentEvents',
  ]);
  expect(Object.keys(capturedRequest!.sources.focus)).toEqual(['summary']);
  expect(JSON.stringify(capturedRequest)).not.toMatch(
    /"(?:provider|model|endpoint|venue|prompt|fallback|egress|apply)"\s*:/u,
  );
  expect(postGestureMutations).toEqual(['POST /api/ai/patient-insight/preview']);
  await openPatientSection(page, 'quadro');
  await expect(page.getByTestId('patient-proposals-summary')).toContainText('1 proposta da rivedere');
  await expect(proposal).not.toBeVisible();
  await expect(page.locator('#quadro [data-testid="patient-insight-review-proposal"]')).toHaveCount(0);
  await page.getByTestId('patient-proposals-summary').getByRole('link', { name: 'Patient Insight', exact: true }).click();
  await expect(proposal).toBeVisible();
  expect(previewCalls).toBe(1);
  await insightDisclosure.getByRole('button', { name: 'Riusa predefinito', exact: true }).click();
  await expect(proposal).toHaveCount(0);
  await openPatientSection(page, 'quadro');
  await expect(page.getByTestId('patient-proposals-summary')).toContainText('Nessuna proposta da rivedere');
  expect(previewCalls).toBe(1);
});

for (const theme of ['giorno', 'grafite']) for (const size of ['1440', '768', '390', '320', 'zoom-200', 'zoom-400']) {
  test(`Patient Insight composizione ${theme} ${size}`, async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    const baseline = process.env.PATIENT_INSIGHT_BASELINE === '1';
    const zoom = size.startsWith('zoom-') ? await openBrowserZoomFixture(baseURL!) : undefined;
    const release = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
    let fail = false;
    try {
      if (zoom) page = zoom.page;
      await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
      await setAiLaneKillSwitch(page, 'aiPatientInsightKillSwitch', 'enabled');
      const patientId = await createSyntheticPatient(page);
      await page.route('**/api/settings/ai/functions', route => route.fulfill({ status: 200, json: PATIENT_INSIGHT_CATALOG }));
      await page.route('**/api/ai/patient-insight/preview', async route => {
        const request = parsePatientInsightPreviewRequest(route.request().postDataJSON());
        if (!request) throw new Error('Invalid synthetic preview request');
        entered.resolve(); await release.promise;
        return fail ? route.fulfill({ status: 503, json: { error: 'synthetic-provider-unavailable' } })
          : route.fulfill({ status: 200, json: availablePreview(request) });
      });
      await page.goto(`/patients/${patientId}/modules`);
      await openPatientSection(page, baseline ? 'quadro' : 'attenzione');
      const panel = page.locator('#patient-insight');
      await panel.locator(':scope > div > [data-disclosure-control]').click();
      await panel.getByRole('button', { name: 'Cambia', exact: true }).click();
      const model = panel.getByRole('combobox', { name: 'Modello per questa proposta', exact: true });
      await model.focus(); await model.selectOption(MODEL_OPTION_ID);
      await page.setViewportSize({ width: zoom ? 1440 : Number(size), height: 1000 });
      await page.evaluate(theme => {
        document.documentElement.classList.toggle('dark', theme === 'grafite');
        document.documentElement.classList.toggle('light', theme === 'giorno');
      }, theme);
      if (zoom) await zoom.setZoom(size === 'zoom-200' ? 2 : 4);
      const directory = process.env.PATIENT_INSIGHT_CAPTURES;
      if (directory) await mkdir(directory, { recursive: true });
      const capture = async (state: string) => {
        await panel.scrollIntoViewIfNeeded();
        if (!baseline) await assertNoHorizontalOverflow(page, [{ label: 'Patient Insight', selector: '#patient-insight' }, { label: 'pagina', selector: 'document' }]);
        if (directory) await page.screenshot({ path: `${directory}/${theme}-${size}-${state}.png`, animations: 'disabled' });
      };
      await capture('pronta');
      await panel.getByRole('button', { name: 'Avvia supporto', exact: true }).click();
      await entered.promise;
      await capture('in-corso');
      release.resolve();
      await expect(panel.getByTestId('patient-insight-review-proposal')).toBeVisible();
      await capture('proposta');
      const source = panel.getByRole('link', { name: 'Quadro clinico', exact: true });
      await source.scrollIntoViewIfNeeded(); await source.focus();
      if (!baseline) await assertNotClippedInViewport(source, 'Fonte Quadro clinico');
      if (directory) await page.screenshot({ path: `${directory}/${theme}-${size}-fonti.png`, animations: 'disabled' });
      fail = true;
      await panel.getByRole('button', { name: 'Riusa predefinito', exact: true }).click();
      await panel.getByRole('button', { name: 'Avvia supporto', exact: true }).click();
      await expect(panel.getByRole('alert')).toContainText('Patient Insight non è disponibile');
      await capture('errore');
      await setAiLaneKillSwitch(page, 'aiPatientInsightKillSwitch', 'disabled');
      await page.reload(); await openPatientSection(page, baseline ? 'quadro' : 'attenzione');
      await panel.locator(':scope > div > [data-disclosure-control]').click();
      await expect(panel.getByTestId('patient-insight-disabled-card')).toBeVisible();
      await capture('spenta');
      await test.info().attach('surface', { body: JSON.stringify({ theme, size, baseline,
        revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        zoom: zoom ? { mechanism: 'chrome.tabs.setZoom/getZoom', factor: size === 'zoom-200' ? 2 : 4,
          physicalWidth: 1440, innerWidth: await page.evaluate(() => innerWidth) } : null }), contentType: 'application/json' });
    } finally { release.resolve(); await zoom?.close(); }
  });
}
