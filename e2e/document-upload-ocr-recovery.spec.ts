/* @Codex */
import { expect, test, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mapAnyDocLocalFailure } from '../lib/domain/documents/anydoc-local-extraction-contract';
import type { AttachmentExtractionProjectionGrant } from '../lib/domain/documents/attachment-extraction-projection-protocol';
import { bootstrapUnlockedSession, openPatientSection } from './utils';
import { observeAnyDocProjectResponse } from './anydoc-project-response';

const TEXT = 'DOCUMENTO SINTETICO PER RECUPERO';
const RTF = Buffer.from(`{\\rtf1\\ansi ${TEXT}}`);
test.describe.configure({ retries: 0 });

async function fixture(page: Page, bytes = RTF, extension = 'rtf') {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const marker = randomUUID();
  const patient = await page.request.post('/api/patients', { data: {
    firstName: 'Synthetic', lastName: 'OCR Recovery', birthDate: '1975-01-01T00:00:00.000Z',
    taxCode: `REC${marker.replaceAll('-', '').slice(0, 13)}`, diagnoses: [],
  } });
  expect(patient.ok()).toBe(true);
  const patientId = (await patient.json()).id as string;
  const name = `synthetic-recovery.${extension}`;
  const type = extension === 'pdf' ? 'application/pdf' : 'application/rtf';
  const url = `/patients/${patientId}/modules`;
  await openArchive(page, url);
  const saved = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/attachments');
  await page.locator('#documenti input[type="file"]').setInputFiles({ name, mimeType: type, buffer: bytes });
  const response = await saved;
  expect(response.status()).toBe(201);
  const uploaded = response.request().postDataJSON() as { id: string; patientId: string; data: string };
  expect(uploaded.patientId).toBe(patientId);
  expect(uploaded.data).toMatch(/^ENC:/u);
  return { id: uploaded.id, name, patientId, url, endpoint: `**/api/attachments/${uploaded.id}/local-extraction` };
}

async function openArchive(page: Page, url: string) {
  await page.goto(url);
  await openPatientSection(page, 'documenti');
  await expect(page.locator('#documenti').getByRole('heading', { name: /Archivio documenti ed evidenze/ })).toBeVisible();
}

for (const failure of ['engine_absent', 'timeout', 'crash', 'transport_interrupted', 'stale'] as const) {
  test(`OCR recovery UI: ${failure}, manual review and explicit retry`, async ({ page }) => {
    const file = await fixture(page); let calls = 0;
    let grant: AttachmentExtractionProjectionGrant | undefined;
    // Authentication and source acquisition stay real. Only the first parser
    // response is simulated; a parser failure must not require a successful parse.
    await page.route(file.endpoint, async (route) => {
      if (route.request().headers()['x-mediflow-extraction-action'] === 'acquire') {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        grant = await response.json() as AttachmentExtractionProjectionGrant;
        return route.fulfill({ response });
      }
      if (route.request().headers()['x-mediflow-extraction-action'] !== 'project') return route.continue();
      calls += 1;
      if (calls > 1) return route.continue();
      expect(grant?.schemaVersion).toBe('mediflow.attachment_extraction_projection.v1');
      expect(route.request().headers()['x-mediflow-extraction-grant']).toBe(grant?.grantId);
      if (failure === 'transport_interrupted') return route.abort('failed');
      if (failure === 'stale') return route.fulfill({ status: 409, json: { error: 'Local extraction unavailable' } });
      const body = mapAnyDocLocalFailure({ attachmentId: file.id, byteLength: RTF.byteLength,
        sourceSha256: createHash('sha256').update(RTF).digest('hex') }, failure === 'timeout' ? 'resourceLimit' : 'io');
      await route.fulfill({ status: 200, json: {
        schemaVersion: grant!.schemaVersion, grantId: grant!.grantId,
        acquisition: { origin: 'authenticated_client_decryption', ciphertextEquality: 'not_attested',
          canonicalSource: grant!.canonicalSource }, extraction: body,
      } });
    });
    const extract = page.getByRole('button', { name: `Estrai testo localmente da ${file.name}` });
    await extract.click();
    await expect(page.getByText(/Revisione manuale necessaria/).first()).toBeVisible();
    await expect(page.getByTestId('anydoc-local-extraction-preview')).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Visualizza ${file.name}`, exact: true })).toBeEnabled();
    await expect(extract).toBeEnabled();
    await extract.click();
    await expect(page.getByTestId('anydoc-local-extraction-preview')).toContainText(TEXT);
    expect(calls).toBe(2);
    await expect(page.getByText(/Revisione manuale necessaria/)).toHaveCount(0);
  });
}

for (const input of ['protected', 'corrupt'] as const) {
  test(`OCR recovery UI: real ${input} PDF keeps manual review available after retry`, async ({ page }) => {
    const bytes = input === 'protected' ? readFileSync('e2e/fixtures/ocr-synthetic-protected.pdf')
      : Buffer.from('%PDF-1.7\nsynthetic corrupt document\n%%EOF');
    const file = await fixture(page, bytes, 'pdf');
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const observed = await observeAnyDocProjectResponse(page, file.id);
      try {
        const responsePromise = page.waitForResponse(response => response.request().method() === 'POST'
          && response.request().headers()['x-mediflow-extraction-action'] === 'project'
          && response.url().endsWith(`/api/attachments/${file.id}/local-extraction`));
        void responsePromise.catch(() => {});
        await page.getByRole('button', { name: `Estrai testo localmente da ${file.name}` }).click();
        const response = await responsePromise;
        expect(response.status()).toBe(200);
        const projection = await observed.json(response);
        expect(projection.grantId === response.request().headers()['x-mediflow-extraction-grant']).toBe(true);
        expect(projection).toMatchObject({ schemaVersion: 'mediflow.attachment_extraction_projection.v1',
          acquisition: { origin: 'authenticated_client_decryption', ciphertextEquality: 'not_attested' } });
        const result = projection.extraction;
        expect(result).toMatchObject({ status: 'review_required', markdown: '', candidateUse: 'blocked',
          detail: input === 'protected' ? 'encrypted_document' : 'malformed_document', review: 'required', writes: 0, apply: 'none' });
        expect(result.receipt.ocrProvenance).toBeUndefined();
        await expect(page.getByTestId('anydoc-local-extraction-preview')).toHaveCount(0);
        await expect(page.getByText(/Revisione manuale necessaria/).first()).toBeVisible();
        await expect(page.getByRole('button', { name: `Visualizza ${file.name}`, exact: true })).toBeEnabled();
        observed.assertSameResponse(response);
      } finally { await observed.dispose(); }
    }
  });
}

test('OCR recovery UI: interrupt waiting, ignore late result and recover with a fresh request', async ({ page }, testInfo) => {
  const file = await fixture(page);
  const ready = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
  const retryReady = Promise.withResolvers<void>(); const releaseRetry = Promise.withResolvers<void>();
  const lateDelivered = Promise.withResolvers<void>();
  let calls = 0;
  await page.route(file.endpoint, async (route) => {
    if (route.request().headers()['x-mediflow-extraction-action'] !== 'project') return route.continue();
    calls += 1;
    const attempt = calls;
    if (attempt > 2) return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (attempt === 1) { ready.resolve(); await release.promise; }
    else { retryReady.resolve(); await releaseRetry.promise; }
    // A cancelled browser request can no longer receive the completed server result.
    await route.fulfill({ response }).catch(() => undefined);
    if (attempt === 1) lateDelivered.resolve();
  });
  try {
    const extract = page.getByRole('button', { name: `Estrai testo localmente da ${file.name}` });
    await extract.click(); await ready.promise;
    await expect(extract).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath('waiting-synthetic.png'), fullPage: true });
    await page.getByRole('button', { name: 'Interrompi attesa', exact: true }).click({ timeout: 3000 });
    await expect(extract).toBeEnabled();
    await expect(page.getByTestId('anydoc-local-extraction-preview')).toHaveCount(0);
    await expect(page.getByText(/Revisione manuale necessaria/).first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('interrupted-synthetic.png'), fullPage: true });
    await extract.click();
    await retryReady.promise;
    release.resolve(); await lateDelivered.promise;
    await expect(extract).toBeDisabled();
    await expect(page.getByTestId('anydoc-local-extraction-preview')).toHaveCount(0);
    releaseRetry.resolve();
    await expect(page.getByTestId('anydoc-local-extraction-preview')).toContainText(TEXT);
    await expect(extract).toBeEnabled();
    expect(calls).toBe(2);
    await openArchive(page, file.url);
    await expect(page.getByTestId('anydoc-local-extraction-preview')).toHaveCount(0);
    await page.getByRole('button', { name: `Estrai testo localmente da ${file.name}` }).click();
    await expect(page.getByTestId('anydoc-local-extraction-preview')).toContainText(TEXT);
  } finally { release.resolve(); releaseRetry.resolve(); }
});

test('OCR recovery UI: deleting a pending attachment releases the other extraction controls', async ({ page }) => {
  const file = await fixture(page);
  const saved = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/attachments');
  await page.locator('#documenti input[type="file"]').setInputFiles({ name: 'synthetic-second.rtf', mimeType: 'application/rtf', buffer: RTF });
  const response = await saved;
  expect(response.ok()).toBe(true);
  await openArchive(page, file.url);
  const second = page.getByRole('button', { name: 'Estrai testo localmente da synthetic-second.rtf' });
  await expect(second).toBeVisible();
  const ready = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
  await page.route(file.endpoint, async (route) => {
    if (route.request().headers()['x-mediflow-extraction-action'] !== 'project') return route.continue();
    const response = await route.fetch();
    ready.resolve(); await release.promise;
    await route.fulfill({ response }).catch(() => undefined);
  });
  try {
    await page.getByRole('button', { name: `Estrai testo localmente da ${file.name}` }).click();
    await ready.promise; await expect(second).toBeDisabled();
    await page.getByRole('button', { name: `Elimina ${file.name}`, exact: true }).click();
    await page.getByRole('button', { name: 'Elimina', exact: true }).click();
    await expect(page.getByRole('button', { name: `Estrai testo localmente da ${file.name}` })).toHaveCount(0);
    await expect(second).toBeEnabled();
    expect((await page.request.get(`/api/attachments/${file.id}`)).status()).toBe(404);
    release.resolve();
    await expect(page.getByTestId('anydoc-local-extraction-preview')).toHaveCount(0);
    await second.click();
    await expect(page.getByTestId('anydoc-local-extraction-preview')).toContainText(TEXT);
  } finally { release.resolve(); }
});
