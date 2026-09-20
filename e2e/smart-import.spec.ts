/* @Codex */
import { expect, test, type Page } from '@playwright/test';
import type { FunctionModelPreferences } from '../lib/function-models/browser';
import { bootstrapUnlockedSession, openPatientSection, setAiLaneKillSwitch } from './utils';

const HEX = Object.freeze({
  session: '1'.repeat(32),
  patient: '2'.repeat(32),
  ambulatory: '3'.repeat(32),
  lease: '4'.repeat(32),
  projection: '5'.repeat(32),
  review: '6'.repeat(32),
});

// E2E fixture only: catalog availability and preview receipts are HTTP mocks,
// not host admission or evidence of a model invocation.
const FIXTURE_MODEL = {
  modelOptionId: `model_option_${'7'.repeat(32)}`,
  provider: 'ollama' as const,
  model: 'mediflow/synthetic',
};
const FIXTURE_CATALOG = {
  schemaVersion: 'mediflow.function-preferences.v1',
  revision: `sha256_${'8'.repeat(64)}`,
  catalogRevision: `sha256_${'9'.repeat(64)}`,
  check: 'configuration_only',
  apply: 'denied',
  presets: ['host_defaults', 'all_off'],
  functions: (['patient_insight', 'smart_import', 'document_synthesis', 'treatment_reasoning'] as const).map(id => ({
    id,
    enabled: id === 'smart_import',
    defaultModelOptionId: id === 'treatment_reasoning' ? `model_option_${'a'.repeat(32)}` : FIXTURE_MODEL.modelOptionId,
    defaultSource: 'host_configuration',
    bindingState: 'current',
    options: id === 'treatment_reasoning'
      ? [{ modelOptionId: `model_option_${'a'.repeat(32)}`, label: 'ATHENA / MLX', provider: 'athena_mlx', state: 'unavailable' }]
      : [{ modelOptionId: FIXTURE_MODEL.modelOptionId, label: FIXTURE_MODEL.model, provider: FIXTURE_MODEL.provider, state: 'available_unqualified' }],
  })),
} satisfies FunctionModelPreferences;

async function createPatient(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const response = await fetch('/api/patients', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Smart',
        lastName: 'Import Synthetic',
        taxCode: `SMRTPT80A01H${String(Date.now()).slice(-4)}`,
        notes: 'Diagnosi sintetica in revisione. Terapia sintetica 10 mg una compressa al giorno.',
      }),
    });
    if (!response.ok) throw new Error(`patient create failed: ${response.status}`);
    return (await response.json() as { id: string }).id;
  });
}

function availablePreview() {
  const providerReceipt = {
    schemaVersion: 'mediflow.ai.provider-selection.v1',
    authorityPlane: 'clinical_application',
    task: 'clinical',
    provider: FIXTURE_MODEL.provider,
    model: FIXTURE_MODEL.model,
    execution: 'local',
    endpointClass: 'loopback',
    egress: 'none',
    runtimeReadiness: 'required',
    fallbackCount: 0,
  };
  const receipt = {
    schemaVersion: 'mediflow.ai.fabric-resolution.v1',
    capability: 'smart_import',
    class: 'generative',
    venue: 'local_process',
    egressProfile: { id: 'local_only', version: 'mediflow.ai.egress-profile.v1', egress: 'none' },
    provider: FIXTURE_MODEL.provider,
    model: FIXTURE_MODEL.model,
    providerReceipt,
    fallbackCount: 0,
  };
  return {
    preview: {
      writesPerformed: 0,
      apply: 'denied',
      status: 'available',
      code: null,
      proposal: {
        schemaVersion: 'mediflow.smart-import.proposal.v1',
        generatedAt: '2026-09-01T10:00:00.000Z',
        contract: { validJson: true, validTask: true, legacyContract: false },
        summary: 'Proposta sintetica da rivedere.',
        diagnoses: [{ label: 'Diagnosi sintetica', icdQuery: 'synthetic', confidence: 'high', evidence: 'Evidenza sintetica', sourceId: 'source.synthetic.1' }],
        therapies: [],
        servicePrescriptions: [],
        writesPerformed: 0,
      },
      receipt,
      provenance: {
        schemaVersion: 'mediflow.ai.fabric-provenance.v1',
        capability: 'smart_import',
        venue: 'local_process',
        provider: FIXTURE_MODEL.provider,
        model: FIXTURE_MODEL.model,
        preprocessing: ['context_minimization', 'envelope_validation'],
        receipt,
      },
      reviewRef: `review_${HEX.review}`,
    },
  };
}

test('[E2E fixture] Smart Import exposes only the Fabric review preview and never calls legacy apply', async ({ page }) => {
  const calls = { context: 0, selectionGet: 0, selectionPost: 0, ingest: 0, preview: 0, legacyApply: 0 };
  let catalogReads = 0;
  await page.route('**/api/settings/ai/functions', async route => {
    expect(route.request().method()).toBe('GET');
    catalogReads += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE_CATALOG) });
  });

  await page.route('**/api/context', async (route) => {
    calls.context += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ambulatoryId: 'ambulatory.synthetic' }) });
  });
  await page.route('**/api/ai/smart-import/selection', async (route) => {
    if (route.request().method() === 'GET') {
      calls.selectionGet += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ selectionEpoch: 0 }) });
      return;
    }
    calls.selectionPost += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ selection: {
        sessionRef: `ssr_${HEX.session}`,
        selectionEpoch: 1,
        patientRef: `ptr_${HEX.patient}`,
        ambulatoryRef: `abr_${HEX.ambulatory}`,
        leaseRef: `lsr_${HEX.lease}`,
        expiresAt: Number.MAX_SAFE_INTEGER,
      } }),
    });
  });
  await page.route('**/api/ai/smart-import/ingest', async (route) => {
    calls.ingest += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ handle: `prj_${HEX.projection}` }) });
  });
  await page.route('**/api/ai/smart-import/preview', async (route) => {
    calls.preview += 1;
    expect(route.request().method()).toBe('POST');
    expect(JSON.parse(route.request().headers()['x-mediflow-function-model'] ?? 'null')).toEqual({
      modelOptionId: FIXTURE_MODEL.modelOptionId,
      expectedCatalogRevision: FIXTURE_CATALOG.catalogRevision,
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(availablePreview()) });
  });
  await page.route('**/api/patients/*/smart-import', async (route) => {
    calls.legacyApply += 1;
    await route.abort();
  });

  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await page.route('**/api/ambulatories', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'ambulatory.synthetic', name: 'Ambulatorio di prova', address: '', version: 1 }]) }));
  await setAiLaneKillSwitch(page, 'aiSmartImportKillSwitch', 'enabled');
  const patientId = await createPatient(page);
  await page.goto(`/patients/${patientId}/modules#quadro`);

  await openPatientSection(page, 'quadro');
  await page.getByText('Proposte dalle fonti cliniche · Smart Import', { exact: true }).click();

  const card = page.getByTestId('fabric-preview-card');
  await expect(card).toContainText('Raccogli dalle fonti della cartella');
  await card.getByRole('button', { name: 'Prepara proposta' }).click();
  await expect(card.getByRole('checkbox')).toBeDisabled();
  await card.getByRole('combobox', { name: 'Ambulatorio per questa proposta' }).selectOption('ambulatory.synthetic');
  const modelPicker = card.getByRole('combobox', { name: 'Modello per questa proposta' });
  await modelPicker.focus();
  await expect(modelPicker.locator('option')).toHaveText([
    `Predefinito · ${FIXTURE_MODEL.model}`,
    'OpenAI · abbonamento ChatGPT · prepara',
    `${FIXTURE_MODEL.model} · Ollama · locale`,
  ]);
  await modelPicker.selectOption(FIXTURE_MODEL.modelOptionId);
  await expect(modelPicker).toHaveValue(FIXTURE_MODEL.modelOptionId);
  await card.getByRole('checkbox').check();
  await card.getByRole('button', { name: 'Conferma e genera proposta' }).click();

  await expect(card).toContainText('0 scritture · applicazione non consentita');
  await expect(card).toContainText('Proposta sintetica da rivedere.');
  await expect(card).toContainText('1 diagnosi · 0 terapie · 0 prestazioni');
  await expect(card).toContainText(`Modello usato: ${FIXTURE_MODEL.provider} · ${FIXTURE_MODEL.model}`);
  await card.getByText('Dettagli di verifica', { exact: true }).click();
  await expect(card.getByTestId('smart-import-fabric-disclosure'))
    .toContainText(`${FIXTURE_MODEL.provider} · ${FIXTURE_MODEL.model} · local_process`);
  expect(catalogReads).toBeGreaterThanOrEqual(2); // Selection read plus pre-generation reread.
  expect(calls).toEqual({ context: 0, selectionGet: 1, selectionPost: 1, ingest: 1, preview: 1, legacyApply: 0 });
});
