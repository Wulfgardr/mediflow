/* @Codex */
import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

async function createPatientFromForm(page: import('@playwright/test').Page, values: {
  firstName: string;
  lastName: string;
  taxCode: string;
  notes: string;
}) {
  await page.goto('/patients/new');

  await expect(page.getByPlaceholder('Es. Mario')).toBeVisible();
  await page.getByPlaceholder('Es. Mario').fill(values.firstName);
  await page.getByPlaceholder('Es. Rossi').fill(values.lastName);
  await page.getByPlaceholder('RSSMRA80A01H501U').fill(values.taxCode);
  await page.getByPlaceholder('Informazioni aggiuntive, contesto familiare, codici accesso, preferenze del paziente...').fill(values.notes);
  await page.getByRole('button', { name: 'Crea Nuova Scheda' }).click();

  await expect(page).toHaveURL(/\/$/);
}

async function openPatientFromHome(page: import('@playwright/test').Page, taxCode: string) {
  const search = page.getByPlaceholder('Cerca paziente...');
  await search.fill(taxCode);
  await page.getByText(taxCode).click();
  await expect(page).toHaveURL(/\/patients\/.+/);
}

function smartImportDiagnosisInputId(label: string, icdQuery: string) {
  return `smart-import-diagnosis-diagnosis:${label}:${icdQuery}`;
}

function smartImportTherapyInputId(drugMention: string, dosage: string, activePrinciple: string) {
  return `smart-import-therapy-therapy:${drugMention}:${dosage}:${activePrinciple}`;
}

function smartImportCardFromInputId(page: import('@playwright/test').Page, inputId: string) {
  return page.locator(`input[id="${inputId}"]`).locator('xpath=ancestor::div[contains(@class,"overflow-hidden")][1]');
}

function buildSmartImportPayload() {
  return {
    schemaVersion: 'mediflow.ai.extract.v1',
    task: 'smart_import',
    summary: 'Diagnosi e terapia attive rilevate dalle note paziente.',
    data: {
      diagnoses: [
        {
          label: 'Ipertensione arteriosa essenziale',
          icdQuery: 'essential hypertension',
          evidence: 'Nota globale: ipertensione arteriosa essenziale in trattamento cronico.',
          confidence: 'high',
          sourceId: 'patient-notes:1',
        }
      ],
      therapies: [
        {
          drugMention: 'Furosemide',
          drugQuery: 'furosemide',
          activePrinciple: 'Furosemide',
          dosage: '25 mg 1 cp al mattino',
          motivation: 'Terapia cronica riportata nelle note',
          evidence: 'Nota globale: Furosemide 25 mg 1 cp al mattino.',
          confidence: 'high',
          sourceId: 'patient-notes:1',
        }
      ]
    }
  };
}

function buildMultiTherapyPayload() {
  return {
    schemaVersion: 'mediflow.ai.extract.v1',
    task: 'smart_import',
    summary: 'Terapie multiple con mix di candidati attivi e review-only.',
    data: {
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
          sourceId: 'patient-notes:1'
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
          sourceId: 'patient-notes:1'
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
          sourceId: 'patient-notes:1'
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
          sourceId: 'patient-notes:2'
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
          sourceId: 'patient-notes:2'
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
          sourceId: 'patient-notes:3'
        }
      ]
    }
  };
}

function buildTherapyUpdatePayload() {
  return {
    schemaVersion: 'mediflow.ai.extract.v1',
    task: 'smart_import',
    summary: 'Possibile aggiornamento posologico di terapia esistente.',
    data: {
      diagnoses: [],
      therapies: [
        {
          drugMention: 'Bisoprololo',
          drugQuery: 'Bisoprololo',
          activePrinciple: 'Bisoprololo',
          dosage: '1,25 mg 1 cp',
          motivation: 'Riduzione del dosaggio dopo rivalutazione pressoria',
          therapyState: 'active',
          confidence: 'high',
          evidence: 'Ridotto bisoprololo a 1,25 mg 1 cp dopo controllo domiciliare.',
          sourceId: 'patient-notes:1'
        }
      ]
    }
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

  await page.route('**/api/proxy/ollama/chat', async (route) => {
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
  await createPatientFromForm(page, {
    firstName,
    lastName,
    taxCode,
    notes: patientNotes,
  });

  await openPatientFromHome(page, taxCode);

  await expect(page.getByRole('button', { name: 'Analizza fonti' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Analizza fonti' }).click();

  const diagnosisCard = smartImportCardFromInputId(
    page,
    smartImportDiagnosisInputId('Ipertensione arteriosa essenziale', 'essential hypertension')
  );
  const therapyCard = smartImportCardFromInputId(
    page,
    smartImportTherapyInputId('Furosemide', '25 mg 1 cp al mattino', 'Furosemide')
  );

  await expect(diagnosisCard.getByText('Ipertensione arteriosa essenziale', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(diagnosisCard.getByText('Nuova diagnosi con match ICD-11 pronto per revisione')).toBeVisible();
  await expect(diagnosisCard.getByText('Profilo attuale: ICD-11 BA00 · Essential hypertension')).toBeVisible();
  await expect(therapyCard.getByText('Furosemide Sandoz', { exact: true })).toBeVisible();
  await expect(therapyCard.getByText('Nuova terapia pronta per import con match catalogo AIFA')).toBeVisible();
  await diagnosisCard.getByRole('button', { name: 'Modifica' }).click();
  const diagnosisLabelInput = diagnosisCard.locator('label').filter({ hasText: 'Descrizione da importare' }).locator('input');
  await diagnosisLabelInput.fill('Ipertensione arteriosa essenziale (contesto domiciliare)');
  await expect(diagnosisLabelInput).toHaveValue('Ipertensione arteriosa essenziale (contesto domiciliare)');
  await page.getByRole('button', { name: 'Applica selezionati' }).click();

  await expect(page.getByText('Import completato: 1 diagnosi, 1 terapie.')).toBeVisible({ timeout: 20_000 });
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

  await page.route('**/api/proxy/ollama/chat', async (route) => {
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
  await createPatientFromForm(page, {
    firstName,
    lastName,
    taxCode,
    notes: patientNotes,
  });

  await openPatientFromHome(page, taxCode);

  await expect(page.getByRole('button', { name: 'Analizza fonti' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Analizza fonti' }).click();

  await expect(page.getByText('Forxiga', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Slowmet', { exact: true })).toBeVisible();
  await expect(page.getByText('Esapent', { exact: true })).toBeVisible();
  await expect(page.getByText('Bisoprololo EG', { exact: true })).toBeVisible();
  await expect(page.getByText('Nebivololo DOC', { exact: true })).toBeVisible();
  await expect(page.getByText('Furosemide Sandoz', { exact: true })).toBeVisible();
  await expect(page.getByText('Transizione beta-bloccante da confermare prima dell\'import')).toBeVisible();
  await expect(page.getByText('Posologia riportata come da verificare')).toBeVisible();
  await expect(page.getByText('incerto').first()).toBeVisible();

  const bisoprololoCard = smartImportCardFromInputId(
    page,
    smartImportTherapyInputId('Bisoprololo', '1,25 mg', 'Bisoprololo')
  );
  const bisoprololoCheckbox = page.locator(
    `input[id="${smartImportTherapyInputId('Bisoprololo', '1,25 mg', 'Bisoprololo')}"]`
  );
  await expect(bisoprololoCheckbox).toBeDisabled();
  await bisoprololoCard.getByRole('button', { name: 'Scarta' }).click();
  await expect(page.getByText('Bisoprololo EG')).toHaveCount(0);

  await page.getByRole('button', { name: 'Applica selezionati' }).click();

  await expect(page.getByText('Import completato: 0 diagnosi, 2 terapie.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Esapent', { exact: true })).toBeVisible();
  await expect(page.getByText('Nebivololo DOC', { exact: true })).toBeVisible();
  await expect(page.getByText('Furosemide Sandoz', { exact: true })).toBeVisible();
});

test('smart import marks therapy dosage changes as update and keeps them editable but not directly applicable', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';
  const suffix = `${Date.now()}`.slice(-4);
  const firstName = `Update${suffix}`;
  const lastName = `Review${suffix}`;
  const taxCode = `UPDREV80A01H${suffix}`;
  const patientNotes = 'Ridotto bisoprololo a 1,25 mg 1 cp dopo controllo domiciliare.';

  await page.route('**/api/proxy/ollama/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(buildTherapyUpdatePayload())
            }
          }
        ],
        usage: {
          prompt_tokens: 200,
          completion_tokens: 120
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
          aic: '000000007',
          name: 'Bisoprololo EG',
          activePrinciple: 'Bisoprololo',
          company: 'EG',
          packaging: '1,25 mg compresse',
          atc: 'C07AB07'
        }
      ])
    });
  });

  await bootstrapUnlockedSession(page, pin);
  await createPatientFromForm(page, {
    firstName,
    lastName,
    taxCode,
    notes: patientNotes,
  });

  await openPatientFromHome(page, taxCode);

  const patientId = page.url().split('/').at(-1);
  expect(patientId).toBeTruthy();

  await page.evaluate(async ({ id }) => {
    const response = await fetch('/api/therapies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patientId: id,
        drugName: 'Bisoprololo EG',
        activePrinciple: 'Bisoprololo',
        dosage: '2,5 mg 1 cp',
        status: 'active',
        startDate: new Date('2026-04-01T08:00:00Z').toISOString(),
      }),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }
  }, { id: patientId });

  await page.reload();
  await expect(page.getByRole('button', { name: 'Analizza fonti' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Analizza fonti' }).click();

  const updateInputId = smartImportTherapyInputId('Bisoprololo', '1,25 mg 1 cp', 'Bisoprololo');
  const updateCard = smartImportCardFromInputId(page, updateInputId);
  const updateCheckbox = page.locator(`input[id="${updateInputId}"]`);

  await expect(updateCard.getByText('Bisoprololo EG', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(updateCard.getByText('aggiornamento', { exact: true })).toBeVisible();
  await expect(updateCard.getByText('Possibile aggiornamento di terapia gia presente: richiede revisione manuale')).toBeVisible();
  await expect(updateCard.getByText('Profilo attuale: Bisoprololo EG (Bisoprololo · 2,5 mg 1 cp · stato active)')).toBeVisible();
  await expect(updateCheckbox).toBeDisabled();

  await updateCard.getByRole('button', { name: 'Modifica' }).click();
  const dosageInput = updateCard.locator('label').filter({ hasText: 'Posologia' }).locator('input');
  await dosageInput.fill('1,25 mg 1 cp al mattino');
  await expect(dosageInput).toHaveValue('1,25 mg 1 cp al mattino');
});
