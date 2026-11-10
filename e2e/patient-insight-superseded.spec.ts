import { expect, test, type Page } from '@playwright/test';

import type { FunctionModelPreferences } from '../lib/function-models/browser';
import { parsePatientInsightPreviewRequest, type PatientInsightPreviewRequest } from '../lib/ai-providers/fabric/patient-insight-preview-contract';
import { bootstrapUnlockedSession, openPatientSection, setAiLaneKillSwitch } from './utils';

// Synthetic data only. The preview transport is the only fixture; diary and
// therapy writes go through the real routes from the same patient page.
const MODEL = 'synthetic-patient-insight:latest';
const MODEL_OPTION_ID = `model_option_${'a'.repeat(32)}`;
const ENTRY_TITLE = 'Controllo sintetico superata';
const DRUG = 'Farmaco sintetico superata';
const CATALOG = {
  schemaVersion: 'mediflow.function-preferences.v1',
  revision: `sha256_${'c'.repeat(64)}`,
  catalogRevision: `sha256_${'d'.repeat(64)}`,
  check: 'configuration_only',
  apply: 'denied',
  presets: ['host_defaults', 'all_off'],
  functions: (['patient_insight', 'smart_import', 'document_synthesis', 'treatment_reasoning'] as const).map(id => ({
    id, enabled: id === 'patient_insight', defaultModelOptionId: MODEL_OPTION_ID, defaultSource: 'host_configuration', bindingState: 'current',
    options: [{ modelOptionId: MODEL_OPTION_ID, label: MODEL, provider: 'ollama', state: 'available_unqualified' }],
  })),
} satisfies FunctionModelPreferences;

function availablePreview(request: PatientInsightPreviewRequest) {
  return { preview: {
    writesPerformed: 0, apply: 'denied', status: 'available', code: null,
    proposal: {
      schemaVersion: 'mediflow.patient-insight.review-proposal.v2', reviewOnly: true,
      summary: 'Sintesi sintetica da revisionare. [S1]', currentState: ['Quadro sintetico. [S1]'], alerts: [], nextSteps: [], gaps: [],
      generatedAt: request.capturedAt,
      currentness: { selectionEpoch: 3, patientRevision: request.patientRevision, projectionDigest: `sha256_${'a'.repeat(64)}`, capturedAt: request.capturedAt, verifiedAt: request.capturedAt },
    },
    receipt: { schemaVersion: 'mediflow.ai.fabric-resolution.v1', capability: 'patient_insight', venue: 'local_process', provider: 'ollama', model: MODEL, egress: 'none' },
    provenance: { schemaVersion: 'mediflow.ai.fabric-provenance.v1', capability: 'patient_insight', venue: 'local_process', provider: 'ollama', model: MODEL, preprocessing: ['context_minimization', 'envelope_validation'] },
    reviewRef: `review_${'b'.repeat(32)}`,
  } };
}

async function generatedProposal(page: Page) {
  const requests: PatientInsightPreviewRequest[] = [];
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await setAiLaneKillSwitch(page, 'aiPatientInsightKillSwitch', 'enabled');
  const patientId = await page.evaluate(async ({ title, drug }) => {
    const post = async (path: string, body: unknown) => {
      const response = await fetch(`/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(`Synthetic ${path}: ${response.status}`);
      return response.json() as Promise<{ id: string }>;
    };
    const patient = await post('patients', { firstName: 'Superata', lastName: 'Sintetica', taxCode: `PISUP${crypto.randomUUID().replaceAll('-', '').slice(0, 11).toUpperCase()}`, birthDate: '1975-03-02T00:00:00.000Z' });
    await post('entries', { patientId: patient.id, type: 'visit', date: '2026-10-20T09:00:00.000Z', title, content: 'Contenuto sintetico della voce.', setting: 'ambulatory', metadata: { workflowStatus: 'signed' } });
    await post('therapies', { id: `therapy-${crypto.randomUUID()}`, patientId: patient.id, drugName: drug, activePrinciple: 'Principio sintetico', motivation: 'Nota iniziale sintetica', dosage: 'Dose iniziale sintetica', status: 'active', startDate: '2026-10-01T08:00:00.000Z' });
    return patient.id;
  }, { title: ENTRY_TITLE, drug: DRUG });
  await page.route('**/api/settings/ai/functions', route => route.fulfill({ status: 200, json: CATALOG }));
  await page.route('**/api/ai/patient-insight/preview', async route => {
    const request = parsePatientInsightPreviewRequest(route.request().postDataJSON());
    if (!request) throw new Error('Invalid synthetic preview request');
    requests.push(request);
    await route.fulfill({ status: 200, json: availablePreview(request) });
  });
  await page.goto(`/patients/${patientId}/modules`);
  await openPatientSection(page, 'attenzione');
  const panel = page.locator('#patient-insight');
  await panel.locator(':scope > div > [data-disclosure-control]').click();
  await panel.getByRole('button', { name: 'Cambia', exact: true }).click();
  const model = panel.getByRole('combobox', { name: 'Modello per questa proposta', exact: true });
  await model.focus(); await model.selectOption(MODEL_OPTION_ID);
  await panel.getByRole('button', { name: 'Avvia supporto', exact: true }).click();
  await expect(panel.getByTestId('patient-insight-review-proposal')).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].sources.activeTherapies).toEqual([{ label: `${DRUG} — Dose iniziale sintetica` }]);
  expect(requests[0].sources.recentEvents).toHaveLength(1);
  return { panel, requests };
}

const therapyRow = (page: Page) => page.locator('#terapie').getByRole('row').filter({ has: page.getByText(DRUG, { exact: true }) });

async function editTherapy(page: Page, field: 'dosage' | 'motivation', value: string) {
  await openPatientSection(page, 'terapie');
  await therapyRow(page).getByRole('button', { name: 'Modifica', exact: true }).click();
  await page.locator(`#terapie ${field === 'dosage' ? 'input' : 'textarea'}[name="${field}"]`).fill(value);
  const saved = page.waitForResponse(response => response.request().method() === 'PUT' && /\/api\/therapies\//u.test(response.url()));
  await page.locator('#terapie').getByRole('button', { name: 'Aggiorna terapia', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.locator('#terapie form')).toHaveCount(0);
}

async function expectSuperseded(page: Page) {
  await openPatientSection(page, 'attenzione');
  const panel = page.locator('#patient-insight');
  await expect(panel.getByTestId('patient-insight-review-proposal')).toHaveCount(0);
  const superseded = panel.getByTestId('patient-insight-superseded');
  await expect(superseded.getByRole('heading', { name: 'Proposta superata', exact: true })).toBeVisible();
  // the reason is said once, under the heading, without repeating it.
  await expect(superseded.locator('p')).toHaveText('Profilo, diario o terapie sono cambiati dopo la generazione.');
  await expect(page.getByTestId('patient-proposals-summary')).toContainText('Nessuna proposta da rivedere');
}

test.describe.configure({ retries: 0 });

test('una terapia modificata dopo la generazione rende la proposta superata, e si rigenera', async ({ page }) => {
  const { panel, requests } = await generatedProposal(page);
  await editTherapy(page, 'dosage', 'Dose cambiata sintetica');
  await expectSuperseded(page);
  await panel.getByRole('button', { name: 'Riusa predefinito', exact: true }).click();
  await panel.getByRole('button', { name: 'Avvia supporto', exact: true }).click();
  await expect(panel.getByTestId('patient-insight-review-proposal')).toBeVisible();
  await expect(panel.getByTestId('patient-insight-superseded')).toHaveCount(0);
  expect(requests).toHaveLength(2);
  expect(requests[1].sources.activeTherapies).toEqual([{ label: `${DRUG} — Dose cambiata sintetica` }]);
});

test('una voce di diario eliminata dopo la generazione rende la proposta superata', async ({ page }) => {
  const { requests } = await generatedProposal(page);
  await openPatientSection(page, 'diario');
  const row = page.locator('#diario article').filter({ hasText: ENTRY_TITLE });
  await row.getByRole('button', { name: `Azioni voce ${ENTRY_TITLE}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Elimina voce clinica con motivazione', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: /^Motivazione eliminazione/u }).fill('Motivo sintetico di prova');
  const deleted = page.waitForResponse(response => response.request().method() === 'DELETE' && /\/api\/entries\//u.test(response.url()));
  await dialog.getByRole('button', { name: 'Elimina', exact: true }).click();
  expect((await deleted).ok()).toBe(true);
  await expectSuperseded(page);
  expect(requests).toHaveLength(1);
});

test('controesempio: una scrittura che non cambia le fonti lascia la proposta attuale', async ({ page }) => {
  const { panel, requests } = await generatedProposal(page);
  // The therapy note is not among the minimized sources: the therapies are
  // read again, the sources a request would send are identical.
  const reread = page.waitForResponse(response => response.request().method() === 'GET' && /\/api\/therapies\?/u.test(response.url()));
  await editTherapy(page, 'motivation', 'Nota cambiata sintetica');
  await reread;
  await openPatientSection(page, 'attenzione');
  await expect(panel.getByTestId('patient-insight-review-proposal')).toBeVisible();
  await expect(panel.getByTestId('patient-insight-superseded')).toHaveCount(0);
  await expect(page.getByTestId('patient-proposals-summary')).toContainText('1 proposta da rivedere');
  expect(requests).toHaveLength(1);
});
