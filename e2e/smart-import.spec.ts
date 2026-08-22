/* @Codex */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { bootstrapUnlockedSession, setAiLaneKillSwitch } from './utils';

async function bootstrapSmartImportSession(page: Page, pin: string) {
  await page.route('**/api/ai/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ models: [{ name: 'qwen3.5:35b-a3b' }] }),
    });
  });
  await bootstrapUnlockedSession(page, pin);
  await setAiLaneKillSwitch(page, 'aiSmartImportKillSwitch', 'enabled');
}

// WUL-274/Kree8: the cockpit patient search no longer exposes a patients-search-input
// testid, and clicking a search result opens the Scheda (/modules) route. Tests create
// via the patients API and open the Scheda with the id returned by the POST, so nothing
// re-finds a patient by tax code through the paginated list API.
async function createPatientViaApi(page: Page, payload: Record<string, unknown>): Promise<string> {
  return await page.evaluate(async (body: Record<string, unknown>) => {
    const response = await fetch('/api/patients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Failed to create patient: ${response.status}`);
    }

    const data = await response.json() as { id: string };
    return data.id;
  }, payload);
}

async function createTherapyViaApi(page: Page, payload: Record<string, unknown>): Promise<string> {
  return await page.evaluate(async (body: Record<string, unknown>) => {
    const response = await fetch('/api/therapies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const data = await response.json() as { id: string };
    return data.id;
  }, payload);
}

async function openPatientScheda(page: Page, patientId: string) {
  await page.goto(`/patients/${patientId}/modules`);
  await expect(page).toHaveURL(new RegExp(`/patients/${patientId}/modules$`));
}

async function openDocumentiSection(page: Page) {
  const trigger = page.locator('section#documenti > button').first();
  await expect(trigger).toBeVisible();
  await expect.poll(async () => {
    if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
    return await trigger.getAttribute('aria-expanded');
  }).toBe('true');
}

function smartImportDiagnosisInputId(label: string, icdQuery: string) {
  return `smart-import-diagnosis-diagnosis:${label}:${icdQuery}`;
}

function smartImportTherapyInputId(drugMention: string, dosage: string, activePrinciple: string) {
  return `smart-import-therapy-therapy:${drugMention}:${dosage}:${activePrinciple}`;
}

function smartImportCardFromInputId(page: Page, inputId: string) {
  return page.locator(`input[id="${inputId}"]`).locator('xpath=ancestor::div[contains(@class,"overflow-hidden")][1]');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function exactText(text: string): RegExp {
  return new RegExp(`^${escapeRegExp(text)}$`);
}

function smartImportCardTitle(card: Locator, inputId: string, title: string): Locator {
  return card
    .locator(`label[for="${inputId}"], p.text-sm.font-bold`)
    .filter({ hasText: exactText(title) })
    .first();
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

function buildManualOnlyTherapyPayload() {
  return {
    schemaVersion: 'mediflow.ai.extract.v1',
    task: 'smart_import',
    summary: 'Terapia reviewable senza match AIFA affidabile.',
    data: {
      diagnoses: [],
      therapies: [
        {
          drugMention: 'Nutridrink',
          drugQuery: 'Nutridrink',
          activePrinciple: 'Formula nutrizionale orale',
          dosage: '1 al di',
          motivation: 'Supporto nutrizionale domiciliare',
          therapyState: 'active',
          confidence: 'medium',
          evidence: 'Nutridrink 1 al di dopo dimagrimento recente.',
          sourceId: 'patient-notes:1'
        }
      ]
    }
  };
}

function buildCatalogWithoutDosagePayload() {
  return {
    schemaVersion: 'mediflow.ai.extract.v1',
    task: 'smart_import',
    summary: 'Terapia con match catalogo ma posologia non ancora sufficiente.',
    data: {
      diagnoses: [],
      therapies: [
        {
          drugMention: 'Forxiga',
          drugQuery: 'Forxiga',
          activePrinciple: 'Dapagliflozin',
          dosage: '',
          motivation: 'Terapia domiciliare riportata senza schema posologico',
          therapyState: 'active',
          confidence: 'medium',
          evidence: 'Forxiga in terapia domiciliare, schema posologico non riportato.',
          sourceId: 'patient-notes:1'
        }
      ]
    }
  };
}

function buildSwitchDriftPayload() {
  return {
    schemaVersion: 'mediflow.ai.extract.v1',
    task: 'smart_import',
    summary: 'Switch terapeutico con drift del modello sul farmaco uscente.',
    data: {
      diagnoses: [],
      therapies: [
        {
          drugMention: 'Bisoprololo',
          drugQuery: 'Bisoprololo',
          activePrinciple: 'Bisoprololo',
          dosage: '1,25 mg',
          motivation: 'Beta-bloccante in uscita',
          therapyState: 'inactive',
          reviewNote: 'Sospendere bisoprololo e passare a nebivololo',
          confidence: 'medium',
          evidence: 'Per ipotensione sospendere bisoprololo 1,25 mg e passare a nebivololo 5 mg 1 cp.',
          sourceId: 'patient-notes:1'
        },
        {
          drugMention: 'Nebivololo',
          drugQuery: 'Nebivololo',
          activePrinciple: 'Nebivololo',
          dosage: '5 mg 1 cp',
          motivation: 'Nuovo beta-bloccante',
          therapyState: 'transition',
          confidence: 'medium',
          evidence: 'Passare a nebivololo 5 mg 1 cp.',
          sourceId: 'patient-notes:1'
        }
      ]
    }
  };
}

function buildNoNoveltyReferralPayload() {
  return {
    schemaVersion: 'mediflow.ai.extract.v1',
    task: 'smart_import',
    summary: 'Referral di controllo su quadro gia noto senza novita cliniche.',
    data: {
      diagnoses: [
        {
          label: 'Ipotiroidismo autoimmune',
          icdQuery: 'autoimmune hypothyroidism',
          evidence: 'Richiesta di visita endocrinologica di controllo per ipotiroidismo autoimmune gia noto.',
          confidence: 'medium',
          sourceId: 'patient-notes:1',
        }
      ],
      therapies: [
        {
          drugMention: 'Levotiroxina',
          drugQuery: 'Levotiroxina',
          activePrinciple: 'Levotiroxina sodica',
          dosage: '75 mcg 1 cp/die',
          motivation: 'Terapia domiciliare in continuita',
          therapyState: 'active',
          confidence: 'medium',
          evidence: 'Continuare terapia domiciliare come da piano in corso.',
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

  await bootstrapSmartImportSession(page, pin);
  const patientId = await createPatientViaApi(page, {
    firstName,
    lastName,
    taxCode,
    notes: patientNotes,
  });

  await openPatientScheda(page, patientId);
  await openDocumentiSection(page);

  await expect(page.getByRole('button', { name: 'Analizza fonti' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Analizza fonti' }).click();

  const diagnosisCard = smartImportCardFromInputId(
    page,
    smartImportDiagnosisInputId('Ipertensione arteriosa essenziale', 'essential hypertension')
  );
  const diagnosisInputId = smartImportDiagnosisInputId('Ipertensione arteriosa essenziale', 'essential hypertension');
  const therapyInputId = smartImportTherapyInputId('Furosemide', '25 mg 1 cp al mattino', 'Furosemide');
  const therapyCard = smartImportCardFromInputId(
    page,
    therapyInputId
  );

  await expect(smartImportCardTitle(diagnosisCard, diagnosisInputId, 'Ipertensione arteriosa essenziale')).toBeVisible({ timeout: 20_000 });
  await expect(diagnosisCard.getByText('Nuova diagnosi con match ICD-11 pronto per revisione')).toBeVisible();
  await expect(diagnosisCard.getByText('Profilo attuale: ICD-11 BA00 · Essential hypertension')).toBeVisible();
  await expect(smartImportCardTitle(therapyCard, therapyInputId, 'Furosemide Sandoz')).toBeVisible();
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

  await bootstrapSmartImportSession(page, pin);
  const patientId = await createPatientViaApi(page, {
    firstName,
    lastName,
    taxCode,
    notes: patientNotes,
  });

  await openPatientScheda(page, patientId);
  await openDocumentiSection(page);

  await expect(page.getByRole('button', { name: 'Analizza fonti' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Analizza fonti' }).click();

  const forxigaInputId = smartImportTherapyInputId('Forxiga 10 mg', '10 mg 1 cp al mattino', 'Dapagliflozin');
  const slowmetInputId = smartImportTherapyInputId('Slowmet 1000 mg', '1000 mg 1 cp x 2', 'Metformina');
  const esapentInputId = smartImportTherapyInputId('Esapent 1000', '1000 mg 1 cps x 2', 'Omega-3-acid ethyl esters');
  const bisoprololoInputId = smartImportTherapyInputId('Bisoprololo', '1,25 mg', 'Bisoprololo');
  const nebivololoInputId = smartImportTherapyInputId('Nebivololo', '5 mg 1 cp', 'Nebivololo');
  const furosemideInputId = smartImportTherapyInputId('Furosemide', 'dose da verificare', 'Furosemide');

  const forxigaCard = smartImportCardFromInputId(page, forxigaInputId);
  const slowmetCard = smartImportCardFromInputId(page, slowmetInputId);
  const esapentCard = smartImportCardFromInputId(page, esapentInputId);
  const bisoprololoCard = smartImportCardFromInputId(page, bisoprololoInputId);
  const nebivololoCard = smartImportCardFromInputId(page, nebivololoInputId);
  const furosemideCard = smartImportCardFromInputId(page, furosemideInputId);

  await expect(smartImportCardTitle(forxigaCard, forxigaInputId, 'Forxiga')).toBeVisible({ timeout: 20_000 });
  await expect(smartImportCardTitle(slowmetCard, slowmetInputId, 'Slowmet')).toBeVisible();
  await expect(smartImportCardTitle(esapentCard, esapentInputId, 'Esapent')).toBeVisible();
  await expect(smartImportCardTitle(bisoprololoCard, bisoprololoInputId, 'Bisoprololo EG')).toBeVisible();
  await expect(smartImportCardTitle(nebivololoCard, nebivololoInputId, 'Nebivololo DOC')).toBeVisible();
  await expect(smartImportCardTitle(furosemideCard, furosemideInputId, 'Furosemide Sandoz')).toBeVisible();
  await expect(
    bisoprololoCard.getByText('Transizione terapeutica documentata: richiede conferma manuale prima dell\'import')
  ).toBeVisible();
  await expect(furosemideCard.getByText('Posologia riportata come da verificare')).toBeVisible();
  await expect(furosemideCard.getByText('incerto', { exact: true })).toBeVisible();

  const bisoprololoCheckbox = page.locator(
    `input[id="${bisoprololoInputId}"]`
  );
  await expect(bisoprololoCheckbox).toBeDisabled();
  await bisoprololoCard.getByRole('button', { name: 'Scarta' }).click();
  await expect(smartImportCardTitle(bisoprololoCard, bisoprololoInputId, 'Bisoprololo EG')).toHaveCount(0);

  await page.getByRole('button', { name: 'Applica selezionati' }).click();

  await expect(page.getByText('Import completato: 0 diagnosi, 2 terapie.')).toBeVisible({ timeout: 20_000 });
  await expect(smartImportCardTitle(esapentCard, esapentInputId, 'Esapent')).toBeVisible();
  await expect(smartImportCardTitle(nebivololoCard, nebivololoInputId, 'Nebivololo DOC')).toBeVisible();
  await expect(smartImportCardTitle(furosemideCard, furosemideInputId, 'Furosemide Sandoz')).toBeVisible();
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

  await bootstrapSmartImportSession(page, pin);
  const patientId = await createPatientViaApi(page, {
    firstName,
    lastName,
    taxCode,
    notes: patientNotes,
  });

  await openPatientScheda(page, patientId);
  await openDocumentiSection(page);

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
  await openDocumentiSection(page);
  await expect(page.getByRole('button', { name: 'Analizza fonti' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Analizza fonti' }).click();

  const updateInputId = smartImportTherapyInputId('Bisoprololo', '1,25 mg 1 cp', 'Bisoprololo');
  const updateCard = smartImportCardFromInputId(page, updateInputId);
  const updateCheckbox = page.locator(`input[id="${updateInputId}"]`);

  await expect(smartImportCardTitle(updateCard, updateInputId, 'Bisoprololo EG')).toBeVisible({ timeout: 20_000 });
  await expect(updateCard.getByText('aggiornamento', { exact: true })).toBeVisible();
  await expect(updateCard.getByText('Possibile aggiornamento di terapia gia presente: richiede revisione manuale')).toBeVisible();
  await expect(updateCard.getByText('Profilo attuale: Bisoprololo EG (Bisoprololo · 2,5 mg 1 cp · stato active)')).toBeVisible();
  await expect(updateCheckbox).toBeDisabled();

  await updateCard.getByRole('button', { name: 'Modifica' }).click();
  const dosageInput = updateCard.locator('label').filter({ hasText: 'Posologia' }).locator('input');
  await dosageInput.fill('1,25 mg 1 cp al mattino');
  await expect(dosageInput).toHaveValue('1,25 mg 1 cp al mattino');
});

test('smart import keeps manual-only therapy consultive and disables direct apply', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';
  const suffix = `${Date.now()}`.slice(-4);
  const firstName = `Manual${suffix}`;
  const lastName = `Review${suffix}`;
  const taxCode = `MNLRVW80A01H${suffix}`;
  const patientNotes = 'Nutridrink 1 al di dopo dimagrimento recente.';

  await page.route('**/api/proxy/ollama/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(buildManualOnlyTherapyPayload())
            }
          }
        ],
        usage: {
          prompt_tokens: 160,
          completion_tokens: 90
        }
      })
    });
  });

  await page.route('**/api/drugs?q=*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([])
    });
  });

  await bootstrapSmartImportSession(page, pin);
  const patientId = await createPatientViaApi(page, {
    firstName,
    lastName,
    taxCode,
    notes: patientNotes,
  });

  await openPatientScheda(page, patientId);
  await openDocumentiSection(page);
  await expect(page.getByRole('button', { name: 'Analizza fonti' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Analizza fonti' }).click();

  const therapyInputId = smartImportTherapyInputId('Nutridrink', '1 al di', 'Formula nutrizionale orale');
  const therapyCard = smartImportCardFromInputId(page, therapyInputId);
  const therapyCheckbox = page.locator(`input[id="${therapyInputId}"]`);

  await expect(smartImportCardTitle(therapyCard, therapyInputId, 'Nutridrink')).toBeVisible({ timeout: 20_000 });
  // The match-type badge is localised via lib/ai-labels matchTypeLabel: manual -> "manuale".
  await expect(therapyCard.getByText('manuale', { exact: true })).toBeVisible();
  await expect(therapyCard.getByText('incerto', { exact: true })).toBeVisible();
  await expect(therapyCard.getByText('Match AIFA da confermare prima dell\'import')).toBeVisible();
  await expect(therapyCard.getByText('Nessun candidato AIFA locale affidabile.')).toBeVisible();
  await expect(therapyCheckbox).toBeDisabled();
});

test('smart import keeps catalog therapy without useful dosage consultive and disables direct apply', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';
  const suffix = `${Date.now()}`.slice(-4);
  const firstName = `Dosage${suffix}`;
  const lastName = `Guard${suffix}`;
  const taxCode = `DSGGRD80A01H${suffix}`;
  const patientNotes = 'Forxiga in terapia domiciliare, schema posologico non riportato.';

  await page.route('**/api/proxy/ollama/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(buildCatalogWithoutDosagePayload())
            }
          }
        ],
        usage: {
          prompt_tokens: 150,
          completion_tokens: 90
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
          aic: '000000010',
          name: 'Forxiga',
          activePrinciple: 'Dapagliflozin',
          company: 'AstraZeneca',
          packaging: '10 mg compresse rivestite con film',
          atc: 'A10BK01'
        }
      ])
    });
  });

  await bootstrapSmartImportSession(page, pin);
  const patientId = await createPatientViaApi(page, {
    firstName,
    lastName,
    taxCode,
    notes: patientNotes,
  });

  await openPatientScheda(page, patientId);
  await openDocumentiSection(page);
  await expect(page.getByRole('button', { name: 'Analizza fonti' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Analizza fonti' }).click();

  const therapyInputId = smartImportTherapyInputId('Forxiga', '', 'Dapagliflozin');
  const therapyCard = smartImportCardFromInputId(page, therapyInputId);
  const therapyCheckbox = page.locator(`input[id="${therapyInputId}"]`);

  await expect(smartImportCardTitle(therapyCard, therapyInputId, 'Forxiga')).toBeVisible({ timeout: 20_000 });
  // The match-type badge is localised via lib/ai-labels matchTypeLabel: catalog -> "match AIFA".
  await expect(therapyCard.getByText('match AIFA', { exact: true })).toBeVisible();
  await expect(therapyCard.getByText('incerto', { exact: true })).toBeVisible();
  await expect(therapyCard.getByText('Posologia da verificare prima dell\'import')).toBeVisible();
  await expect(therapyCheckbox).toBeDisabled();
});

test('smart import normalizes outgoing switch therapy to transition even when model marks it inactive', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';
  const suffix = `${Date.now()}`.slice(-4);
  const firstName = `Switch${suffix}`;
  const lastName = `Drift${suffix}`;
  const taxCode = `SWTDRF80A01H${suffix}`;
  const patientNotes = 'Per ipotensione sospendere bisoprololo 1,25 mg e passare a nebivololo 5 mg 1 cp.';

  await page.route('**/api/proxy/ollama/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(buildSwitchDriftPayload())
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

  await page.route('**/api/drugs?q=*', async (route) => {
    const url = route.request().url();
    if (url.includes('Bisoprololo')) {
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
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          aic: '000000008',
          name: 'Nebivololo DOC',
          activePrinciple: 'Nebivololo',
          company: 'DOC',
          packaging: '5 mg compresse',
          atc: 'C07AB12'
        }
      ])
    });
  });

  await bootstrapSmartImportSession(page, pin);
  const patientId = await createPatientViaApi(page, {
    firstName,
    lastName,
    taxCode,
    notes: patientNotes,
  });

  await openPatientScheda(page, patientId);
  await openDocumentiSection(page);
  await expect(page.getByRole('button', { name: 'Analizza fonti' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Analizza fonti' }).click();

  const bisoprololoInputId = smartImportTherapyInputId('Bisoprololo', '1,25 mg', 'Bisoprololo');
  const bisoprololoCard = smartImportCardFromInputId(page, bisoprololoInputId);
  const bisoprololoCheckbox = page.locator(`input[id="${bisoprololoInputId}"]`);

  await expect(smartImportCardTitle(bisoprololoCard, bisoprololoInputId, 'Bisoprololo EG')).toBeVisible({ timeout: 20_000 });
  await expect(bisoprololoCard.getByText('transizione', { exact: true }).first()).toBeVisible();
  await expect(bisoprololoCard.getByText('Transizione terapeutica documentata: richiede conferma manuale prima dell\'import')).toBeVisible();
  await expect(bisoprololoCard.getByText('sospesa', { exact: true })).toHaveCount(0);
  await expect(bisoprololoCheckbox).toBeDisabled();
});

test('smart import hides already-present referral duplicates when the source has no clinical novelty', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';
  const suffix = `${Date.now()}`.slice(-4);
  const referralNotes = 'Richiesta di visita endocrinologica di controllo per ipotiroidismo autoimmune gia noto. Continuare terapia domiciliare come da piano in corso.';

  await page.route('**/api/proxy/ollama/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(buildNoNoveltyReferralPayload())
            }
          }
        ],
        usage: {
          prompt_tokens: 180,
          completion_tokens: 110
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
            theCode: '5A00',
            title: 'Autoimmune hypothyroidism'
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
          aic: 'AIC-LEVO-75',
          name: 'Levotiroxina Teva',
          activePrinciple: 'Levotiroxina sodica',
          company: 'Teva',
          packaging: '75 mcg compresse',
          atc: 'H03AA01'
        }
      ])
    });
  });

  await bootstrapSmartImportSession(page, pin);

  const patientId = await createPatientViaApi(page, {
    firstName: `Referral${suffix}`,
    lastName: `Noise${suffix}`,
    taxCode: `RFRNSE80A01H${suffix}`,
    birthDate: '1980-01-01T00:00:00.000Z',
    notes: referralNotes,
    diagnoses: [
      {
        system: 'ICD-11',
        code: '5A00',
        description: 'Ipotiroidismo autoimmune',
        date: new Date().toISOString(),
      },
    ],
  });

  await createTherapyViaApi(page, {
    patientId,
    drugName: 'Levotiroxina Teva',
    activePrinciple: 'Levotiroxina sodica',
    dosage: '75 mcg 1 cp/die',
    aic: 'AIC-LEVO-75',
    atc: 'H03AA01',
    status: 'active',
    startDate: new Date('2026-04-01T08:00:00Z').toISOString(),
  });

  await openPatientScheda(page, patientId);
  await openDocumentiSection(page);
  await expect(page.getByRole('button', { name: 'Analizza fonti' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Analizza fonti' }).click();

  const diagnosisInputId = smartImportDiagnosisInputId('Ipotiroidismo autoimmune', 'autoimmune hypothyroidism');
  const therapyInputId = smartImportTherapyInputId('Levotiroxina', '75 mcg 1 cp/die', 'Levotiroxina sodica');

  await expect(page.locator(`input[id="${diagnosisInputId}"]`)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator(`input[id="${therapyInputId}"]`)).toHaveCount(0);
  await expect(page.getByText('Nessun match trovato')).toHaveCount(2);
});
