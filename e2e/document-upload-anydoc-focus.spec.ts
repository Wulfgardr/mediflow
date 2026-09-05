/* @Codex */
import { expect, test, type Page } from '@playwright/test';

import { assertNoHorizontalOverflow, bootstrapUnlockedSession } from './utils';

const SYNTHETIC_ATTACHMENT_NAME = 'allegato-anydoc-focus-sintetico.pdf';
const SYNTHETIC_RTF_TEXT = 'Synthetic AnyDoc browser route evidence.';

async function createSyntheticFixture(page: Page): Promise<string> {
  const marker = `${Date.now()}`.slice(-8);
  return page.evaluate(async ({ attachmentName, suffix }) => {
    const patientResponse = await fetch('/api/patients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: `Focus${suffix.slice(0, 4)}`,
        lastName: `AnyDoc${suffix.slice(4)}`,
        taxCode: `FCS${suffix.padStart(13, '0')}`,
        birthDate: '1975-01-01T00:00:00.000Z',
        address: 'Indirizzo sintetico AnyDoc focus',
        phone: '0000000085',
        diagnoses: [],
      }),
    });
    if (!patientResponse.ok) throw new Error(`Fixture paziente AnyDoc focus: HTTP ${patientResponse.status}`);
    const patientId = (await patientResponse.json() as { id: string }).id;

    const attachmentResponse = await fetch('/api/attachments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: `attachment-anydoc-focus-${suffix}`,
        patientId,
        name: attachmentName,
        type: 'application/pdf',
        size: 24,
        path: `uploads/${attachmentName}`,
        data: 'data:application/pdf;base64,JVBERi0xLjQ=',
        ocrQueueState: 'pending',
        ocrQueueReason: 'text_layer_absent',
      }),
    });
    if (!attachmentResponse.ok) throw new Error(`Fixture allegato AnyDoc focus: HTTP ${attachmentResponse.status}`);
    return patientId;
  }, { attachmentName: SYNTHETIC_ATTACHMENT_NAME, suffix: marker });
}

async function createExtractableRtf(page: Page, patientId: string): Promise<Readonly<{ id: string; name: string }>> {
  const suffix = `${Date.now()}`.slice(-8);
  return page.evaluate(async ({ id, marker, expectedText }) => {
    const attachmentId = `attachment-anydoc-route-${marker}`;
    const name = `allegato-anydoc-route-${marker}.rtf`;
    const source = `{\\rtf1\\ansi ${expectedText}}`;
    const response = await fetch('/api/attachments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: attachmentId,
        patientId: id,
        name,
        type: 'application/rtf',
        size: new TextEncoder().encode(source).byteLength,
        path: `uploads/${name}`,
        data: `data:application/rtf;base64,${btoa(source)}`,
      }),
    });
    if (!response.ok) throw new Error(`Fixture RTF AnyDoc: HTTP ${response.status}`);
    return { id: attachmentId, name };
  }, { id: patientId, marker: suffix, expectedText: SYNTHETIC_RTF_TEXT });
}

async function establishSyntheticSession(page: Page): Promise<void> {
  const pin = process.env.E2E_PIN || '1234';
  await bootstrapUnlockedSession(page, pin);
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

test.describe.configure({ retries: 0 });

test('AnyDoc: le azioni allegato restano visibili al focus e sui viewport stretti', async ({ page }) => {
  const consoleErrors: string[] = [];
  await page.setViewportSize({ width: 1440, height: 900 });
  await establishSyntheticSession(page);

  // The deterministic login helper deliberately probes an already-locked state
  // and receives one expected 409. Observe only the AnyDoc surface under test.
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  const patientId = await createSyntheticFixture(page);
  await openDocumentArchive(page, patientId);

  let extractButton = page.getByRole('button', { name: `Estrai testo localmente da ${SYNTHETIC_ATTACHMENT_NAME}` });
  await expect(extractButton).toBeVisible();
  await expect(extractButton).toHaveAccessibleName(`Estrai testo localmente da ${SYNTHETIC_ATTACHMENT_NAME}`);
  let actionGroup = extractButton.locator('..');
  await page.mouse.move(0, 0);
  await expect(actionGroup).toHaveCSS('opacity', '0');

  await extractButton.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(extractButton).toBeFocused();
  await expect(actionGroup).toHaveCSS('opacity', '1');
  await assertNoHorizontalOverflow(page, [
    { label: 'documento AnyDoc desktop', selector: 'document' },
    { label: 'card allegato AnyDoc desktop', selector: '.lume-card:has(button[aria-label^="Estrai testo localmente da"])' },
  ]);

  await page.setViewportSize({ width: 390, height: 844 });
  await openDocumentArchive(page, patientId);
  extractButton = page.getByRole('button', { name: `Estrai testo localmente da ${SYNTHETIC_ATTACHMENT_NAME}` });
  actionGroup = extractButton.locator('..');
  await page.mouse.move(0, 0);
  await expect(actionGroup).toHaveCSS('opacity', '1');
  await expect(extractButton).toHaveAccessibleName(`Estrai testo localmente da ${SYNTHETIC_ATTACHMENT_NAME}`);
  await assertNoHorizontalOverflow(page, [
    { label: 'documento AnyDoc mobile', selector: 'document' },
    { label: 'card allegato AnyDoc mobile', selector: '.lume-card:has(button[aria-label^="Estrai testo localmente da"])' },
  ]);
  expect(consoleErrors).toEqual([]);
});

test('AnyDoc: il browser usa la route autenticata e mostra solo l’anteprima locale', async ({ page }) => {
  await establishSyntheticSession(page);
  const patientId = await createSyntheticFixture(page);
  const attachment = await createExtractableRtf(page, patientId);
  await openDocumentArchive(page, patientId);

  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response.url().endsWith(`/api/attachments/${attachment.id}/local-extraction`)
  ));
  await page.getByRole('button', { name: `Estrai testo localmente da ${attachment.name}` }).click();

  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const body = await response.json() as {
    provenance?: { attachmentId?: string };
    status?: string;
    review?: string;
    writes?: number;
    apply?: string;
    candidateUse?: string;
  };
  expect(body).toMatchObject({
    provenance: { attachmentId: attachment.id },
    status: 'extracted',
    review: 'required',
    writes: 0,
    apply: 'none',
    candidateUse: 'review_only',
  });

  const preview = page.getByTestId('anydoc-local-extraction-preview');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('Anteprima AnyDoc locale · sola lettura');
  await expect(preview).toContainText(SYNTHETIC_RTF_TEXT);
  await expect(page.getByText('review_required · unsupported_local_extraction', { exact: false })).toHaveCount(0);
});
