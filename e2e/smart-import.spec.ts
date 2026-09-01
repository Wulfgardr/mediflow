/* @Codex */
import { expect, test, type Page } from '@playwright/test';
import { bootstrapUnlockedSession, setAiLaneKillSwitch } from './utils';

const HEX = Object.freeze({
  session: '1'.repeat(32),
  patient: '2'.repeat(32),
  ambulatory: '3'.repeat(32),
  lease: '4'.repeat(32),
  projection: '5'.repeat(32),
  review: '6'.repeat(32),
});

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
    provider: 'ollama',
    model: 'mediflow/synthetic',
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
    provider: 'ollama',
    model: 'mediflow/synthetic',
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
        provider: 'ollama',
        model: 'mediflow/synthetic',
        preprocessing: ['context_minimization', 'envelope_validation'],
        receipt,
      },
      reviewRef: `review_${HEX.review}`,
    },
  };
}

test('Smart Import exposes only the Fabric review preview and never calls legacy apply', async ({ page }) => {
  const calls = { context: 0, selectionGet: 0, selectionPost: 0, ingest: 0, preview: 0, legacyApply: 0 };

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
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(availablePreview()) });
  });
  await page.route('**/api/patients/*/smart-import', async (route) => {
    calls.legacyApply += 1;
    await route.abort();
  });

  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await setAiLaneKillSwitch(page, 'aiSmartImportKillSwitch', 'enabled');
  const patientId = await createPatient(page);
  await page.goto(`/patients/${patientId}/modules`);

  const documents = page.getByRole('button', { name: /Documenti Archivio documenti ed evidenze/u });
  await expect(documents).toBeVisible({ timeout: 20_000 });
  if (await documents.getAttribute('aria-expanded') !== 'true') await documents.click();

  const card = page.getByTestId('fabric-preview-card');
  await expect(card).toContainText('Fabric · anteprima sola lettura');
  await card.getByRole('button', { name: 'Carica contesto' }).click();
  await expect(card).toContainText('ID ambulatorio:');
  await card.getByRole('checkbox').check();
  await card.getByRole('button', { name: 'Genera anteprima (sola lettura)' }).click();

  await expect(card).toContainText('0 scritture · applicazione non consentita');
  await expect(card).toContainText('Proposta sintetica da rivedere.');
  await expect(card).toContainText('1 diagnosi · 0 terapie · 0 prestazioni');
  expect(calls).toEqual({ context: 1, selectionGet: 1, selectionPost: 1, ingest: 1, preview: 1, legacyApply: 0 });
});
