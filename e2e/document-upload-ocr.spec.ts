/* @Codex */
import { expect, test, type Page } from '@playwright/test';
import { createCanvas } from '@napi-rs/canvas';
import { createHash, randomUUID } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { bootstrapUnlockedSession, openPatientSection } from './utils';
import { observeAnyDocProjectResponse } from './anydoc-project-response';

const NATIVE_TEXT = 'PRIMA PAGINA TESTUALE - DOCUMENTO SINTETICO';
const SCANNED_TEXT = 'ULTIMA PAGINA SCANSIONATA';
type Scenario = 'text' | 'scan' | 'mixed' | 'image';

function syntheticImage(): Buffer {
  const canvas = createCanvas(1600, 500);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000000';
  context.font = 'bold 78px Helvetica';
  context.fillText(SCANNED_TEXT, 40, 200);
  context.font = '54px Helvetica';
  context.fillText('Documento sintetico per prova locale', 40, 330);
  return canvas.toBuffer('image/png');
}

async function syntheticDocument(scenario: Scenario): Promise<Buffer> {
  if (scenario === 'image') return syntheticImage();
  const pdf = await PDFDocument.create();
  if (scenario === 'text' || scenario === 'mixed') {
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([800, 250]);
    page.drawText(NATIVE_TEXT, { x: 30, y: 180, size: 24, font });
    page.drawText('Testo nativo conservato, senza contenuti clinici reali.', { x: 30, y: 130, size: 20, font });
  }
  if (scenario === 'scan' || scenario === 'mixed') {
    const image = await pdf.embedPng(syntheticImage());
    pdf.addPage([800, 250]).drawImage(image, { x: 0, y: 0, width: 800, height: 250 });
  }
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}

async function openSyntheticAttachment(page: Page, scenario: Scenario, bytes: Buffer) {
  const marker = randomUUID();
  const patientResponse = await page.request.post('/api/patients', {
    data: {
      firstName: 'Documento', lastName: 'Sintetico OCR',
      taxCode: `OCR${marker.replaceAll('-', '').slice(0, 13)}`,
      birthDate: '1975-01-01T00:00:00.000Z', diagnoses: [],
    },
  });
  expect(patientResponse.ok()).toBe(true);
  const patientId = (await patientResponse.json() as { id: string }).id;
  const name = `documento-sintetico-${scenario}-${marker}.${scenario === 'image' ? 'png' : 'pdf'}`;
  const type = scenario === 'image' ? 'image/png' : 'application/pdf';
  await page.goto(`/patients/${patientId}/modules`);
  await openPatientSection(page, 'documenti');
  await expect(page.locator('#documenti').getByRole('heading', { name: /Archivio documenti ed evidenze/ })).toBeVisible();
  // The ordinary facade encrypts the upload. Plaintext API seeds do NOT qualify this test.
  const saved = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/attachments');
  await page.locator('#documenti input[type="file"]').setInputFiles({ name, mimeType: type, buffer: bytes });
  const response = await saved;
  expect(response.ok()).toBe(true);
  const uploaded = response.request().postDataJSON() as { id: string; patientId: string; data: string };
  expect(uploaded.patientId).toBe(patientId);
  expect(uploaded.data).toMatch(/^ENC:/);
  const id = uploaded.id;
  expect(id).toBeTruthy();
  await expect(page.getByRole('button', { name: `Estrai testo localmente da ${name}` })).toBeVisible();
  const persistedResponse = await page.request.get(`/api/attachments/${id}`);
  expect(persistedResponse.ok()).toBe(true);
  const persisted = await persistedResponse.json();
  expect(persisted.data).toBe(uploaded.data);
  for (const key of ['documentSourceRef', 'documentRevision', 'documentFreshnessEpoch'])
    expect(persisted).not.toHaveProperty(key); // Preserve the ordinary API projection.
  return { id, name, persisted };

}

for (const scenario of ['text', 'scan', 'mixed', 'image'] as const) {
  test(`Estrazione locale: ${scenario}, dalla UI al risultato corrente`, async ({ page }, testInfo) => {
    test.skip((scenario === 'scan' || scenario === 'mixed')
      && (process.platform !== 'darwin' || process.arch !== 'arm64'), 'Prova Apple Vision sul Mac arm64.');
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const bytes = await syntheticDocument(scenario);
    const attachment = await openSyntheticAttachment(page, scenario, bytes);
    const observed = await observeAnyDocProjectResponse(page, attachment.id);
    try {
      const acquirePromise = page.waitForResponse(response => response.request().method() === 'POST'
        && response.url().endsWith(`/api/attachments/${attachment.id}/local-extraction`)
        && response.request().headers()['x-mediflow-extraction-action'] === 'acquire');
      const responsePromise = page.waitForResponse(response => response.request().method() === 'POST'
        && response.url().endsWith(`/api/attachments/${attachment.id}/local-extraction`)
        && response.request().headers()['x-mediflow-extraction-action'] === 'project');
      void responsePromise.catch(() => {}); // An acquire failure still reports its own assertion.
      await page.getByRole('button', { name: `Estrai testo localmente da ${attachment.name}` }).click();
      const acquired = await acquirePromise;
      // @Codex: acquire status stays direct; the unchanged client validates its grant.
      // Observe project bytes passively, without relying on the inspector body cache.
      expect(acquired.status()).toBe(200);
      const response = await responsePromise;
      expect(response.status()).toBe(200);
      const envelope = await observed.json(response);
      expect(envelope.grantId === response.request().headers()['x-mediflow-extraction-grant']).toBe(true);
      expect(envelope).toMatchObject({ schemaVersion: 'mediflow.attachment_extraction_projection.v1',
        acquisition: { origin: 'authenticated_client_decryption', ciphertextEquality: 'not_attested' } });
      expect(envelope.acquisition.canonicalSource).toMatchObject({
        sourceRef: expect.stringMatching(/^[a-f0-9]{64}$/),
        revision: expect.any(Number), freshnessEpoch: expect.any(Number),
      });
      expect(envelope.acquisition.canonicalSource.revision).toBeGreaterThan(0);
      expect(envelope.acquisition.canonicalSource.freshnessEpoch).toBeGreaterThan(0);
      const result = envelope.extraction;
      expect(result).toMatchObject({
        provenance: { attachmentId: attachment.id, sourceSha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.byteLength },
        review: 'required', writes: 0, apply: 'none',
      });
      const preview = page.getByTestId('anydoc-local-extraction-preview');
      if (scenario === 'image') {
        // Single images have no PDF page routing in the current application contract.
        expect(result.status).toBe('review_required');
        expect(result.receipt.ocrProvenance).toBeUndefined();
        await expect(preview).toHaveCount(0);
        await expect(page.getByText(/Revisione manuale necessaria/i).first()).toBeVisible();
      } else {
        expect(result).toMatchObject({ status: 'extracted', candidateUse: 'review_only' });
        await expect(preview).toBeVisible();
        await preview.locator('summary').click();
        await expect(preview.locator('pre')).toHaveText(result.markdown);
        // AnyDoc normalizes whitespace around punctuation; preserve words and order.
        if (scenario !== 'scan') await expect(preview).toContainText(/PRIMA PAGINA TESTUALE\s*-\s*DOCUMENTO SINTETICO/);
        if (scenario === 'text') {
          expect(result.receipt.ocrProvenance).toBeUndefined();
          await expect(preview).not.toContainText('OCR completato');
        }
        else {
          await expect(preview).toContainText(SCANNED_TEXT);
          expect(result.receipt.ocrProvenance).toMatchObject({
            engine: 'apple_vision', pageCount: scenario === 'mixed' ? 2 : 1, ocrPageCount: 1,
          });
          expect(result.receipt.ocrProvenance.receiptSetSha256).toMatch(/^[a-f0-9]{64}$/);
          await expect(preview).toContainText('Testo OCR locale · da rivedere');
          await expect(preview).toContainText(`OCR: 1 pagine su ${scenario === 'mixed' ? 2 : 1}`);
        }
        if (scenario === 'mixed') {
          expect(result.markdown).toMatch(/## Pagina 1[\s\S]*PRIMA PAGINA TESTUALE[\s\S]*## Pagina 2[\s\S]*ULTIMA PAGINA SCANSIONATA/);
        }
      }
      const after = await page.request.get(`/api/attachments/${attachment.id}`);
      expect(await after.json()).toEqual(attachment.persisted); // Extraction performs no clinical writes.
      await page.screenshot({ path: testInfo.outputPath(`${scenario}-synthetic.png`), fullPage: true });
      observed.assertSameResponse(response);
    } finally { await observed.dispose(); }
  });
}

/* @Codex: a completed response held by the browser must never reappear after cancellation. */
test('Upload cifrato: annullamento, risposta tardiva, replay e nuovo tentativo', async ({ page }) => {
  test.setTimeout(90_000);
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const bytes = await syntheticDocument('text');
  const attachment = await openSyntheticAttachment(page, 'text', bytes);
  const endpoint = `/api/attachments/${attachment.id}/local-extraction`;
  const reached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const delivered = Promise.withResolvers<void>();
  let held = true;
  let token = '';
  await page.route(`**${endpoint}`, async route => {
    if (held && route.request().method() === 'POST'
      && route.request().headers()['x-mediflow-extraction-action'] === 'project') {
      held = false;
      token = route.request().headers()['x-mediflow-extraction-grant'];
      const response = await route.fetch();
      expect(response.status()).toBe(200); reached.resolve();
      await release.promise;
      try { await route.fulfill({ response }); } catch { /* Browser cancellation may close the request first. */ }
      finally { delivered.resolve(); }
    } else await route.continue();
  });
  try {
    await page.getByRole('button', { name: `Estrai testo localmente da ${attachment.name}` }).click();
    await reached.promise;
    await page.getByRole('button', { name: 'Interrompi attesa' }).click();
    release.resolve(); await delivered.promise;
    await expect(page.getByTestId('anydoc-local-extraction-preview')).toHaveCount(0);
    const replay = await page.request.post(endpoint, { data: bytes, headers: {
      Origin: new URL(page.url()).origin, 'Content-Type': 'application/octet-stream',
      'X-MediFlow-Extraction-Action': 'project', 'X-MediFlow-Extraction-Grant': token,
    } });
    expect(replay.status()).toBe(409);
    const retry = page.waitForResponse(response => response.url().endsWith(endpoint)
      && response.request().headers()['x-mediflow-extraction-action'] === 'project');
    await page.getByRole('button', { name: `Estrai testo localmente da ${attachment.name}` }).click();
    expect((await retry).status()).toBe(200);
    await expect(page.getByTestId('anydoc-local-extraction-preview')).toBeVisible();
    expect(await (await page.request.get(`/api/attachments/${attachment.id}`)).json()).toEqual(attachment.persisted);
  } finally { release.resolve(); await page.unroute(`**${endpoint}`); }
});
