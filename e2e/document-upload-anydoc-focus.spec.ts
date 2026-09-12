/* @Codex */
import { expect, test, type Page } from '@playwright/test';

import { assertNoHorizontalOverflow, bootstrapUnlockedSession, openPatientSection } from './utils';

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
  await openPatientSection(page, 'documenti');
  await expect(page.locator('#documenti').getByRole('heading', { name: /Archivio documenti ed evidenze/ })).toBeVisible();
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

  // @Codex: one accessible chooser opens the native picker and Tab visits the viewer before local extraction.
  const chooser = page.getByRole('button', { name: 'Carica documenti', exact: true });
  await expect(chooser).toHaveCount(1);
  await chooser.focus();
  const nativeChooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await nativeChooser).setFiles([]);
  await chooser.focus();
  await page.keyboard.press('Tab');

  await expect(page.getByRole('button', { name: `Visualizza ${SYNTHETIC_ATTACHMENT_NAME}`, exact: true })).toBeFocused();
  await page.keyboard.press('Tab');

  let extractButton = page.getByRole('button', { name: `Estrai testo localmente da ${SYNTHETIC_ATTACHMENT_NAME}` });
  await expect(extractButton).toBeFocused();
  await expect(extractButton).toBeVisible();
  await expect(extractButton).toHaveAccessibleName(`Estrai testo localmente da ${SYNTHETIC_ATTACHMENT_NAME}`);
  let actionGroup = extractButton.locator('..');
  await page.mouse.move(0, 0);
  // @Codex: named document actions remain visible before pointer or keyboard focus.
  await expect(actionGroup).toHaveCSS('opacity', '1');

  await extractButton.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: `Prepara sintesi di ${SYNTHETIC_ATTACHMENT_NAME}`, exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: `Elimina ${SYNTHETIC_ATTACHMENT_NAME}`, exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(extractButton).toBeFocused();
  await expect(actionGroup).toHaveCSS('opacity', '1');
  await assertNoHorizontalOverflow(page, [
    { label: 'documento AnyDoc desktop', selector: 'document' },
    { label: 'card allegato AnyDoc desktop', selector: '[data-document-area="list"]' },
  ]);

  await page.setViewportSize({ width: 390, height: 844 });
  // @Codex: resize the same open document pane, as the user does; reloading
  // would replace the UI whose responsive focus controls are being verified.
  await openPatientSection(page, 'documenti');
  extractButton = page.getByRole('button', { name: `Estrai testo localmente da ${SYNTHETIC_ATTACHMENT_NAME}` });
  actionGroup = extractButton.locator('..');
  await page.mouse.move(0, 0);
  await expect(actionGroup).toHaveCSS('opacity', '1');
  await expect(extractButton).toHaveAccessibleName(`Estrai testo localmente da ${SYNTHETIC_ATTACHMENT_NAME}`);
  await assertNoHorizontalOverflow(page, [
    { label: 'documento AnyDoc mobile', selector: 'document' },
    { label: 'card allegato AnyDoc mobile', selector: '[data-document-area="list"]' },
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
  await preview.locator('summary').click();
  await expect(preview.locator('summary')).toHaveText('Testo estratto localmente · da rivedere');
  await expect(preview.locator('pre')).toBeVisible();
  await expect(preview).toContainText(SYNTHETIC_RTF_TEXT);
  await expect(page.getByText('review_required · unsupported_local_extraction', { exact: false })).toHaveCount(0);
});

// @Codex: native options must conceal filenames while preserving source identity.
test('Documenti: privacy nasconde i nomi nel selettore prima e dopo la scelta', async ({ page }) => {
  await establishSyntheticSession(page);
  const patientId = await createSyntheticFixture(page);
  await openDocumentArchive(page, patientId);
  const toggle = page.getByTestId('privacy-mode-header-toggle').first();
  if (await toggle.getAttribute('aria-pressed') === 'true') await toggle.click();
  const selector = page.getByLabel('Documento da sintetizzare');
  const sourceId = await selector.locator('option').nth(1).getAttribute('value');
  expect(sourceId).toBeTruthy();
  await toggle.click();
  await expect(selector.locator('option').nth(1)).toHaveText('Documento 1');
  await selector.selectOption(sourceId!);
  await expect(selector).toHaveValue(sourceId!);
  await expect(selector.locator('option:checked')).toHaveText('Documento 1');
  await toggle.click();
  await expect(selector.locator('option:checked')).toHaveText(SYNTHETIC_ATTACHMENT_NAME);
  await toggle.click();
  await expect(selector.locator('option:checked')).toHaveText('Documento 1');
  await expect(selector).toHaveValue(sourceId!);
  await toggle.click();
});
