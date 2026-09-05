/* @Codex */
import { expect, test, type Page } from '@playwright/test';
import { createCanvas } from '@napi-rs/canvas';
import { createHash, randomUUID } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { bootstrapUnlockedSession } from './utils';

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
  const id = `ocr-synthetic-${marker}`;
  const name = `documento-sintetico-${scenario}.${scenario === 'image' ? 'png' : 'pdf'}`;
  const type = scenario === 'image' ? 'image/png' : 'application/pdf';
  const attachmentResponse = await page.request.post('/api/attachments', {
    data: { id, patientId, name, type, size: bytes.byteLength, path: `uploads/${name}`,
      data: `data:${type};base64,${bytes.toString('base64')}` },
  });
  expect(attachmentResponse.ok()).toBe(true);
  await page.goto(`/patients/${patientId}/modules`);
  const archive = page.getByRole('button', { name: /Archivio documenti ed evidenze/ });
  await expect(archive).toBeVisible();
  await expect(async () => {
    if (await archive.getAttribute('aria-expanded') !== 'true') await archive.click();
    expect(await archive.getAttribute('aria-expanded')).toBe('true');
  }).toPass();
  return { id, name };
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
    const responsePromise = page.waitForResponse(response => response.request().method() === 'POST'
      && response.url().endsWith(`/api/attachments/${attachment.id}/local-extraction`));
    await page.getByRole('button', { name: `Estrai testo localmente da ${attachment.name}` }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const result = await response.json();
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
      await expect(page.getByText(/revisione manuale necessaria/).first()).toBeVisible();
    } else {
      expect(result).toMatchObject({ status: 'extracted', candidateUse: 'review_only' });
      await expect(preview).toBeVisible();
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
        await expect(preview).toContainText('OCR completato su questo Mac');
        await expect(preview).toContainText(`1 pagina su ${scenario === 'mixed' ? 2 : 1}`);
      }
      if (scenario === 'mixed') {
        expect(result.markdown).toMatch(/## Pagina 1[\s\S]*PRIMA PAGINA TESTUALE[\s\S]*## Pagina 2[\s\S]*ULTIMA PAGINA SCANSIONATA/);
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`${scenario}-synthetic.png`), fullPage: true });
  });
}
