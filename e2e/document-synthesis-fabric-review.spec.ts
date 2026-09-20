/* @Codex */
import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

import {
  isVisible,
  openPatientSection,
  setAiLaneKillSwitch,
  setupPinLegacyIfNeeded,
  unlockIfNeeded,
  waitForUnlockedInteractiveShell,
} from './utils';

const MARKDOWN = '# Documento sintetico\n\nFonte clinica sintetica di sola prova.';
const QUOTE = 'Fonte clinica sintetica di sola prova.';
const CAPTURE_HANDLE = `dsc_${'1'.repeat(32)}`;
const PREVIEW_HANDLE = `dsp_${'2'.repeat(32)}`;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function anyDocResponse(attachmentId: string): string {
  const markdownBytes = Buffer.byteLength(MARKDOWN, 'utf8');
  const sourceSha256 = 'a'.repeat(64);
  return JSON.stringify({
    schemaVersion: 'mediflow.anydoc_local_extraction.v1',
    provenance: { attachmentId, sourceSha256, byteLength: 24 },
    receipt: {
      receiptId: 'b'.repeat(64),
      parser: 'anydoc-local',
      outcome: 'extracted',
      sourceSha256,
      sourceByteLength: 24,
      markdownSha256: sha256(MARKDOWN),
      markdownByteLength: markdownBytes,
    },
    review: 'required',
    writes: 0,
    apply: 'none',
    status: 'extracted',
    markdown: MARKDOWN,
    candidateUse: 'review_only',
  });
}

function previewResponse() {
  const providerBindingReceipt = {
    schemaVersion: 'mediflow.document-synthesis.provider-binding.v1',
    capability: 'document_synthesis',
    registryTask: 'reasoning',
    provider: 'ollama',
    model: 'mediflow/synthetic-local',
    venue: 'local_process',
    egress: 'none',
    fallback: 'none',
    runtimeReadiness: 'required',
  };
  const fabricReceipt = {
    schemaVersion: 'mediflow.ai.fabric-resolution.v1',
    capability: 'document_synthesis',
    class: 'generative',
    venue: 'local_process',
    egressProfile: { id: 'local_only', version: 'mediflow.ai.egress-profile.v1', egress: 'none' },
    provider: 'ollama',
    model: 'mediflow/synthetic-local',
    fallbackCount: 0,
  };
  return {
    schemaVersion: 'mediflow.document-synthesis.preview-wire.v1',
    status: 'available',
    publication: {
      output: {
        schemaVersion: 'mediflow.ai.extract.v1',
        task: 'document_synthesis',
        summary: 'Sintesi Fabric sintetica, proposta per sola revisione.',
        qualityLevel: 'green',
      },
      citations: [{
        label: 'S1',
        quote: QUOTE,
        startByte: Buffer.byteLength('# Documento sintetico\n\n', 'utf8'),
        endByte: Buffer.byteLength(MARKDOWN, 'utf8'),
        quoteSha256: sha256(QUOTE),
      }],
      receipt: {
        schemaVersion: 'mediflow.document-synthesis.publication-receipt.v1',
        capability: 'document_synthesis',
        outputSha256: 'c'.repeat(64),
        claimCitationsDigestSha256: Array(32).fill(1),
        sourceSetDigestSha256: Array(32).fill(2),
        providerBindingReceipt,
        reviewOnly: true,
        applyPolicy: 'none',
        writesPerformed: 0,
      },
      provenance: {
        schemaVersion: 'mediflow.document-synthesis.publication-provenance.v1',
        capability: 'document_synthesis',
        sourceSetAuthority: 'application_host',
        inputDigestScope: 'ordered_normalized_provider_projection_set',
        citationSupport: 'provider_declared_host_membership_and_locator_validated',
        modelCausality: 'not_established',
        fabricProvenance: {
          schemaVersion: 'mediflow.ai.fabric-provenance.v1',
          capability: 'document_synthesis',
          venue: 'local_process',
          provider: 'ollama',
          model: 'mediflow/synthetic-local',
          preprocessing: ['context_minimization'],
          receipt: fabricReceipt,
        },
      },
    },
  };
}

function localModelPreferencesResponse() {
  const revision = `sha256_${'a'.repeat(64)}`;
  const optionId = `model_option_${'b'.repeat(32)}`;
  return {
    schemaVersion: 'mediflow.function-preferences.v2', revision, catalogRevision: revision,
    check: 'configuration_only', presets: ['host_defaults', 'all_off'], apply: 'denied',
    functions: [
      { id: 'patient_insight', enabled: false, defaultModelOptionId: null, defaultSource: 'host_configuration', bindingState: 'current', options: [] },
      { id: 'smart_import', enabled: false, defaultModelOptionId: null, defaultSource: 'host_configuration', bindingState: 'current', options: [] },
      { id: 'document_synthesis', enabled: true, defaultModelOptionId: optionId, defaultSource: 'host_configuration', bindingState: 'current',
        options: [{ modelOptionId: optionId, label: 'MediFlow sintetico', provider: 'ollama', state: 'available_unqualified' }] },
      { id: 'treatment_reasoning', enabled: false, defaultModelOptionId: null, defaultSource: 'host_configuration', bindingState: 'current', options: [] },
    ],
  };
}

async function createFixture(page: Page): Promise<{ patientId: string; attachmentId: string; attachmentName: string; attachmentBytes: Buffer }> {
  const suffix = `${Date.now()}`.slice(-8);
  const fixture = await page.evaluate(async (marker) => {
    const patientResponse = await fetch('/api/patients', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        firstName: `Fabric${marker.slice(0, 4)}`,
        lastName: `Review${marker.slice(4)}`,
        taxCode: `FBR${marker.padStart(13, '0')}`,
        birthDate: '1975-01-01T00:00:00.000Z',
        address: 'Indirizzo sintetico Fabric',
        phone: '0000000086',
        diagnoses: [],
      }),
    });
    if (!patientResponse.ok) throw new Error(`Fixture paziente Fabric: HTTP ${patientResponse.status}`);
    const patientId = (await patientResponse.json() as { id: string }).id;
    const attachmentName = `documento-fabric-review-${marker}.rtf`;
    return { patientId, attachmentName };
  }, suffix);
  const attachmentBytes = Buffer.from('{\\rtf1\\ansi Documento Fabric sintetico cifrato dalla facade.}');
  await openDocumentArchive(page, fixture.patientId);
  const saved = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/attachments');
  await page.locator('#documenti input[type="file"]').setInputFiles({ name: fixture.attachmentName,
    mimeType: 'application/rtf', buffer: attachmentBytes });
  const response = await saved;
  if (!response.ok()) throw new Error(`Fixture allegato Fabric: HTTP ${response.status()}`);
  const uploaded = response.request().postDataJSON() as { id: string; patientId: string; data: string };
  if (uploaded.patientId !== fixture.patientId || !/^ENC:/u.test(uploaded.data)) throw new Error('Fixture allegato Fabric non cifrato dalla facade');
  return { ...fixture, attachmentId: uploaded.id, attachmentBytes };
}

async function openDocumentArchive(page: Page, patientId: string): Promise<void> {
  await page.goto(`/patients/${patientId}/modules`);
  await openPatientSection(page, 'documenti');
  await expect(page.locator('#documenti').getByRole('heading', { name: /Archivio documenti ed evidenze/ })).toBeVisible();
}

async function bootstrapFabricSession(page: Page, pin: string): Promise<void> {
  await page.goto('/');
  const profile = page.getByRole('heading', { name: 'Chi sei?' });
  if (await isVisible(profile)) {
    await page.getByPlaceholder('es. Dott. Nome Medico').fill('Dr. E2E Fabric');
    await page.getByPlaceholder('es. Studio Medico Centrale').fill('Ambulatorio E2E');
    await page.getByRole('button', { name: 'Avanti' }).click();
    // @Codex: the security wizard collects identity and PIN only.
    await expect(page.getByRole('heading', { name: 'Sicurezza', exact: true })).toBeVisible();
    const pinInputs = page.locator('input[placeholder="••••••"]');
    await pinInputs.nth(0).fill(pin);
    await pinInputs.nth(1).fill(pin);
    await page.getByRole('button', { name: 'Concludi Setup' }).click();
  }
  await setupPinLegacyIfNeeded(page, pin);
  await unlockIfNeeded(page, pin);
  await waitForUnlockedInteractiveShell(page);
}

test.describe.configure({ retries: 0 });

test('Document Synthesis Fabric mostra una proposta con verifica, provenienza e citazioni', async ({ page }) => {
  const calls = { capture: 0, extraction: 0, ingest: 0, preview: 0, legacy: 0 };
  const bodies: { capture?: unknown; ingest?: unknown; preview?: unknown } = {};
  let attachmentId = '';
  let previewStarted = false;
  const forbiddenWrites: string[] = [];

  page.on('request', (request) => {
    if (!previewStarted) return;
    const url = new URL(request.url());
    if (request.method() === 'PUT' && /^\/api\/(?:patients|attachments)\//u.test(url.pathname)) {
      forbiddenWrites.push(`${request.method()} ${url.pathname}`);
    }
  });
  await page.route('**/api/ai/document-synthesis/capture', async (route) => {
    calls.capture += 1;
    bodies.capture = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ captureHandle: CAPTURE_HANDLE }) });
  });
  await page.route('**/api/settings/ai/functions', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(localModelPreferencesResponse()) });
  });
  await page.route('**/api/attachments/*/local-extraction', async (route) => {
    calls.extraction += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: anyDocResponse(attachmentId) });
  });
  await page.route('**/api/ai/document-synthesis/ingest', async (route) => {
    calls.ingest += 1;
    const bytes = route.request().postDataBuffer();
    bodies.ingest = { captureHandle: route.request().headers()['x-mediflow-document-synthesis-capture'],
      contentType: route.request().headers()['content-type'], byteLength: bytes?.byteLength,
      sourceSha256: bytes ? createHash('sha256').update(bytes).digest('hex') : null };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ previewHandle: PREVIEW_HANDLE }) });
  });
  await page.route('**/api/ai/document-synthesis/preview', async (route) => {
    calls.preview += 1;
    bodies.preview = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(previewResponse()) });
  });
  await page.route('**/api/ai/document-router-audit', async (route) => {
    calls.legacy += 1;
    await route.abort();
  });

  await bootstrapFabricSession(page, process.env.E2E_PIN || '1234');
  await setAiLaneKillSwitch(page, 'aiDocumentSynthesisKillSwitch', 'enabled');
  const fixture = await createFixture(page);
  attachmentId = fixture.attachmentId;
  await openDocumentArchive(page, fixture.patientId);
  await page.getByRole('button', { name: `Prepara sintesi di ${fixture.attachmentName}` }).click();

  const card = page.getByTestId(`document-synthesis-fabric-review-${attachmentId}`);
  await expect(card).toContainText('Sintesi da rivedere');
  previewStarted = true;
  await card.getByRole('button', { name: 'Genera proposta' }).click();
  await card.getByLabel('Ambulatorio per questa proposta').selectOption({ index: 1 });
  await card.getByRole('checkbox').check();
  await card.getByRole('button', { name: 'Conferma e genera proposta' }).click();

  await expect(card).toContainText('Sintesi Fabric sintetica, proposta per sola revisione.');
  await card.getByText('Dettagli di verifica').click();
  await expect(card).toContainText('0 scritture · applicazione non consentita');
  await expect(card).toContainText('Provenienza');
  await card.getByText(/Citazioni dal documento/u).click();
  await expect(card).toContainText(QUOTE);
  expect(calls).toEqual({ capture: 1, extraction: 0, ingest: 1, preview: 1, legacy: 0 });
  expect(bodies).toEqual({
    capture: { attachmentId },
    ingest: { captureHandle: CAPTURE_HANDLE, contentType: 'application/octet-stream', byteLength: fixture.attachmentBytes.byteLength,
      sourceSha256: createHash('sha256').update(fixture.attachmentBytes).digest('hex') },
    preview: { previewHandle: PREVIEW_HANDLE },
  });
  expect(forbiddenWrites).toEqual([]);
});
