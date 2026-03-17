/* @Codex */
import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

function buildSmartImportPayload() {
  return {
    diagnoses: [
      {
        label: 'Ipertensione arteriosa essenziale',
        description: 'Ipertensione arteriosa essenziale',
        query: 'essential hypertension',
        searchQuery: 'essential hypertension',
        icdQuery: 'essential hypertension',
        evidence: 'Nota globale: ipertensione arteriosa essenziale in trattamento cronico.',
        confidence: 'high'
      }
    ],
    therapies: [
      {
        drugMention: 'Furosemide',
        name: 'Furosemide',
        query: 'furosemide',
        drugQuery: 'furosemide',
        activePrinciple: 'Furosemide',
        dosage: '25 mg 1 cp al mattino',
        motivation: 'Terapia cronica riportata nelle note',
        evidence: 'Nota globale: Furosemide 25 mg 1 cp al mattino.',
        confidence: 'high'
      }
    ]
  };
}

test('smart import adds ICD diagnosis chips and therapy from patient notes after operator review', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';
  const suffix = `${Date.now()}`.slice(-4);
  const firstName = `Smart${suffix}`;
  const lastName = `Import${suffix}`;
  const taxCode = `SMRTPT80A01H${suffix}`;
  const patientNotes = [
    'Anamnesi: ipertensione arteriosa essenziale in trattamento cronico.',
    'Terapia domiciliare: Furosemide 25 mg 1 cp al mattino.'
  ].join(' ');

  await page.route('**/api/proxy/ai/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(buildSmartImportPayload())
            }
          }
        ],
        usage: {
          prompt_tokens: 180,
          completion_tokens: 120
        }
      })
    });
  });

  await page.route('**/api/icd/proxy?q=*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        destinationEntities: [
          {
            theCode: 'BA00',
            title: 'Essential hypertension'
          }
        ]
      })
    });
  });

  await page.route('**/api/drugs?q=*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          aic: '012345678',
          name: 'Furosemide Sandoz',
          activePrinciple: 'Furosemide',
          company: 'Sandoz',
          packaging: '25 mg compresse',
          atc: 'C03CA01'
        }
      ])
    });
  });

  await bootstrapUnlockedSession(page, pin);
  await page.goto('/patients/new');

  await expect(page.getByRole('heading', { name: 'Nuovo Paziente' })).toBeVisible();
  await page.getByPlaceholder('Mario').fill(firstName);
  await page.getByPlaceholder('Rossi').fill(lastName);
  await page.getByPlaceholder('RSSMRA80A01H501U').fill(taxCode);
  await page.getByPlaceholder('Informazioni aggiuntive, contesto sociale, codici accesso...').fill(patientNotes);
  await page.getByRole('button', { name: 'Crea Paziente' }).click();

  await expect(page).toHaveURL(/\/$/);

  const search = page.getByPlaceholder('Cerca per nome, cognome o codice fiscale...');
  await search.fill(lastName);
  await page.getByText(new RegExp(`${lastName} ${firstName}`)).click();

  await expect(page.getByRole('button', { name: 'Genera suggerimenti smart' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Genera suggerimenti smart' }).click();

  await expect(page.getByText('Ipertensione arteriosa essenziale')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('ICD-11 BA00 · Essential hypertension')).toBeVisible();
  await expect(page.getByText('Furosemide Sandoz')).toBeVisible();
  await page.getByRole('button', { name: 'Applica selezionati' }).click();

  await expect(page.getByText('Import completato: 1 diagnosi, 1 terapie.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('ICD-11 BA00 · Essential hypertension')).toBeVisible();
  await expect(page.getByText('Furosemide Sandoz')).toBeVisible();
});
