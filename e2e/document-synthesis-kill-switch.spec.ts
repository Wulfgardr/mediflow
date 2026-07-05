/* @Codex */
import { Buffer } from 'node:buffer';
import { expect, test } from '@playwright/test';
import {
  bootstrapUnlockedSession,
  openAiFunzioniSettings,
  setAiLaneKillSwitch,
  waitForUnlockedInteractiveShell,
} from './utils';

const TEST_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9X8gAAAABJRU5ErkJggg==';

// WUL-274/Kree8 rewrite: with the Document Synthesis lane off, PdfImporter skips
// analyzeDocumentContent and the review enrichment entirely, so no request may reach
// /api/proxy/ollama/chat. OCR import stays available: the review flow still proposes
// the anagrafica fields, but without clinical candidates, and both surfaces show the
// honest disabled notes (document-synthesis-disabled-note on /patients/new,
// document-upload-synthesis-disabled-note on the created scheda).
test('document synthesis kill switch keeps OCR import available but disables clinical synthesis', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';
  const digits = `${Date.now()}`.slice(-5);
  const suffix = digits.slice(-3);
  const firstName = `Doc${suffix}`;
  const lastName = `Switch${suffix}`;
  const taxCode = `TSDDOC${digits.slice(0, 2)}A01H${digits.slice(2)}X`;
  let synthesisCalled = false;

  await page.route('**/api/ocr/extract', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        confidence: 0.96,
        data: {
          confidence: 0.96,
          firstName,
          lastName,
          taxCode,
          birthDate: '1980-01-01T00:00:00.000Z',
          address: 'Via Test 1, Roma',
          rawMarkdown: `Referto clinico\nPaziente: ${firstName} ${lastName}\nICD-11 EF00 - Disturbo depressivo maggiore, episodio singolo lieve`,
        },
      }),
    });
  });

  // Witness route: with the lane disabled this must never be reached.
  await page.route('**/api/proxy/ollama/chat', async (route) => {
    synthesisCalled = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                schemaVersion: 'mediflow.ai.extract.v1',
                task: 'document_synthesis',
                summary: 'Risposta che non deve mai essere richiesta.',
                data: {
                  qualityLevel: 'yellow',
                  qualityReason: 'Chiamata inattesa con kill switch attivo',
                  medications: [],
                  diagnoses: [],
                  problemStatements: [],
                  therapyCandidates: [],
                  servicePrescriptions: [],
                },
              }),
            },
          },
        ],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 80,
        },
      }),
    });
  });

  await bootstrapUnlockedSession(page, pin);

  try {
    // "Salva Configurazione" persists every AI lane switch from the page state, so
    // pin all three lanes to their suite-expected 'enabled' state first; the toggle
    // below then only flips document synthesis.
    await setAiLaneKillSwitch(page, 'aiPatientInsightKillSwitch', 'enabled');
    await setAiLaneKillSwitch(page, 'aiSmartImportKillSwitch', 'enabled');
    await setAiLaneKillSwitch(page, 'aiDocumentSynthesisKillSwitch', 'enabled');

    // WUL-297: kill switches live on the dedicated AI sub-route.
    await openAiFunzioniSettings(page);

    const killSwitch = page.getByRole('switch', { name: 'Document Synthesis locale' });
    await expect(killSwitch).toHaveAttribute('aria-checked', 'true');
    await killSwitch.click();
    await expect(killSwitch).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('document-synthesis-kill-switch-card')).toContainText('Spento');
    const saveButton = page.getByRole('button', { name: 'Salva Configurazione' });
    await saveButton.click();
    await expect(page.getByRole('button', { name: 'Salvataggio...' })).toHaveCount(0);
    await expect(saveButton).toBeEnabled();

    await page.goto('/patients/new');
    await expect(page.getByRole('heading', { name: 'Nuova scheda' })).toBeVisible();
    await expect(page.getByTestId('document-synthesis-disabled-note')).toBeVisible();

    const uploadInput = page.getByLabel('Carica documento');
    await uploadInput.setInputFiles({
      name: 'referto-kill-switch.png',
      mimeType: 'image/png',
      buffer: Buffer.from(TEST_PNG_BASE64, 'base64'),
    });

    // OCR still works: the review flow opens with the anagrafica proposals only.
    await expect(
      page.getByRole('heading', { name: 'Documento pronto: scegli cosa portare nella scheda' })
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Scegli cosa portare nella scheda', exact: true })).toBeVisible();
    await expect(page.getByTestId('document-synthesis-disabled-note')).toBeVisible();
    await expect(page.getByText('non contiene dati clinici abbastanza strutturati')).toBeVisible();
    await expect(page.locator(`input[value="${taxCode}"]`)).toBeVisible();
    // No clinical candidates without synthesis.
    await expect(page.getByRole('heading', { name: 'Diagnosi candidate' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Terapie candidate' })).toHaveCount(0);
    expect(synthesisCalled).toBe(false);

    await waitForUnlockedInteractiveShell(page);
    await page.getByRole('button', { name: 'Porta nella scheda' }).click();
    await expect(page.getByPlaceholder('RSSMRA80A01H501U')).toHaveValue(taxCode);

    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (response) => response.url().endsWith('/api/patients') && response.request().method() === 'POST',
        { timeout: 20_000 },
      ),
      page.getByRole('button', { name: 'Crea scheda' }).click(),
    ]);
    expect(createResponse.ok()).toBe(true);
    const created = await createResponse.json() as { id?: string };
    expect(created.id).toBeTruthy();

    // Post-create the cockpit lands on the home shell with the new patient selected
    // (/?area=turno&paziente=<id>): only require leaving the create form.
    await page.waitForURL((url) => !url.pathname.startsWith('/patients/new'), { timeout: 20_000 });

    // The scheda upload surface repeats the honest disabled note. The archive lives
    // in a collapsed section, so expand it before asserting.
    await page.goto(`/patients/${created.id}/modules`);
    await page.getByRole('button', { name: /Archivio documenti/ }).click();
    await expect(page.getByTestId('document-upload-synthesis-disabled-note')).toBeVisible({ timeout: 20_000 });
    expect(synthesisCalled).toBe(false);
  } finally {
    await setAiLaneKillSwitch(page, 'aiDocumentSynthesisKillSwitch', 'enabled');
  }
});
