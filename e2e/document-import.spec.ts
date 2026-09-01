/* @Codex */
import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession, setAiLaneKillSwitch, waitForUnlockedInteractiveShell } from './utils';

const TEST_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9X8gAAAABJRU5ErkJggg==';

// WUL-274/Kree8 rewrite: drives the current assisted-import review flow on /patients/new.
// PdfImporter (OCR mock) -> document_synthesis via /api/proxy/ollama/chat (envelope
// mediflow.ai.extract.v1) -> local reconciliation (/api/icd/proxy + /api/drugs mocks) ->
// PatientDocumentImportReview ("Scegli cosa portare nella scheda" / "Porta nella scheda")
// -> PatientForm prefill -> "Crea scheda". The created patient id is taken from the
// POST /api/patients response, so the verification never re-finds by tax code.
test('document import review proposes extracted data and creates the scheda with them', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';
  const digits = `${Date.now()}`.slice(-5);
  const suffix = digits.slice(-3);
  const firstName = `Smoke${suffix}`;
  const lastName = `Import${suffix}`;
  // Valid codice fiscale shape; five timestamp digits keep reruns on a persistent
  // e2e DB from colliding with previously created patients.
  const taxCode = `TSTDOC${digits.slice(0, 2)}A01H${digits.slice(2)}X`;
  const diagnosisLabel = 'Diabete mellito tipo 2';
  let synthesisCalled = false;

  // Local OCR endpoint: the same payload serves both 'patient' and 'full' modes.
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
          rawMarkdown: `Referto clinico\nPaziente: ${firstName} ${lastName}\nICD-11 5A11 - ${diagnosisLabel}\nTerapia alla dimissione: Humalog 4 U ai pasti principali`
        }
      })
    });
  });

  // Governed ICD-11 resolution used by the review enrichment for problemStatements.
  await page.route('**/api/icd/proxy**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 'mediflow.reference-data.icd11-search-response.v1',
        entries: [
          {
            code: '5A11',
            description: diagnosisLabel,
            system: 'ICD-11',
          },
        ],
        receipt: {
          schemaVersion: 'mediflow.reference-data.icd11-search-receipt.v1',
          operation: 'mediflow.reference_data.icd11.search.v1',
          releaseId: '2026-01',
          language: 'en',
          source: 'live',
          resultCount: 1,
          latencyMs: 1,
          completedAt: '2027-01-15T08:00:00.000Z',
        },
      }),
    });
  });

  // Local AIFA catalog used to reconcile therapy candidates.
  await page.route('**/api/drugs**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          aic: '012345678',
          name: 'Humalog KwikPen',
          activePrinciple: 'Insulina lispro',
          packaging: '100 U/mL penna preriempita',
          atc: 'A10AB04',
          company: 'Test Pharma',
        },
      ]),
    });
  });

  // document_synthesis contract: the prompt embeds the JSON envelope template with
  // Fabric health probe: getHealth() -> listModels() -> /api/ai/models. Without
  // this stub the admission outcome would depend on whether a local Ollama
  // daemon happens to run on the host executing the suite.
  await page.route('**/api/ai/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ models: [{ name: 'qwen3.5:35b-a3b' }] }),
    });
  });

  // "task": "document_synthesis"; the reply must carry the same envelope
  // (schemaVersion mediflow.ai.extract.v1) with data.{qualityLevel,qualityReason,
  // medications,diagnoses,problemStatements,therapyCandidates,servicePrescriptions}.
  // AIService accepts both native Ollama and OpenAI-style bodies; we answer OpenAI-style.
  await page.route('**/api/proxy/ollama/chat', async (route) => {
    synthesisCalled = true;
    const request = route.request();
    const body = JSON.parse(request.postData() || '{}');
    const prompt = body?.messages?.[0]?.content || '';
    const isDocumentSynthesis = typeof prompt === 'string' && prompt.includes('"task": "document_synthesis"');

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
                summary: isDocumentSynthesis
                  ? 'Diabete mellito tipo 2 con terapia insulinica documentata.'
                  : 'Fallback',
                data: isDocumentSynthesis
                  ? {
                      qualityLevel: 'green',
                      qualityReason: 'Documento leggibile con codice ICD esplicito',
                      medications: ['Humalog 4 U ai pasti principali'],
                      diagnoses: [
                        {
                          code: '5A11',
                          description: diagnosisLabel,
                          system: 'ICD-11',
                          evidence: 'ICD-11 5A11',
                          confidence: 'high',
                        },
                      ],
                      problemStatements: [
                        {
                          label: diagnosisLabel,
                          icdQuery: 'type 2 diabetes mellitus',
                          confidence: 'high',
                          evidence: 'ICD-11 5A11',
                        },
                      ],
                      therapyCandidates: [
                        {
                          drugMention: 'Humalog',
                          drugQuery: 'insulina lispro',
                          activePrinciple: 'Insulina lispro',
                          dosage: '4 U ai pasti principali',
                          confidence: 'high',
                          evidence: 'Terapia alla dimissione: Humalog 4 U ai pasti principali',
                          therapyState: 'active',
                        },
                      ],
                      servicePrescriptions: [],
                    }
                  : {
                      qualityLevel: 'yellow',
                      qualityReason: 'Fallback inatteso',
                      medications: [],
                      diagnoses: [],
                      problemStatements: [],
                      therapyCandidates: [],
                      servicePrescriptions: [],
                    },
              })
            }
          }
        ],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 80
        }
      })
    });
  });

  await bootstrapUnlockedSession(page, pin);

  // The document synthesis lane is fail-closed: on a fresh e2e DB the setting is
  // absent, which counts as disabled. Enable it explicitly; the suite convention
  // (see the smart-import specs) is that lanes stay 'enabled' after the specs run.
  await setAiLaneKillSwitch(page, 'aiDocumentSynthesisKillSwitch', 'enabled');

  // PdfImporter reads the kill switch through a live query on mount: wait for that
  // settings read to land (plus hydration) before uploading, otherwise the drop
  // handler can still run with the fail-closed default and skip the synthesis.
  const killSwitchSettled = page.waitForResponse((response) =>
    response.url().includes('/api/settings/aiDocumentSynthesisKillSwitch')
    && response.request().method() === 'GET'
  );
  await page.goto('/patients/new');

  await expect(page.getByRole('heading', { name: 'Nuova scheda' })).toBeVisible();
  await killSwitchSettled;
  await waitForUnlockedInteractiveShell(page);
  await expect(page.getByTestId('document-synthesis-disabled-note')).toHaveCount(0);

  const uploadInput = page.getByLabel('Carica documento');
  await uploadInput.setInputFiles({
    name: 'referto-import.png',
    mimeType: 'image/png',
    buffer: Buffer.from(TEST_PNG_BASE64, 'base64')
  });

  // The review flow surfaces both the status alert and the review panel.
  await expect(
    page.getByRole('heading', { name: 'Documento pronto: scegli cosa portare nella scheda' })
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Scegli cosa portare nella scheda', exact: true })).toBeVisible();
  // Witness route: with the lane enabled the synthesis endpoint must genuinely be hit.
  expect(synthesisCalled).toBe(true);

  // Reconciled proposals: one AIFA-matched therapy card and one coded diagnosis card.
  await expect(page.getByPlaceholder('Nome farmaco')).toHaveValue('Humalog KwikPen');
  await expect(page.getByPlaceholder('Posologia')).toHaveValue('4 U ai pasti principali');
  await expect(page.locator('input[value="5A11"]')).toBeVisible();
  await expect(page.locator(`input[value="${diagnosisLabel}"]`)).toBeVisible();

  await waitForUnlockedInteractiveShell(page);
  await page.getByRole('button', { name: 'Porta nella scheda' }).click();

  // The reviewed defaults land in the patient form.
  await expect(page.getByPlaceholder('RSSMRA80A01H501U')).toHaveValue(taxCode);
  await expect(page.getByPlaceholder('Es. 8A80.0')).toHaveValue('5A11');
  await expect(page.getByPlaceholder('Cerca diagnosi (ICD-11 Official - English)')).toHaveValue(
    `5A11 - ${diagnosisLabel}`
  );

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

  // The created Scheda renders the reviewed fields through the current semantic
  // Quadro region. Assert the distinct accessible nodes rather than the obsolete
  // combined text node, so both the diagnosis and the structured therapy must persist.
  await page.goto(`/patients/${created.id}/modules`);
  const quadro = page.getByRole('region', {
    name: 'Baseline e dati verificabili',
    exact: true,
  });
  await expect(quadro).toHaveCount(1);
  await expect(quadro.getByText('5A11', { exact: true })).toHaveCount(1);
  await expect(quadro.getByText(diagnosisLabel, { exact: true })).toHaveCount(1);
  await expect(quadro.getByText('ICD-11', { exact: true })).toHaveCount(1);

  const reviewedTherapy = quadro.getByRole('listitem').filter({
    has: page.getByText('Humalog KwikPen', { exact: true }),
  });
  await expect(reviewedTherapy).toHaveCount(1);
  await expect(reviewedTherapy.getByText('Humalog KwikPen', { exact: true })).toBeVisible();
  await expect(reviewedTherapy.getByText('4 U ai pasti principali', { exact: true })).toBeVisible();
});
