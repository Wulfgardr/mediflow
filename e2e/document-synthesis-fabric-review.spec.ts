/* @Codex */
import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

import {
  isVisible,
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

async function createFixture(page: Page): Promise<{ patientId: string; attachmentId: string; attachmentName: string }> {
  const suffix = `${Date.now()}`.slice(-8);
  return page.evaluate(async (marker) => {
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
    const attachmentId = `attachment-fabric-review-${marker}`;
    const attachmentName = `documento-fabric-review-${marker}.pdf`;
    const attachmentResponse = await fetch('/api/attachments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: attachmentId,
        patientId,
        name: attachmentName,
        type: 'application/pdf',
        size: 24,
        path: `uploads/${attachmentName}`,
        data: 'data:application/pdf;base64,JVBERi0xLjQ=',
      }),
    });
    if (!attachmentResponse.ok) throw new Error(`Fixture allegato Fabric: HTTP ${attachmentResponse.status}`);
    return { patientId, attachmentId, attachmentName };
  }, suffix);
}

async function openDocumentArchive(page: Page, patientId: string): Promise<void> {
  await page.goto(`/patients/${patientId}/modules`);
  const toggle = page.getByRole('button', { name: /Archivio documenti ed evidenze/ });
  await expect(toggle).toBeVisible();
  await expect(async () => {
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    expect(await toggle.getAttribute('aria-expanded')).toBe('true');
  }).toPass();
}

async function bootstrapFabricSession(page: Page, pin: string): Promise<void> {
  await page.goto('/');
  const profile = page.getByRole('heading', { name: 'Chi sei?' });
  if (await isVisible(profile)) {
    await page.getByPlaceholder('es. Dott. Nome Medico').fill('Dr. E2E Fabric');
    await page.getByPlaceholder('es. Studio Medico Centrale').fill('Ambulatorio E2E');
    await page.getByRole('button', { name: 'Avanti' }).click();
    await expect(page.getByRole('heading', { name: 'Ruolo' })).toBeVisible();
    await page.getByRole('button', { name: 'Avanti' }).click();
    await expect(page.getByRole('heading', { name: 'Credenziali di Accesso' })).toBeVisible();
    await page.getByPlaceholder('es. operatore.demo').fill('admin');
    await page.getByPlaceholder('Password sicura').fill('password');
    await page.getByRole('button', { name: 'Avanti' }).click();
  }
  const security = page.getByRole('heading', { name: /^Sicurezza(?: Locale)?$/u });
  if (await isVisible(security)) {
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

test('Document Synthesis Fabric mostra una sola proposta con receipt, provenienza e citazioni', async ({ page }) => {
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
  await page.route('**/api/attachments/*/local-extraction', async (route) => {
    calls.extraction += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: anyDocResponse(attachmentId) });
  });
  await page.route('**/api/ai/document-synthesis/ingest', async (route) => {
    calls.ingest += 1;
    bodies.ingest = route.request().postDataJSON();
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

  const card = page.getByTestId(`document-synthesis-fabric-review-${attachmentId}`);
  await expect(card).toContainText('Sintesi Fabric · sola proposta');
  previewStarted = true;
  await card.getByRole('button', { name: 'Genera proposta' }).click();

  await expect(card).toContainText('0 scritture · applicazione non consentita');
  await expect(card).toContainText('Sintesi Fabric sintetica, proposta per sola revisione.');
  await expect(card).toContainText('Receipt');
  await expect(card).toContainText('Provenienza');
  await expect(card).toContainText('Citazioni');
  await expect(card).toContainText(QUOTE);
  expect(calls).toEqual({ capture: 1, extraction: 0, ingest: 1, preview: 1, legacy: 0 });
  expect(bodies).toEqual({
    capture: { attachmentId },
    ingest: { captureHandle: CAPTURE_HANDLE },
    preview: { previewHandle: PREVIEW_HANDLE },
  });
  expect(forbiddenWrites).toEqual([]);
});
