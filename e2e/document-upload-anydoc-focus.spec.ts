import { expect, test, type Page, type Request } from '@playwright/test';

import { openDocumentActions, assertNoHorizontalOverflow, bootstrapUnlockedSession, openPatientSection } from './utils';
import { chooserReady, installKeyboardChooserObservation, keyboardChooserDecision, type KeyboardChooserSnapshot } from './anydoc-keyboard-chooser';

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
  const name = `allegato-anydoc-route-${suffix}.rtf`;
  await openDocumentArchive(page, patientId);
  const saved = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/attachments');
  await page.locator('#documenti input[type="file"]').setInputFiles({
    name, mimeType: 'application/rtf', buffer: Buffer.from(`{\\rtf1\\ansi ${SYNTHETIC_RTF_TEXT}}`),
  });
  const response = await saved;
  expect(response.ok()).toBe(true);
  const uploaded = response.request().postDataJSON() as { id: string; patientId: string; data: string };
  expect(uploaded.patientId).toBe(patientId);
  expect(uploaded.data).toMatch(/^ENC:/u);
  // Cold webpack compilation of the detail route reloads the in-memory grant broker.
  // Compile it before acquisition; the browser still performs its own authenticated read.
  const detail = await page.request.get(`/api/attachments/${uploaded.id}`);
  expect(detail.status()).toBe(200);
  expect((await detail.json() as { data: string }).data).toBe(uploaded.data);
  return { id: uploaded.id, name };
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

async function holdAttachmentList(page: Page, patientId: string) {
  let release!: () => void;
  let observed!: () => void;
  const blocked = new Promise<void>((resolve) => { observed = resolve; });
  const pending = new Promise<void>((resolve) => { release = resolve; });
  page.once('close', release);
  await page.route('**/api/attachments?**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET' && url.searchParams.get('patientId') === patientId
      && url.searchParams.get('metadata') === 'true') {
      observed();
      await pending;
    }
    await route.continue();
  });
  return { blocked, release };
}

test.describe.configure({ retries: 0 });

test('AnyDoc: le azioni allegato restano visibili al focus e sui viewport stretti', async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const browserMessages: { type: string; text: string }[] = [];
  await page.setViewportSize({ width: 1440, height: 900 });
  await establishSyntheticSession(page);

  // The deterministic login helper deliberately probes an already-locked state
  // and receives one expected 409. Observe only the AnyDoc surface under test.
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
    if (['warning', 'error'].includes(message.type()) && browserMessages.length < 20) {
      browserMessages.push({ type: message.type(), text: message.text().slice(0, 1000) });
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
    if (browserMessages.length < 20) browserMessages.push({ type: 'pageerror', text: error.message.slice(0, 1000) });
  });

  const patientId = await createSyntheticFixture(page);
  const initialList = await holdAttachmentList(page, patientId);
  await openDocumentArchive(page, patientId);
  await initialList.blocked;

  // one accessible chooser opens the native picker and Tab visits the viewer before local extraction.
  const chooser = page.getByRole('button', { name: 'Carica documenti', exact: true });
  await expect(chooser).toHaveCount(1);
  await expect(chooser).toBeVisible();
  await expect(chooser).toBeEnabled();
  await expect(chooser).toHaveAttribute('aria-disabled', 'false');
  await expect(chooser).toHaveAttribute('aria-busy', 'false');
  await expect(chooser).toHaveAttribute('tabindex', '0');
  const fileInput = chooser.locator('input[type="file"]');
  await expect(fileInput).toHaveCount(1);
  await expect(fileInput).toBeEnabled();
  await expect(fileInput).toHaveAttribute('tabindex', '-1');
  await chooser.focus();
  await expect(chooser).toBeFocused();

  // No locator.press/refocus: a later focus loss must remain a failure. Observe
  // the original root/input through the real Enter and the real native picker.
  const observation = await chooser.evaluateHandle(installKeyboardChooserObservation);
  const chooserProtocol = await page.context().newCDPSession(page);
  let keyboardSnapshot: KeyboardChooserSnapshot | null = null;
  let nativeEvent = false;
  let nativeInputMatches: boolean | null = null;
  let decision = 'OBSERVATION_NOT_READ';
  const failures: unknown[] = [];
  let gesture: Promise<void> | undefined;
  try {
    const initialSnapshot: KeyboardChooserSnapshot = await observation.evaluate((probe) => probe.snapshot());
    keyboardSnapshot = initialSnapshot;
    decision = !chooserReady(initialSnapshot.initial) ? 'PRECONDITION_NOT_READY'
      : !initialSnapshot.initial.rootFocused ? 'PRECONDITION_FOCUS_MISSING' : 'READY_FOR_ENTER';
    expect(chooserReady(initialSnapshot.initial), 'chooser readiness changed after focus').toBe(true);
    expect(initialSnapshot.initial.rootFocused, 'focus changed before Enter').toBe(true);
    const nativeWaiter = page.waitForEvent('filechooser').then((value) => { nativeEvent = true; return value; });
    gesture = (async () => {
      // Playwright 1.58.2 subscribes without awaiting Chromium's interception acknowledgement.
      await chooserProtocol.send('Page.setInterceptFileChooserDialog', { enabled: true });
      await page.keyboard.press('Enter');
      const afterEnter: KeyboardChooserSnapshot = await observation.evaluate((probe) => probe.snapshot());
      keyboardSnapshot = afterEnter;
      decision = keyboardChooserDecision(afterEnter);
      // Commit the discriminator before a native-event timeout can close the page.
      await testInfo.attach('anydoc-keyboard-activation', {
        body: Buffer.from(JSON.stringify({ decision, keyboardSnapshot, browserMessages })), contentType: 'application/json',
      });
      expect(decision, 'AnyDoc keyboard activation chain').toBe('AWAIT_NATIVE_CHOOSER');
    })();
    const [nativeChooser] = await Promise.all([nativeWaiter, gesture]);
    nativeInputMatches = await observation.evaluate((probe, input) => probe.isOriginalInput(input), nativeChooser.element());
    decision = nativeInputMatches ? 'NATIVE_INPUT_VERIFIED' : 'NATIVE_INPUT_MISMATCH';
    expect(nativeInputMatches, 'native chooser must belong to the observed file input').toBe(true);
    await nativeChooser.setFiles([]);
    decision = 'NATIVE_CHOOSER_VERIFIED';
  } catch (error) { failures.push(error); }
  // Join the SAME gesture promise before removing its observation, including
  // when the native waiter failed first. This never sends another key.
  try { await gesture; } catch (error) { if (!failures.includes(error)) failures.push(error); }
  // The test fixture owns the page. On a stage failure Promise.all observes
  // both rejections; Playwright removes it on timeout/page teardown.
  // Never replace a primary keyboard/chooser error with a cleanup/report error.
  try {
    if (!page.isClosed()) await observation.evaluate((probe) => probe.stop());
  } catch (error) { failures.push(error); }
  try { await observation.dispose(); } catch (error) { failures.push(error); }
  try { await chooserProtocol.detach(); } catch (error) { failures.push(error); }
  try {
    await testInfo.attach('anydoc-keyboard-chooser', {
      body: Buffer.from(JSON.stringify({ decision, nativeEvent, nativeInputMatches, keyboardSnapshot, browserMessages })),
      contentType: 'application/json',
    });
  } catch (error) { failures.push(error); }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'AnyDoc keyboard/chooser and cleanup/report failures', { cause: failures[0] });

  const list = page.getByRole('region', { name: 'Documenti caricati', exact: true });
  const loading = page.getByRole('status', { name: 'Stato elenco documenti', exact: true });
  try {
    await expect(list).toHaveAttribute('aria-busy', 'true');
    await expect(list.getByRole('button', { name: `Visualizza ${SYNTHETIC_ATTACHMENT_NAME}`, exact: true })).toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect(loading).toBeFocused();
    await expect(loading).toHaveText('Caricamento documenti…');
    await expect(loading).toHaveAttribute('aria-live', 'polite');
    expect(await loading.evaluate((element) => element.closest('[aria-busy="true"]') === null)).toBe(true);
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
  } finally {
    initialList.release();
  }
  const viewButton = page.getByRole('button', { name: `Visualizza ${SYNTHETIC_ATTACHMENT_NAME}`, exact: true });
  await expect(viewButton).toBeFocused();
  await expect(viewButton).toBeEnabled();
  await chooser.focus();
  await page.keyboard.press('Tab');

  await expect(viewButton).toBeFocused();
  await page.keyboard.press('Tab');

  const more = page.getByRole('button', { name: `Altro per ${SYNTHETIC_ATTACHMENT_NAME}`, exact: true });
  await expect(more).toBeFocused();
  await expect(page.getByRole('menuitem')).toHaveCount(0);
  await page.keyboard.press('ArrowDown');
  const menu = page.getByRole('menu', { name: `Azioni documento ${SYNTHETIC_ATTACHMENT_NAME}`, exact: true });
  let extractButton = menu.getByRole('menuitem', { name: `Estrai testo localmente da ${SYNTHETIC_ATTACHMENT_NAME}` });
  await expect(extractButton).toBeFocused();
  await expect(extractButton).toBeVisible();
  await expect(extractButton).toHaveAccessibleName(`Estrai testo localmente da ${SYNTHETIC_ATTACHMENT_NAME}`);
  let actionGroup = extractButton.locator('..');
  await page.mouse.move(0, 0);
  await expect(actionGroup).toHaveCSS('opacity', '1');
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: `Prepara sintesi di ${SYNTHETIC_ATTACHMENT_NAME}`, exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: `Elimina ${SYNTHETIC_ATTACHMENT_NAME}`, exact: true })).toBeFocused();
  await expect(menu.getByRole('separator')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  await expect(menu).toHaveCount(0);
  for (const key of ['Tab', 'Shift+Tab']) {
    await page.keyboard.press('ArrowDown');
    await expect(extractButton).toBeFocused();
    await page.keyboard.press(key);
    await expect(menu).toHaveCount(0);
    await expect(more).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(menu.getByRole('menuitem', { name: `Elimina ${SYNTHETIC_ATTACHMENT_NAME}`, exact: true })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(extractButton).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(menu.getByRole('menuitem', { name: `Elimina ${SYNTHETIC_ATTACHMENT_NAME}`, exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(extractButton).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(more).toBeFocused();
  }
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: `Eliminare il documento «${SYNTHETIC_ATTACHMENT_NAME}»?`, exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Annulla', exact: true }).click();
  await expect(more).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');
  await expect(menu).toHaveCount(0);
  await assertNoHorizontalOverflow(page, [
    { label: 'documento AnyDoc desktop', selector: 'document' },
    { label: 'card allegato AnyDoc desktop', selector: '[data-document-area="list"]' },
  ]);

  await page.setViewportSize({ width: 390, height: 844 });
  // resize the same open document pane, as the user does; reloading
  // would replace the UI whose responsive focus controls are being verified.
  await openPatientSection(page, 'documenti');
  await openDocumentActions(page, SYNTHETIC_ATTACHMENT_NAME);
  extractButton = page.getByRole('menuitem', { name: `Estrai testo localmente da ${SYNTHETIC_ATTACHMENT_NAME}` });
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

test('Documenti: il salvataggio sospeso espone un solo annuncio live', async ({ page }) => {
  await establishSyntheticSession(page);
  const patientId = await createSyntheticFixture(page);
  await openDocumentArchive(page, patientId);
  await expect(page.getByRole('button', { name: `Visualizza ${SYNTHETIC_ATTACHMENT_NAME}`, exact: true })).toBeEnabled();
  let release!: () => void;
  let observed!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const blocked = new Promise<void>((resolve) => { observed = resolve; });
  const writes: Request[] = [];
  page.once('close', release);
  await page.route('**/api/attachments', async (route) => {
    if (route.request().method() === 'POST') {
      writes.push(route.request());
      observed();
      await pending;
    }
    await route.continue();
  });
  try {
    await page.locator('#documenti input[type="file"]').setInputFiles({
      name: 'annuncio-live-sintetico.txt', mimeType: 'text/plain', buffer: Buffer.from('Documento sintetico.'),
    });
    await blocked;
    const liveRegions = page.locator('[role="status"], [role="alert"], [aria-live="polite"], [aria-live="assertive"]');
    await expect(liveRegions.filter({ hasText: 'Salvataggio allegati in corso…' })).toHaveCount(1);
    const status = page.getByRole('status', { name: 'Stato elenco documenti', exact: true });
    await expect(status).toHaveText('Salvataggio allegati in corso…');
    await page.getByRole('button', { name: 'Interrompi coda', exact: true }).click();
    await expect(liveRegions.filter({ hasText: 'Interruzione richiesta. Attesa dell’esito del file già inviato.' })).toHaveCount(1);
    await expect(status).toHaveText('Interruzione richiesta. Attesa dell’esito del file già inviato.');
  } finally {
    release();
  }
  await expect(page.getByRole('button', { name: 'Visualizza annuncio-live-sintetico.txt', exact: true })).toBeEnabled();
  await expect(page.getByText('1 allegato salvato.', { exact: false })).toBeVisible();
  expect(writes).toHaveLength(1);
});

for (const leaveStatus of [false, true]) {
  test(`Documenti: dopo la scelta del file ${leaveStatus ? 'rispetta il focus spostato dal medico' : 'mantiene il focus durante la rilettura e apre la nuova riga'}`, async ({ page }) => {
    await establishSyntheticSession(page);
    const patientId = await createSyntheticFixture(page);
    await openDocumentArchive(page, patientId);
    await expect(page.getByRole('button', { name: `Visualizza ${SYNTHETIC_ATTACHMENT_NAME}`, exact: true })).toBeEnabled();
    const refreshedList = await holdAttachmentList(page, patientId);
    const chooser = page.getByRole('button', { name: 'Carica documenti', exact: true });
    await chooser.focus();
    const protocol = await page.context().newCDPSession(page);
    const name = 'nuovo-documento-focus-sintetico.txt';
    try {
      const nativeWaiter = page.waitForEvent('filechooser');
      await protocol.send('Page.setInterceptFileChooserDialog', { enabled: true });
      await page.keyboard.press('Enter');
      const nativeChooser = await nativeWaiter;
      expect(await nativeChooser.element().evaluate((input) => input === document.querySelector('#documenti input[type="file"]'))).toBe(true);
      const saved = page.waitForResponse((response) => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/attachments');
      await nativeChooser.setFiles({ name, mimeType: 'text/plain', buffer: Buffer.from('Documento sintetico per il focus.') });
      expect((await saved).ok()).toBe(true);
      await refreshedList.blocked;
      const list = page.getByRole('region', { name: 'Documenti caricati', exact: true });
      const loading = page.getByRole('status', { name: 'Stato elenco documenti', exact: true });
      await expect(list).toHaveAttribute('aria-busy', 'true');
      await expect(loading).toBeFocused();
      await expect(loading).toHaveText('Caricamento documenti…');
      await expect(loading).toHaveAttribute('aria-live', 'polite');
      expect(await loading.evaluate((element) => element.closest('[aria-busy="true"]') === null)).toBe(true);
      await expect(page.getByRole('button', { name: `Visualizza ${name}`, exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
      if (leaveStatus) {
        await page.keyboard.press('Shift+Tab');
        await expect(chooser).toBeFocused();
      }
      refreshedList.release();
      const newDocument = page.getByRole('button', { name: `Visualizza ${name}`, exact: true });
      await expect(newDocument).toBeEnabled();
      await expect(leaveStatus ? chooser : newDocument).toBeFocused();
    } finally {
      refreshedList.release();
      await protocol.detach();
    }
  });
}

test('AnyDoc: il browser usa la route autenticata e mostra solo l’anteprima locale', async ({ page }, testInfo) => {
  await establishSyntheticSession(page);
  const patientId = await createSyntheticFixture(page);
  const writes: Request[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/attachments') writes.push(request);
  });
  const attachment = await createExtractableRtf(page, patientId);
  await openDocumentArchive(page, patientId);
  await expect(page.getByTestId('patient-profile-notes')).toContainText('Nessuna nota generale registrata.');

  const extractionActions: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === `/api/attachments/${attachment.id}/local-extraction`)
      extractionActions.push(request.headers()['x-mediflow-extraction-action']);
  });
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response.request().headers()['x-mediflow-extraction-action'] === 'project'
    && response.url().endsWith(`/api/attachments/${attachment.id}/local-extraction`)
  ));
  await openDocumentActions(page, attachment.name);
  await page.getByRole('menuitem', { name: `Estrai testo localmente da ${attachment.name}` }).click();

  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(response.url().endsWith(`/api/attachments/${attachment.id}/local-extraction`)).toBe(true);
  expect(response.request().headers()['x-mediflow-extraction-action']).toBe('project');
  expect(response.headers()['content-type']).toContain('application/json');

  const preview = page.getByTestId('anydoc-local-extraction-preview');
  await expect(preview).toBeVisible();
  // the receipt is reachable only after the client strictly validates the acquired grant,
  // current canonical source, response provenance/digest and review-only contract (client lines 233-247).
  // CDP response-body retrieval is unavailable in both CI and the packaged runtime.
  await preview.getByRole('button', { name: /Testo .*localmente/ }).click();
  await expect(preview.getByRole('button', { name: /Testo .*localmente/ })).toHaveText('Testo estratto localmente · da rivedere');
  await expect(preview.locator('pre')).toBeVisible();
  await expect(preview).toContainText(SYNTHETIC_RTF_TEXT);
  await expect(page.getByText('review_required · unsupported_local_extraction', { exact: false })).toHaveCount(0);
  expect(writes).toHaveLength(1);
  expect(writes[0].postDataJSON().id).toBe(attachment.id);
  expect(extractionActions).toEqual(['acquire', 'project']);
  await testInfo.attach('anydoc-single-submission', {
    body: Buffer.from(JSON.stringify({ attachmentWrites: writes.length, extractionActions, projectStatus: response.status() })),
    contentType: 'application/json',
  });
});

// native options must conceal filenames while preserving source identity.
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
