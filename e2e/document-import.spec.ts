/* @Codex */
import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

const TEST_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9X8gAAAABJRU5ErkJggg==';

test('document import reconciles diagnoses and therapies before patient creation', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';
  const suffix = `${Date.now()}`.slice(-3);
  const firstName = `Smoke${suffix}`;
  const lastName = `Import${suffix}`;
  const taxCode = `TSTDOC80A01H${suffix}X`;
  const diagnosisLabel = 'Disturbo depressivo maggiore, episodio singolo lieve';

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
          rawMarkdown: `Referto clinico\nPaziente: ${firstName} ${lastName}\nICD-11 EF00 - ${diagnosisLabel}\nTerapia domiciliare: Lasix 25 mg 1 cp al mattino`
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
            theCode: 'EF00',
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
          name: 'Lasix 25 mg compresse',
          activePrinciple: 'Furosemide',
          packaging: '25 mg 30 compresse',
          atc: 'C03CA01',
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
                      summary: 'Episodio depressivo lieve con terapia diuretica domiciliare.',
                      data: {
                        qualityLevel: 'green',
                        qualityReason: 'Documento leggibile con codice ICD esplicito',
                        medications: ['Lasix 25 mg 1 cp al mattino'],
                        diagnoses: [
                          {
                            code: 'EF00',
                            description: diagnosisLabel,
                            system: 'ICD-11',
                            evidence: 'ICD-11 EF00',
                            confidence: 'high',
                          },
                        ],
                        problemStatements: [
                          {
                            label: diagnosisLabel,
                            icdQuery: 'major depressive disorder mild single episode',
                            confidence: 'high',
                            evidence: 'ICD-11 EF00',
                          },
                        ],
                        therapyCandidates: [
                          {
                            drugMention: 'Lasix',
                            drugQuery: 'furosemide',
                            activePrinciple: 'Furosemide',
                            dosage: '25 mg 1 cp al mattino',
                            confidence: 'high',
                            evidence: 'Lasix 25 mg 1 cp al mattino',
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
  await expect(page.locator('input[value="Lasix 25 mg compresse"]').first()).toBeVisible();
  await expect(page.locator('input[value="25 mg 1 cp al mattino"]').first()).toBeVisible();

  await page.getByRole('button', { name: 'Applica al form' }).click();

  await expect(page.getByPlaceholder('RSSMRA80A01H501U')).toHaveValue(taxCode);
  await expect(page.getByPlaceholder('Es. 8A80.0').first()).toHaveValue('EF00');
  await expect(page.getByPlaceholder('Cerca diagnosi (ICD-11 Official - English)').first()).toHaveValue(
    `EF00 - ${diagnosisLabel}`
  );

  await page.getByRole('button', { name: 'Crea Nuova Scheda' }).click();

  await expect(page).toHaveURL(/\/$/);
  const search = page.getByPlaceholder('Cerca paziente...');
  await search.fill(lastName);
  await expect(page.getByText(new RegExp(`${lastName} ${firstName}`))).toBeVisible();
  await page.getByText(new RegExp(`${lastName} ${firstName}`)).click();

  await expect(page).toHaveURL(/\/patients\/.+/);
  await expect(page.getByText(/EF00/)).toBeVisible();
  await expect(page.getByText(diagnosisLabel)).toBeVisible();
  await expect(page.getByText('Lasix 25 mg compresse')).toBeVisible();
  await expect(page.getByText('25 mg 1 cp al mattino')).toBeVisible();
});
