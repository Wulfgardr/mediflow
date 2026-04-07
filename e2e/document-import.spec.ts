/* @Codex */
import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession, waitForUnlockedInteractiveShell } from './utils';

const TEST_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9X8gAAAABJRU5ErkJggg==';

test('document import reconciles diagnoses and therapies before patient creation', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';
  const suffix = `${Date.now()}`.slice(-3);
  const firstName = `Smoke${suffix}`;
  const lastName = `Import${suffix}`;
  const taxCode = `TSTDOC80A01H${suffix}X`;
  const diagnosisLabel = 'Diabete mellito tipo 2';

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

  await page.route('**/api/icd/proxy**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        destinationEntities: [
          {
            theCode: '5A11',
            title: diagnosisLabel,
          },
        ],
      }),
    });
  });

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

  await page.route('**/api/proxy/ollama/chat', async (route) => {
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
                ...(isDocumentSynthesis
                  ? {
                      schemaVersion: 'mediflow.ai.extract.v1',
                      task: 'document_synthesis',
                      summary: 'Diabete mellito tipo 2 con terapia insulinica documentata.',
                      data: {
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
                      },
                    }
                  : {
                      schemaVersion: 'mediflow.ai.extract.v1',
                      task: 'document_synthesis',
                      summary: 'Fallback',
                      data: {
                        qualityLevel: 'yellow',
                        qualityReason: 'Fallback inatteso',
                        medications: [],
                        diagnoses: [],
                        problemStatements: [],
                        therapyCandidates: [],
                      },
                    }),
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
  await page.goto('/patients/new');

  await expect(page.getByRole('heading', { name: /Nuova (Anagrafica|Paziente)/ })).toBeVisible();

  const uploadInput = page.getByLabel('Carica documento');
  await uploadInput.setInputFiles({
    name: 'referto-import.png',
    mimeType: 'image/png',
    buffer: Buffer.from(TEST_PNG_BASE64, 'base64')
  });

  await expect(page.getByRole('heading', { name: 'Importazione assistita pronta per review' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Conferma cosa applicare al form' })).toBeVisible();
  await expect(page.locator('input[value="Humalog KwikPen"]').first()).toBeVisible();
  await expect(page.locator('input[value="4 U ai pasti principali"]').first()).toBeVisible();
  await waitForUnlockedInteractiveShell(page);

  await page.getByRole('button', { name: 'Applica al form' }).click();

  await expect(page.getByPlaceholder('RSSMRA80A01H501U')).toHaveValue(taxCode);
  await expect(page.getByPlaceholder('Es. 8A80.0').first()).toHaveValue('5A11');
  await expect(page.getByPlaceholder('Cerca diagnosi (ICD-11 Official - English)').first()).toHaveValue(
    `5A11 - ${diagnosisLabel}`
  );

  await page.getByRole('button', { name: 'Crea Nuova Scheda' }).click();

  await expect(page).toHaveURL(/\/$/);
  const search = page.getByPlaceholder('Cerca paziente...');
  await search.fill(lastName);
  const patientLink = page.getByRole('link', { name: new RegExp(`${lastName} ${firstName}`) }).first();
  await expect(patientLink).toBeVisible();
  await waitForUnlockedInteractiveShell(page);
  await Promise.all([
    page.waitForURL(/\/patients\/.+/, { timeout: 20_000 }),
    patientLink.click(),
  ]);

  await expect(page.getByText('Caricamento cartella paziente...')).toBeHidden({ timeout: 20_000 });
  await expect(page.getByText(/5A11/)).toBeVisible();
  await expect(page.getByText(diagnosisLabel)).toBeVisible();
  await expect(page.getByText('Humalog KwikPen')).toBeVisible();
  await expect(page.getByText('4 U ai pasti principali')).toBeVisible();
});
