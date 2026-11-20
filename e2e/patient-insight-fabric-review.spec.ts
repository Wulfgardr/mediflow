import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';

import { availablePreview, MODEL, MODEL_OPTION_ID, PATIENT_INSIGHT_CATALOG } from './fixtures/patient-insight-preview';
import {
  parsePatientInsightPreviewRequest,
  type PatientInsightPreviewRequest,
} from '../lib/ai-providers/fabric/patient-insight-preview-contract';
import { bootstrapUnlockedSession, openUnlockedDocument, unlockIfNeeded, openPatientSection, setAiLaneKillSwitch, assertNoHorizontalOverflow, assertNotClippedInViewport } from './utils';

const REVIEW_NOTICE = 'Controlla ogni frase sulla fonte che cita: il modello può scambiare ciò che è fatto con ciò che è da fare.';

async function createSyntheticPatient(page: Page): Promise<string> {
  return await page.evaluate(async (taxCode: string) => {
    const response = await fetch('/api/patients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Fabric',
        lastName: 'Review',
        taxCode,
        birthDate: '1980-01-01T00:00:00.000Z',
        address: 'Via Sintetica 1',
        phone: '0000000000',
      }),
    });
    const payload = await response.json() as { id?: string; error?: string };
    if (!response.ok || !payload.id) {
      throw new Error(payload.error || `Patient creation failed with HTTP ${response.status}`);
    }
    return payload.id;
  }, `PIFABRIC${Date.now()}`);
}

test.describe.configure({ retries: 0 });

test('Quadro paziente invia un payload strict e mostra una proposta review-only', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';
  let previewCalls = 0;
  let capturedRequest: PatientInsightPreviewRequest | null = null;
  let generationStarted = false;
  const postGestureMutations: string[] = [];

  page.on('request', (request) => {
    if (!generationStarted || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) return;
    const pathname = new URL(request.url()).pathname;
    postGestureMutations.push(`${request.method()} ${pathname}`);
  });

  await bootstrapUnlockedSession(page, pin);
  await setAiLaneKillSwitch(page, 'aiPatientInsightKillSwitch', 'enabled');
  const patientId = await createSyntheticPatient(page);

  await page.route('**/api/ai/patient-insight/preview', async (route) => {
    previewCalls += 1;
    capturedRequest = parsePatientInsightPreviewRequest(route.request().postDataJSON());
    if (!capturedRequest) throw new Error('La UI Quadro paziente ha inviato un payload preview non conforme.');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(availablePreview(capturedRequest)),
    });
  });
  await page.route('**/api/settings/ai/functions', async (route) => {
    expect(route.request().method()).toBe('GET');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PATIENT_INSIGHT_CATALOG) });
  });

  await openUnlockedDocument(page, `/patients/${patientId}/modules#quadro`);
  await expect(page).toHaveURL(new RegExp(`/patients/${patientId}/modules#quadro$`));
  await openPatientSection(page, 'quadro');
  await expect(page.locator('#quadro #patient-insight')).toHaveCount(0);
  await expect(page.getByTestId('patient-proposals-summary')).toContainText('Nessuna proposta da rivedere');
  await openPatientSection(page, 'attenzione');
  const insightDisclosure = page.locator('#patient-insight');
  await expect(insightDisclosure.locator(':scope > div > [data-disclosure-control]')).toHaveAttribute('aria-expanded', 'false');
  expect(previewCalls).toBe(0);
  await insightDisclosure.locator(':scope > div > [data-disclosure-control]').click();
  await expect(insightDisclosure.locator(':scope > div > [data-disclosure-control]')).toHaveAttribute('aria-expanded', 'true');
  await page.getByTestId('model-picker-patient_insight').getByRole('button', { name: 'Cambia', exact: true }).click();
  const modelPicker = page.getByRole('combobox', { name: 'Modello per questa proposta' });
  await expect(modelPicker).toBeEnabled();
  await modelPicker.focus();
  await expect(modelPicker.locator('option')).toHaveText([
    `Predefinito · ${MODEL}`,
    'OpenAI · abbonamento ChatGPT',
    `${MODEL} · Ollama · locale`,
  ]);
  await modelPicker.selectOption(MODEL_OPTION_ID);
  await expect(modelPicker).toHaveValue(MODEL_OPTION_ID);
  generationStarted = true;
  await page.getByRole('button', { name: 'Genera proposta' }).click();

  const proposal = page.getByTestId('patient-insight-review-proposal');
  await expect(proposal).toBeVisible();
  await expect(proposal).toContainText('Proposta · da rivedere');
  await expect(proposal.locator('[data-ink="pencil"]')).toBeVisible();
  await expect(proposal).toContainText('Fonti della proposta');
  await expect(proposal).toContainText('0 scritture');
  await expect(proposal).toContainText('Applicazione non consentita');
  await expect(proposal).toContainText('Proposta sintetica da revisionare. [S1]');
  await expect(proposal).toContainText('Ricevuta, provenienza e validità');
  await expect(proposal).toContainText(`ollama · ${MODEL} · Processo locale · Nessuna uscita dati`);
  await expect(proposal).toContainText('Riduzione del contesto → Verifica del formato');
  await expect(proposal).toContainText('Selezione 7 · revisione 1');
  await expect(proposal.getByTestId('patient-insight-review-notice')).toHaveText(REVIEW_NOTICE);
  const proposalText = await proposal.innerText();
  expect(proposalText.split(REVIEW_NOTICE)).toHaveLength(2);
  expect(proposalText.indexOf(REVIEW_NOTICE)).toBeLessThan(proposalText.indexOf('Proposta sintetica da revisionare.'));
  expect(proposalText).not.toMatch(/tentativ/iu);

  expect(previewCalls).toBe(1);
  expect(capturedRequest).not.toBeNull();
  expect(Object.keys(capturedRequest!)).toEqual([
    'schemaVersion', 'requestId', 'patientId', 'ambulatoryId', 'patientRevision', 'capturedAt', 'sources',
  ]);
  expect(capturedRequest).toMatchObject({
    schemaVersion: 'mediflow.patient-insight.preview-request.v1',
    patientId,
    patientRevision: 1,
    sources: {
      focus: { summary: 'Valutazione manuale del follow-up clinico attuale' },
      conditions: [],
      activeTherapies: [],
      recentEvents: [],
    },
  });
  expect(capturedRequest!.requestId).toMatch(/^pi_[0-9a-f-]{36}$/u);
  expect(capturedRequest!.ambulatoryId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
  expect(new Date(capturedRequest!.capturedAt).toISOString()).toBe(capturedRequest!.capturedAt);
  expect(Object.keys(capturedRequest!.sources)).toEqual([
    'focus', 'conditions', 'activeTherapies', 'recentEvents',
  ]);
  expect(Object.keys(capturedRequest!.sources.focus)).toEqual(['summary']);
  expect(JSON.stringify(capturedRequest)).not.toMatch(
    /"(?:provider|model|endpoint|venue|prompt|fallback|egress|apply)"\s*:/u,
  );
  expect(postGestureMutations).toEqual(['POST /api/ai/patient-insight/preview']);
  await openPatientSection(page, 'quadro');
  await expect(page.getByTestId('patient-proposals-summary')).toContainText('Proposta · non registrata');
  await expect(page.getByRole('navigation', { name: 'Navigazione principale' }).getByRole('link', { name: 'Quadro paziente 1' })).toBeVisible();
  await expect(proposal).not.toBeVisible();
  await expect(page.locator('#quadro [data-testid="patient-insight-review-proposal"]')).toHaveCount(0);
  await page.getByTestId('patient-proposals-summary').getByRole('link', { name: 'Apri il Quadro e le fonti', exact: true }).click();
  await expect(proposal).toBeVisible();
  expect(previewCalls).toBe(1);
  const disclosureControl = insightDisclosure.locator(':scope > div > [data-disclosure-control]');
  await disclosureControl.click();
  await expect(disclosureControl).toHaveAttribute('aria-expanded', 'false');
  await expect(proposal).toBeHidden();
  await disclosureControl.press('Enter');
  await expect(disclosureControl).toHaveAttribute('aria-expanded', 'true');
  await expect(proposal).toContainText('Proposta sintetica da revisionare. [S1]');
  expect(previewCalls).toBe(1);
  await insightDisclosure.getByRole('button', { name: 'Riusa predefinito', exact: true }).click();
  await expect(proposal).toHaveCount(0);
  await openPatientSection(page, 'quadro');
  await expect(page.getByTestId('patient-proposals-summary')).toContainText('Nessuna proposta da rivedere');
  expect(previewCalls).toBe(1);
});

test('Il riepilogo rende la sintesi, i dati mancanti e la ricevuta della proposta', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await setAiLaneKillSwitch(page, 'aiPatientInsightKillSwitch', 'enabled');
  const patientId = await createSyntheticPatient(page);
  const summary = 'Quadro stabile, in attesa degli elettroliti.';
  const gap = 'Esito del ricontrollo di potassio.';
  await page.route('**/api/settings/ai/functions', route => route.fulfill({ json: PATIENT_INSIGHT_CATALOG }));
  await page.route('**/api/ai/patient-insight/preview', route => {
    const request = parsePatientInsightPreviewRequest(route.request().postDataJSON());
    if (!request) throw new Error('Richiesta di anteprima non valida.');
    const response = availablePreview(request);
    response.preview.proposal = { ...response.preview.proposal, summary, currentState: [], alerts: [], nextSteps: [], gaps: [gap] };
    return route.fulfill({ json: response });
  });
  await openUnlockedDocument(page, `/patients/${patientId}/modules`);
  const island = page.getByTestId('patient-proposals-summary');
  await island.getByRole('link', { name: 'Apri il Quadro e le fonti' }).click();
  const picker = page.getByTestId('model-picker-patient_insight');
  await picker.getByRole('button', { name: 'Cambia', exact: true }).click();
  await picker.getByRole('combobox', { name: 'Modello per questa proposta' }).selectOption(MODEL_OPTION_ID);
  await page.getByRole('button', { name: 'Genera proposta' }).click();
  await expect(page.getByTestId('patient-insight-review-proposal')).toBeVisible();
  await openPatientSection(page, 'quadro');
  await expect(island).toContainText('Proposta · non registrata');
  await expect(island).toContainText(summary);
  await expect(island.getByRole('heading', { name: 'Dati mancanti' })).toBeVisible();
  await expect(island).toContainText(gap);
  await expect(island).toContainText('dal modello locale. Nessun dato inviato all’esterno.');
  await expect(island.getByText('dal modello locale', { exact: true })).toHaveAttribute('title', MODEL);
  await island.getByRole('link', { name: 'Apri il Quadro e le fonti' }).click();
  await expect(page.getByTestId('patient-insight-review-proposal')).toContainText(MODEL);
});

for (const theme of ['giorno', 'grafite']) for (const size of ['1440', '768', '390', '320', 'zoom-200', 'zoom-400']) {
  test(`Quadro paziente composizione ${theme} ${size}`, async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    const baseline = process.env.PATIENT_INSIGHT_BASELINE === '1';
    const zoom = size.startsWith('zoom-') ? await openBrowserZoomFixture(baseURL!) : undefined;
    const release = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
    let fail = false;
    try {
      if (zoom) page = zoom.page;
      await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
      await setAiLaneKillSwitch(page, 'aiPatientInsightKillSwitch', 'enabled');
      const patientId = await createSyntheticPatient(page);
      await page.route('**/api/settings/ai/functions', route => route.fulfill({ status: 200, json: PATIENT_INSIGHT_CATALOG }));
      await page.route('**/api/ai/patient-insight/preview', async route => {
        const request = parsePatientInsightPreviewRequest(route.request().postDataJSON());
        if (!request) throw new Error('Invalid synthetic preview request');
        entered.resolve(); await release.promise;
        return fail ? route.fulfill({ status: 503, json: { error: 'synthetic-provider-unavailable' } })
          : route.fulfill({ status: 200, json: availablePreview(request) });
      });
      await openUnlockedDocument(page, `/patients/${patientId}/modules`);
      await openPatientSection(page, baseline ? 'quadro' : 'attenzione');
      const panel = page.locator('#patient-insight');
      await panel.locator(':scope > div > [data-disclosure-control]').click();
      await panel.getByRole('button', { name: 'Cambia', exact: true }).click();
      const model = panel.getByRole('combobox', { name: 'Modello per questa proposta', exact: true });
      await model.focus(); await model.selectOption(MODEL_OPTION_ID);
      await page.setViewportSize({ width: zoom ? 1440 : Number(size), height: 1000 });
      await page.evaluate(theme => {
        document.documentElement.classList.toggle('dark', theme === 'grafite');
        document.documentElement.classList.toggle('light', theme === 'giorno');
      }, theme);
      if (zoom) await zoom.setZoom(size === 'zoom-200' ? 2 : 4);
      const directory = process.env.PATIENT_INSIGHT_CAPTURES;
      if (directory) await mkdir(directory, { recursive: true });
      const capture = async (state: string) => {
        await panel.scrollIntoViewIfNeeded();
        if (!baseline) await assertNoHorizontalOverflow(page, [{ label: 'Quadro paziente', selector: '#patient-insight' }, { label: 'pagina', selector: 'document' }]);
        if (directory) await page.screenshot({ path: `${directory}/${theme}-${size}-${state}.png`, animations: 'disabled' });
      };
      await capture('pronta');
      await panel.getByRole('button', { name: 'Genera proposta', exact: true }).click();
      await entered.promise;
      await capture('in-corso');
      release.resolve();
      await expect(panel.getByTestId('patient-insight-review-proposal')).toBeVisible();
      await capture('proposta');
      const source = panel.getByRole('link', { name: 'Quadro clinico', exact: true });
      await source.scrollIntoViewIfNeeded(); await source.focus();
      if (!baseline) await assertNotClippedInViewport(source, 'Fonte Quadro clinico');
      if (directory) await page.screenshot({ path: `${directory}/${theme}-${size}-fonti.png`, animations: 'disabled' });
      fail = true;
      await panel.getByRole('button', { name: 'Riusa predefinito', exact: true }).click();
      await expect(panel.getByTestId('patient-insight-review-proposal')).toHaveCount(0);
      await panel.getByRole('button', { name: 'Genera proposta', exact: true }).click();
      await expect(panel.getByRole('alert')).toContainText('Quadro paziente non è disponibile');
      await capture('errore');
      await setAiLaneKillSwitch(page, 'aiPatientInsightKillSwitch', 'disabled');
      await page.reload();
      await unlockIfNeeded(page, process.env.E2E_PIN || '1234');
      await openPatientSection(page, baseline ? 'quadro' : 'attenzione');
      await panel.locator(':scope > div > [data-disclosure-control]').click();
      await expect(panel.getByTestId('patient-insight-disabled-card')).toBeVisible();
      await capture('spenta');
      await test.info().attach('surface', { body: JSON.stringify({ theme, size, baseline,
        revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        zoom: zoom ? { mechanism: 'chrome.tabs.setZoom/getZoom', factor: size === 'zoom-200' ? 2 : 4,
          physicalWidth: 1440, innerWidth: await page.evaluate(() => innerWidth) } : null }), contentType: 'application/json' });
    } finally { release.resolve(); await zoom?.close(); }
  });
}

for (const width of [1440, 390]) test(`copy del Quadro paziente ${width}`, async ({ page }) => {
  test.setTimeout(180_000);
  const baseline = process.env.WUL825_BASELINE === '1';
  await page.setViewportSize({ width, height: 1000 });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await setAiLaneKillSwitch(page, 'aiPatientInsightKillSwitch', 'enabled');
  const patientId = await createSyntheticPatient(page);
  await page.route('**/api/settings/ai/functions', route => route.fulfill({ status: 200, json: PATIENT_INSIGHT_CATALOG }));
  await page.route('**/api/ai/patient-insight/preview', route => {
    const request = parsePatientInsightPreviewRequest(route.request().postDataJSON());
    if (!request) throw new Error('Invalid synthetic preview request');
    const preview = availablePreview(request);
    preview.preview.proposal.summary = 'Proposta sintetica da revisionare. [S1]';
    return route.fulfill({ status: 200, json: preview });
  });
  await openUnlockedDocument(page, `/patients/${patientId}/modules`);
  await openPatientSection(page, 'attenzione');
  const panel = page.locator('#patient-insight');
  await panel.locator(':scope > div > [data-disclosure-control]').click();
  await panel.getByRole('button', { name: 'Cambia', exact: true }).click();
  const picker = panel.getByRole('combobox', { name: 'Modello per questa proposta', exact: true });
  await picker.focus(); await picker.selectOption(MODEL_OPTION_ID);
  const directory = process.env.PATIENT_INSIGHT_CAPTURES;
  if (directory) await mkdir(directory, { recursive: true });
  const capture = async (state: string) => {
    await panel.scrollIntoViewIfNeeded();
    if (directory) await page.screenshot({ path: `${directory}/${width}-${state}.png`, fullPage: true, animations: 'disabled' });
  };
  await capture('prima-di-generare');
  await panel.getByRole('button', { name: baseline ? 'Avvia supporto' : 'Genera proposta', exact: true }).click();
  const proposal = panel.getByTestId('patient-insight-review-proposal');
  await expect(proposal).toBeVisible();
  await expect(proposal.getByTestId('patient-insight-review-notice')).toHaveText(REVIEW_NOTICE);
  if (!baseline) {
    await expect(proposal.getByRole('heading', { name: 'Stato attuale', exact: true })).toBeVisible();
    await expect(panel.getByText('La cartella non cambia.', { exact: true })).toHaveCount(0);
    await expect(proposal).not.toContainText('La cartella resta invariata.');
    await expect(panel.getByRole('button', { name: 'Nuova proposta', exact: true })).toBeVisible();
  }
  await capture('proposta');
  await proposal.getByText('Dettagli di verifica', { exact: true }).click();
  await capture('dettagli');
});

for (const width of [1440, 390]) test(`copy anagrafica e note ${width}`, async ({ page }) => {
  test.setTimeout(180_000);
  const baseline = process.env.WUL825_BASELINE === '1';
  await page.setViewportSize({ width, height: 1000 });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const directory = process.env.PATIENT_INSIGHT_CAPTURES;
  if (directory) await mkdir(directory, { recursive: true });
  await openUnlockedDocument(page, '/patients/new');
  const year = page.getByRole('checkbox', { name: baseline ? 'Conosco solo l’anno (stima)' : 'Conosco solo l’anno', exact: true });
  await expect(year).toBeVisible();
  await year.check();
  await year.scrollIntoViewIfNeeded();
  if (directory) await page.screenshot({ path: `${directory}/${width}-anno.png`, animations: 'disabled' });
  const patientId = await createSyntheticPatient(page);
  await openUnlockedDocument(page, `/patients/${patientId}/notes-review`);
  const notes = page.getByRole('textbox', { name: 'Note da proporre' });
  await notes.fill('Bozza sintetica da conservare.');
  await page.route(`**/api/patients/${patientId}/notes-commit`, route => {
    const input = route.request().postDataJSON();
    if (input.kind === 'prepare') return route.fulfill({ status: 200, json: {
      kind: 'prepared', policy: 'patient-profile.notes.commit.v1', reference: `ppr_${'a'.repeat(64)}`,
      digest: 'b'.repeat(64), notes: input.notes, expectedRevision: input.expectedRevision,
      selectionEpoch: input.expectedSelectionEpoch, expiresAt: Date.now() + 30_000,
      recipient: { id: patientId, firstName: 'Fabric', lastName: 'Review' }, action: 'replace-notes',
    } });
    return input.kind === 'confirm' ? route.fulfill({ status: 403, json: { code: 'review_denied', error: 'synthetic-denial' } })
      : route.fulfill({ status: 200, json: { kind: 'cancelled' } });
  });
  await page.getByRole('button', { name: 'Prepara la revisione', exact: true }).click();
  await page.getByLabel('PIN di conferma').fill('0000');
  await page.getByRole('button', { name: 'Conferma e salva le note', exact: true }).click();
  await expect(page.locator('p[role=alert]')).toHaveText(baseline
    ? 'Revisione non ammessa. Nessuna modifica salvata. La bozza è conservata: verifica la sessione e il PIN, poi prepara una nuova revisione.'
    : 'La bozza è intatta.');
  await expect(notes).toHaveValue('Bozza sintetica da conservare.');
  if (directory) await page.screenshot({ path: `${directory}/${width}-errore-note.png`, animations: 'disabled' });
});

for (const width of [1440, 390]) test(`copy titolo parametri recenti ${width}`, async ({ page }) => {
  test.setTimeout(180_000);
  const baseline = process.env.WUL825_BASELINE === '1';
  await page.setViewportSize({ width, height: 1000 });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const patientId = await createSyntheticPatient(page);
  await openUnlockedDocument(page, `/patients/${patientId}/modules`);
  const section = page.locator('#quadro').getByRole('region', { name: baseline ? 'Misure recenti' : 'Parametri recenti', exact: true });
  await expect(section).toBeVisible();
  await section.scrollIntoViewIfNeeded();
  const directory = process.env.PATIENT_INSIGHT_CAPTURES;
  if (directory) {
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: `${directory}/${width}-parametri-recenti.png`, fullPage: true, animations: 'disabled' });
  }
});
