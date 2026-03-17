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

function buildMultiTherapyPayload() {
  return {
    diagnoses: [],
    therapies: [
      {
        drugMention: 'Forxiga 10 mg',
        drugQuery: 'Forxiga',
        activePrinciple: 'Dapagliflozin',
        dosage: '10 mg 1 cp al mattino',
        motivation: 'Diabete mellito tipo 2',
        therapyState: 'active',
        confidence: 'high',
        evidence: 'Forxiga 10 mg 1 cp al mattino.',
        sourceId: 'patient-notes'
      },
      {
        drugMention: 'Slowmet 1000 mg',
        drugQuery: 'Slowmet',
        activePrinciple: 'Metformina',
        dosage: '1000 mg 1 cp x 2',
        motivation: 'Diabete mellito tipo 2',
        therapyState: 'active',
        confidence: 'high',
        evidence: 'Slowmet 1000 mg 1 cp x 2.',
        sourceId: 'patient-notes'
      },
      {
        drugMention: 'Esapent 1000',
        drugQuery: 'Esapent 1000',
        activePrinciple: 'Omega-3-acid ethyl esters',
        dosage: '1000 mg 1 cps x 2',
        motivation: 'Ipertrigliceridemia',
        therapyState: 'active',
        confidence: 'medium',
        evidence: 'Esapent 1000 mg 1 cps x 2.',
        sourceId: 'patient-notes'
      },
      {
        drugMention: 'Bisoprololo',
        drugQuery: 'Bisoprololo',
        activePrinciple: 'Bisoprololo',
        dosage: '1,25 mg',
        motivation: 'Beta-bloccante in switch',
        therapyState: 'transition',
        reviewNote: 'Transizione beta-bloccante da confermare prima dell\'import',
        confidence: 'medium',
        evidence: 'Bisoprololo 1,25 mg in sospensione con passaggio a nebivololo.',
        sourceId: 'patient-notes'
      },
      {
        drugMention: 'Nebivololo',
        drugQuery: 'Nebivololo',
        activePrinciple: 'Nebivololo',
        dosage: '5 mg 1 cp',
        motivation: 'Nuovo beta-bloccante in corso di switch',
        therapyState: 'transition',
        reviewNote: 'Nuovo beta-bloccante durante switch terapeutico',
        confidence: 'medium',
        evidence: 'Passaggio a nebivololo 5 mg 1 cp da confermare.',
        sourceId: 'patient-notes'
      },
      {
        drugMention: 'Furosemide',
        drugQuery: 'Furosemide',
        activePrinciple: 'Furosemide',
        dosage: 'dose da verificare',
        motivation: 'Edemi declivi',
        therapyState: 'uncertain',
        reviewNote: 'Posologia riportata come da verificare',
        confidence: 'low',
        evidence: 'Furosemide: dose da verificare.',
        sourceId: 'patient-notes'
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

test('smart import keeps transition and uncertain therapies visible without truncating multi-therapy notes', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';
  const suffix = `${Date.now()}`.slice(-4);
  const firstName = `Therapy${suffix}`;
  const lastName = `Matrix${suffix}`;
  const taxCode = `THRMTR80A01H${suffix}`;
  const patientNotes = [
    'Terapia domiciliare: Forxiga 10 mg 1 cp al mattino; Slowmet 1000 mg 1 cp x 2; Esapent 1000 mg 1 cps x 2.',
    'Beta-bloccante in transizione: sospendere bisoprololo 1,25 mg e passare a nebivololo 5 mg 1 cp.',
    'Furosemide: dose da verificare.'
  ].join(' ');

  await page.route('**/api/proxy/ai/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(buildMultiTherapyPayload())
            }
          }
        ],
        usage: {
          prompt_tokens: 260,
          completion_tokens: 220
        }
      })
    });
  });

  await page.route('**/api/drugs?q=*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          aic: '000000001',
          name: 'Forxiga',
          activePrinciple: 'Dapagliflozin',
          company: 'AstraZeneca',
          packaging: '10 mg compresse',
          atc: 'A10BK01'
        },
        {
          aic: '000000002',
          name: 'Slowmet',
          activePrinciple: 'Metformina',
          company: 'Bruno Farmaceutici',
          packaging: '1000 mg compresse',
          atc: 'A10BA02'
        },
        {
          aic: '000000003',
          name: 'Esapent',
          activePrinciple: 'Omega-3-acid ethyl esters',
          company: 'Espefa',
          packaging: '1000 mg capsule molli',
          atc: 'C10AX06'
        },
        {
          aic: '000000004',
          name: 'Bisoprololo EG',
          activePrinciple: 'Bisoprololo',
          company: 'EG',
          packaging: '1,25 mg compresse',
          atc: 'C07AB07'
        },
        {
          aic: '000000005',
          name: 'Nebivololo DOC',
          activePrinciple: 'Nebivololo',
          company: 'DOC',
          packaging: '5 mg compresse',
          atc: 'C07AB12'
        },
        {
          aic: '000000006',
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

  await expect(page.getByText('AIC 000000001 · ATC A10BK01')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('AIC 000000002 · ATC A10BA02')).toBeVisible();
  await expect(page.getByText('AIC 000000003 · ATC C10AX06')).toBeVisible();
  await expect(page.getByText('Bisoprololo EG')).toBeVisible();
  await expect(page.getByText('Nebivololo DOC')).toBeVisible();
  await expect(page.getByText('Furosemide Sandoz')).toBeVisible();
  await expect(page.getByText('Transizione beta-bloccante da confermare prima dell\'import')).toBeVisible();
  await expect(page.getByText('Posologia riportata come da verificare')).toBeVisible();

  await page.getByRole('button', { name: 'Applica selezionati' }).click();

  await expect(page.getByText('Import completato: 0 diagnosi, 3 terapie.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Bisoprololo EG')).toBeVisible();
  await expect(page.getByText('Nebivololo DOC')).toBeVisible();
  await expect(page.getByText('Furosemide Sandoz')).toBeVisible();
});
