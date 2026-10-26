import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';
import type { FunctionModelPreferences } from '../lib/function-models/browser';
import { bootstrapUnlockedSession, openPatientSection, setAiLaneKillSwitch, assertNoHorizontalOverflow, assertNotClippedInViewport } from './utils';

const HEX = Object.freeze({
  session: '1'.repeat(32),
  patient: '2'.repeat(32),
  ambulatory: '3'.repeat(32),
  lease: '4'.repeat(32),
  projection: '5'.repeat(32),
  review: '6'.repeat(32),
});

// E2E fixture only: catalog availability and preview receipts are HTTP mocks,
// not host admission or evidence of a model invocation.
const FIXTURE_MODEL = {
  modelOptionId: `model_option_${'7'.repeat(32)}`,
  provider: 'ollama' as const,
  model: 'mediflow/synthetic',
};
const FIXTURE_CATALOG = {
  schemaVersion: 'mediflow.function-preferences.v1',
  revision: `sha256_${'8'.repeat(64)}`,
  catalogRevision: `sha256_${'9'.repeat(64)}`,
  check: 'configuration_only',
  apply: 'denied',
  presets: ['host_defaults', 'all_off'],
  functions: (['patient_insight', 'smart_import', 'document_synthesis', 'treatment_reasoning'] as const).map(id => ({
    id,
    enabled: id === 'smart_import',
    defaultModelOptionId: id === 'treatment_reasoning' ? `model_option_${'a'.repeat(32)}` : FIXTURE_MODEL.modelOptionId,
    defaultSource: 'host_configuration',
    bindingState: 'current',
    options: id === 'treatment_reasoning'
      ? [{ modelOptionId: `model_option_${'a'.repeat(32)}`, label: 'ATHENA / MLX', provider: 'athena_mlx', state: 'unavailable' }]
      : [{ modelOptionId: FIXTURE_MODEL.modelOptionId, label: FIXTURE_MODEL.model, provider: FIXTURE_MODEL.provider, state: 'available_unqualified' }],
  })),
} satisfies FunctionModelPreferences;

async function createPatient(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const response = await fetch('/api/patients', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Smart',
        lastName: 'Import Synthetic',
        taxCode: `SMRTPT80A01H${String(Date.now()).slice(-4)}`,
        notes: 'Diagnosi sintetica in revisione. Terapia sintetica 10 mg una compressa al giorno.',
      }),
    });
    if (!response.ok) throw new Error(`patient create failed: ${response.status}`);
    return (await response.json() as { id: string }).id;
  });
}

function availablePreview() {
  const providerReceipt = {
    schemaVersion: 'mediflow.ai.provider-selection.v1',
    authorityPlane: 'clinical_application',
    task: 'clinical',
    provider: FIXTURE_MODEL.provider,
    model: FIXTURE_MODEL.model,
    execution: 'local',
    endpointClass: 'loopback',
    egress: 'none',
    runtimeReadiness: 'required',
    fallbackCount: 0,
  };
  const receipt = {
    schemaVersion: 'mediflow.ai.fabric-resolution.v1',
    capability: 'smart_import',
    class: 'generative',
    venue: 'local_process',
    egressProfile: { id: 'local_only', version: 'mediflow.ai.egress-profile.v1', egress: 'none' },
    provider: FIXTURE_MODEL.provider,
    model: FIXTURE_MODEL.model,
    providerReceipt,
    fallbackCount: 0,
  };
  return {
    preview: {
      writesPerformed: 0,
      apply: 'denied',
      status: 'available',
      code: null,
      proposal: {
        schemaVersion: 'mediflow.smart-import.proposal.v1',
        generatedAt: '2026-09-01T10:00:00.000Z',
        contract: { validJson: true, validTask: true, legacyContract: false },
        summary: 'Proposta sintetica da rivedere.',
        diagnoses: [{ label: 'Diagnosi sintetica', icdQuery: 'synthetic', confidence: 'high', evidence: 'Evidenza sintetica', sourceId: 'source.synthetic.1' }],
        therapies: [],
        servicePrescriptions: [],
        writesPerformed: 0,
      },
      receipt,
      provenance: {
        schemaVersion: 'mediflow.ai.fabric-provenance.v1',
        capability: 'smart_import',
        venue: 'local_process',
        provider: FIXTURE_MODEL.provider,
        model: FIXTURE_MODEL.model,
        preprocessing: ['context_minimization', 'envelope_validation'],
        receipt,
      },
      reviewRef: `review_${HEX.review}`,
    },
  };
}

async function installSmartImportFixture(page: Page, options: { beforePreview?: () => Promise<void>; fail?: () => boolean } = {}) {
  const calls = { context: 0, selectionGet: 0, selectionPost: 0, ingest: 0, preview: 0, legacyApply: 0 };
  let catalogReads = 0;
  await page.route('**/api/settings/ai/functions', async route => {
    expect(route.request().method()).toBe('GET');
    catalogReads += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE_CATALOG) });
  });

  await page.route('**/api/context', async (route) => {
    calls.context += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ambulatoryId: 'ambulatory.synthetic' }) });
  });
  await page.route('**/api/ai/smart-import/selection', async (route) => {
    if (route.request().method() === 'GET') {
      calls.selectionGet += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ selectionEpoch: 0 }) });
      return;
    }
    calls.selectionPost += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ selection: {
        sessionRef: `ssr_${HEX.session}`,
        selectionEpoch: 1,
        patientRef: `ptr_${HEX.patient}`,
        ambulatoryRef: `abr_${HEX.ambulatory}`,
        leaseRef: `lsr_${HEX.lease}`,
        expiresAt: Number.MAX_SAFE_INTEGER,
      } }),
    });
  });
  await page.route('**/api/ai/smart-import/ingest', async (route) => {
    calls.ingest += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ handle: `prj_${HEX.projection}` }) });
  });
  await page.route('**/api/ai/smart-import/preview', async (route) => {
    calls.preview += 1;
    expect(route.request().method()).toBe('POST');
    const modelHeader = route.request().headers()['x-mediflow-function-model'];
    if (calls.preview === 1) expect(JSON.parse(modelHeader ?? 'null')).toEqual({
      modelOptionId: FIXTURE_MODEL.modelOptionId,
      expectedCatalogRevision: FIXTURE_CATALOG.catalogRevision,
    });
    await options.beforePreview?.();
    await route.fulfill(options.fail?.() ? { status: 503, json: { error: 'synthetic-unavailable' } } : { status: 200, json: availablePreview() });
  });
  await page.route('**/api/patients/*/smart-import', async (route) => {
    calls.legacyApply += 1;
    await route.abort();
  });

  return { calls, catalogReads: () => catalogReads };
}

test('[E2E fixture] Smart Import exposes only the Fabric review preview and never calls legacy apply', async ({ page }) => {
  const { calls, catalogReads } = await installSmartImportFixture(page);
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await page.route('**/api/ambulatories', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'ambulatory.synthetic', name: 'Ambulatorio di prova', address: '', version: 1 }]) }));
  await setAiLaneKillSwitch(page, 'aiSmartImportKillSwitch', 'enabled');
  const patientId = await createPatient(page);
  await page.goto(`/patients/${patientId}/modules#quadro`);
  await openPatientSection(page, 'quadro');
  await expect(page.locator('#quadro')).toBeVisible();
  await expect(page.locator('#quadro [data-testid="fabric-preview-card"]')).toHaveCount(0);
  await expect(page.getByTestId('patient-proposals-summary')).toContainText('Nessuna proposta da rivedere');
  await openPatientSection(page, 'documenti');
  await page.locator('#smart-import').getByRole('button', { name: 'Proposte', exact: true }).click();

  const card = page.getByTestId('fabric-preview-card');
  await expect(page.getByTestId('patient-proposals-summary')).toHaveCount(1);
  expect(calls.preview).toBe(0);
  await expect(card).toContainText('Raccogli dalle fonti della cartella');
  await card.getByRole('button', { name: 'Prepara proposta' }).click();
  await expect(card.getByRole('checkbox')).toBeDisabled();
  await card.getByRole('combobox', { name: 'Ambulatorio per questa proposta' }).selectOption('ambulatory.synthetic');
  await card.getByTestId('model-picker-smart_import').getByRole('button', { name: 'Cambia', exact: true }).click();
  const modelPicker = card.getByRole('combobox', { name: 'Modello per questa proposta' });
  await modelPicker.focus();
  await expect(modelPicker.locator('option')).toHaveText([
    `Predefinito · ${FIXTURE_MODEL.model}`,
    'OpenAI · abbonamento ChatGPT · prepara',
    `${FIXTURE_MODEL.model} · Ollama · locale`,
  ]);
  await modelPicker.selectOption(FIXTURE_MODEL.modelOptionId);
  await expect(modelPicker).toHaveValue(FIXTURE_MODEL.modelOptionId);
  await card.getByRole('checkbox').check();
  await card.getByRole('button', { name: 'Conferma e genera proposta' }).click();

  await expect(card).toContainText('0 scritture · applicazione non consentita');
  await expect(card).toContainText('Proposta sintetica da rivedere.');
  await expect(card).toContainText('1 diagnosi · 0 terapie · 0 prestazioni');
  await expect(card).toContainText(`Modello usato: ${FIXTURE_MODEL.provider} · ${FIXTURE_MODEL.model}`);
  await card.getByText('Dettagli di verifica', { exact: true }).click();
  await expect(card.getByTestId('smart-import-fabric-disclosure'))
    .toContainText(`${FIXTURE_MODEL.provider} · ${FIXTURE_MODEL.model} · local_process`);
  expect(catalogReads()).toBeGreaterThanOrEqual(2); // Selection read plus pre-generation reread.
  expect(calls).toEqual({ context: 0, selectionGet: 1, selectionPost: 1, ingest: 1, preview: 1, legacyApply: 0 });
});

for (const theme of ['giorno', 'grafite']) for (const size of ['1440', '768', '390', '320', 'zoom-200', 'zoom-400']) {
  test(`Smart Import composizione ${theme} ${size}`, async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    const baseline = process.env.SMART_IMPORT_BASELINE === '1';
    const zoom = size.startsWith('zoom-') ? await openBrowserZoomFixture(baseURL!) : undefined;
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let fail = false;
    try {
      if (zoom) page = zoom.page;
      const runtimeErrors: string[] = [];
      page.on('pageerror', error => runtimeErrors.push(error.message));
      const { calls } = await installSmartImportFixture(page, { beforePreview: async () => { entered.resolve(); await release.promise; }, fail: () => fail });
      await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
      await page.route('**/api/ambulatories', route => route.fulfill({ json: [{ id: 'ambulatory.synthetic', name: 'Ambulatorio di prova', address: '', version: 1 }] }));
      await setAiLaneKillSwitch(page, 'aiSmartImportKillSwitch', 'enabled');
      const patientId = await createPatient(page);
      await page.goto(`/patients/${patientId}/modules`);
      await openPatientSection(page, baseline ? 'quadro' : 'documenti');
      const disclosure = page.locator('#smart-import');
      const toggle = disclosure.locator(':scope > div > [data-disclosure-control]');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await toggle.focus(); await page.keyboard.press('Enter');
      const card = page.getByTestId('fabric-preview-card');
      await page.setViewportSize({ width: zoom ? 1440 : Number(size), height: 1000 });
      await page.evaluate(theme => {
        document.documentElement.classList.toggle('dark', theme === 'grafite');
        document.documentElement.classList.toggle('light', theme === 'giorno');
      }, theme);
      if (zoom) await zoom.setZoom(size === 'zoom-200' ? 2 : 4);
      const directory = process.env.SMART_IMPORT_CAPTURES;
      if (directory) await mkdir(directory, { recursive: true });
      const capture = async (state: string) => {
        await card.scrollIntoViewIfNeeded();
        if (!baseline) await assertNoHorizontalOverflow(page, [{ label: 'Smart Import', selector: '#smart-import' }, { label: 'pagina', selector: 'document' }]);
        if (directory) await page.screenshot({ path: `${directory}/${theme}-${size}-${state}.png`, animations: 'disabled' });
      };
      await capture('pronta');
      await card.getByRole('button', { name: 'Cambia', exact: true }).click();
      await card.getByRole('combobox', { name: 'Modello per questa proposta', exact: true }).selectOption(FIXTURE_MODEL.modelOptionId);
      const prepare = card.getByRole('button', { name: 'Prepara proposta', exact: true });
      await prepare.focus(); await page.keyboard.press('Enter');
      const generate = card.getByRole('button', { name: 'Conferma e genera proposta', exact: true });
      await expect(generate).toBeDisabled();
      await expect(card.getByRole('checkbox')).toBeDisabled();
      await card.getByRole('button', { name: 'Annulla', exact: true }).click();
      await expect(prepare).toBeVisible();
      expect(calls.ingest).toBe(0); expect(calls.preview).toBe(0);
      await prepare.click();
      const ambulatory = card.getByRole('combobox', { name: 'Ambulatorio per questa proposta' });
      await ambulatory.focus(); await expect(ambulatory).toBeFocused(); await ambulatory.selectOption('ambulatory.synthetic');
      await expect(ambulatory).toHaveValue('ambulatory.synthetic');
      await expect(generate).toBeDisabled();
      const consent = card.getByRole('checkbox');
      await consent.focus(); await page.keyboard.press('Space'); await expect(consent).toBeChecked();
      await capture('conferma');
      await generate.click(); await entered.promise;
      await capture('in-corso'); release.resolve();
      await expect(card).toContainText('Proposta sintetica da rivedere.');
      await capture('proposta');
      if (!baseline) {
        await expect(card.getByTestId('smart-import-review-proposal').locator('[data-ink="pencil"]')).toBeVisible();
        await expect(card).toContainText('Fonti raccolte per la proposta');
        const source = card.getByRole('link', { name: 'Note paziente', exact: true });
        await source.scrollIntoViewIfNeeded(); await source.focus(); await assertNotClippedInViewport(source, 'Fonte Note paziente');
        if (directory) await page.screenshot({ path: `${directory}/${theme}-${size}-fonti.png`, animations: 'disabled' });
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(new RegExp(`/patients/${patientId}/modules#quadro$`));
        await expect(page.locator('#quadro')).toBeVisible();
        await expect(card).not.toBeVisible();
        const summary = page.getByTestId('patient-proposals-summary');
        await expect(summary).toContainText('1 proposta da rivedere');
        await summary.getByRole('link', { name: 'Smart Import', exact: true }).click(); await expect(card).toBeVisible();
        expect(calls.preview).toBe(1);
      }
      fail = true;
      await card.getByRole('button', { name: 'Ricomincia', exact: true }).click();
      await card.getByRole('button', { name: 'Prepara proposta', exact: true }).click();
      await ambulatory.selectOption('ambulatory.synthetic'); await consent.check();
      await generate.click();
      await expect(card).toContainText('Anteprima non disponibile.'); await capture('errore');
      expect(calls.legacyApply).toBe(0);
      if (!baseline) {
        await openPatientSection(page, 'quadro');
        await expect(page.getByTestId('patient-proposals-summary')).toContainText('Nessuna proposta da rivedere');
      }
      expect(runtimeErrors).toEqual([]);
      await setAiLaneKillSwitch(page, 'aiSmartImportKillSwitch', 'disabled');
      await page.reload(); await openPatientSection(page, baseline ? 'quadro' : 'documenti'); await toggle.click();
      await expect(prepare).toBeDisabled(); await capture('spenta');
      await test.info().attach('surface', { body: JSON.stringify({ theme, size, baseline,
        revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        zoom: zoom ? { mechanism: 'chrome.tabs.setZoom/getZoom', factor: size === 'zoom-200' ? 2 : 4, physicalWidth: 1440, innerWidth: await page.evaluate(() => innerWidth) } : null }), contentType: 'application/json' });
    } finally { release.resolve(); await zoom?.close(); }
  });
}

test('Proposte combinate: un solo conteggio effettivo e due destinazioni senza rigenerare', async ({ baseURL }) => {
  test.setTimeout(120_000);
  const zoom = await openBrowserZoomFixture(baseURL!);
  const page = zoom.page;
  let insightCalls = 0;
  try {
    const { calls } = await installSmartImportFixture(page);
    const catalog = { ...FIXTURE_CATALOG, functions: FIXTURE_CATALOG.functions.map(row => ({ ...row,
      enabled: row.id === 'patient_insight' || row.id === 'smart_import' })) };
    await page.route('**/api/settings/ai/functions', route => route.fulfill({ json: catalog }));
    await page.route('**/api/ai/patient-insight/preview', route => {
      insightCalls += 1;
      const request = route.request().postDataJSON() as { capturedAt: string; patientRevision: number };
      return route.fulfill({ json: { preview: {
        writesPerformed: 0, apply: 'denied', status: 'available', code: null,
        proposal: { schemaVersion: 'mediflow.patient-insight.review-proposal.v2', reviewOnly: true,
          summary: 'Proposta Insight sintetica combinata. [S1]', currentState: [], alerts: [], nextSteps: [], gaps: [],
          generatedAt: request.capturedAt, currentness: { selectionEpoch: 7, patientRevision: request.patientRevision,
            projectionDigest: `sha256_${'a'.repeat(64)}`, capturedAt: request.capturedAt, verifiedAt: request.capturedAt } },
        receipt: { schemaVersion: 'mediflow.ai.fabric-resolution.v1', capability: 'patient_insight', venue: 'local_process',
          provider: 'ollama', model: FIXTURE_MODEL.model, egress: 'none' },
        provenance: { schemaVersion: 'mediflow.ai.fabric-provenance.v1', capability: 'patient_insight', venue: 'local_process',
          provider: 'ollama', model: FIXTURE_MODEL.model, preprocessing: ['context_minimization', 'envelope_validation'] },
        reviewRef: `review_${HEX.review}`,
      } } });
    });
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    await page.route('**/api/ambulatories', route => route.fulfill({ json: [{ id: 'ambulatory.synthetic', name: 'Ambulatorio di prova', address: '', version: 1 }] }));
    await setAiLaneKillSwitch(page, 'aiPatientInsightKillSwitch', 'enabled');
    await setAiLaneKillSwitch(page, 'aiSmartImportKillSwitch', 'enabled');
    const patientId = await createPatient(page);
    await page.goto(`/patients/${patientId}/modules`); await openPatientSection(page, 'quadro');
    const summary = page.getByTestId('patient-proposals-summary');
    await expect(summary).toHaveCount(1); await expect(summary).toContainText('Nessuna proposta da rivedere');
    await expect(summary.getByRole('link')).toHaveCount(2);
    await summary.getByRole('link', { name: 'Patient Insight', exact: true }).click();
    const insight = page.locator('#patient-insight');
    await insight.locator(':scope > div > [data-disclosure-control]').click();
    await insight.getByRole('button', { name: 'Cambia', exact: true }).click();
    await insight.getByRole('combobox', { name: 'Modello per questa proposta' }).selectOption(FIXTURE_MODEL.modelOptionId);
    await insight.getByRole('button', { name: 'Avvia supporto', exact: true }).click();
    const insightProposal = insight.getByTestId('patient-insight-review-proposal');
    await expect(insightProposal).toBeVisible();
    await openPatientSection(page, 'quadro'); await expect(summary).toContainText('1 proposta da rivedere');
    await expect(insightProposal).not.toBeVisible();
    await summary.getByRole('link', { name: 'Smart Import', exact: true }).click();
    const smart = page.locator('#smart-import');
    await smart.locator(':scope > div > [data-disclosure-control]').click();
    await smart.getByRole('button', { name: 'Cambia', exact: true }).click();
    await smart.getByRole('combobox', { name: 'Modello per questa proposta' }).selectOption(FIXTURE_MODEL.modelOptionId);
    await smart.getByRole('button', { name: 'Prepara proposta', exact: true }).click();
    await smart.getByRole('combobox', { name: 'Ambulatorio per questa proposta' }).selectOption('ambulatory.synthetic');
    await smart.getByRole('checkbox').check(); await smart.getByRole('button', { name: 'Conferma e genera proposta', exact: true }).click();
    const smartProposal = smart.getByTestId('smart-import-review-proposal');
    await expect(smartProposal).toBeVisible();
    await openPatientSection(page, 'quadro'); await expect(summary).toContainText('2 proposte da rivedere');
    await expect(summary).toHaveCount(1); await expect(insightProposal).not.toBeVisible(); await expect(smartProposal).not.toBeVisible();
    await expect(page.locator('#quadro [data-testid$="review-proposal"]')).toHaveCount(0);
    const directory = process.env.SMART_IMPORT_CAPTURES;
    for (const theme of ['giorno', 'grafite']) for (const size of ['1440', '768', '390', '320', 'zoom-200', 'zoom-400']) {
      await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
      if (size.startsWith('zoom-')) await zoom.setZoom(size === 'zoom-200' ? 2 : 4);
      else await page.setViewportSize({ width: Number(size), height: 1000 });
      await page.evaluate(theme => {
        document.documentElement.classList.toggle('dark', theme === 'grafite');
        document.documentElement.classList.toggle('light', theme === 'giorno');
      }, theme);
      await summary.scrollIntoViewIfNeeded();
      await assertNoHorizontalOverflow(page, [{ label: 'pagina', selector: 'document' }, { label: 'Riepilogo proposte', selector: '[data-testid="patient-proposals-summary"]' }]);
      for (const name of ['Patient Insight', 'Smart Import']) await assertNotClippedInViewport(summary.getByRole('link', { name, exact: true }), name);
      if (directory) { await mkdir(directory, { recursive: true }); await page.screenshot({ path: `${directory}/${theme}-${size}-riepilogo-combinato.png`, animations: 'disabled' }); }
    }
    await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
    await summary.getByRole('link', { name: 'Patient Insight', exact: true }).click();
    await expect(insightProposal).toBeVisible(); await insight.getByRole('button', { name: 'Riusa predefinito', exact: true }).click();
    await openPatientSection(page, 'quadro'); await expect(summary).toContainText('1 proposta da rivedere');
    await summary.getByRole('link', { name: 'Smart Import', exact: true }).click();
    await expect(smartProposal).toBeVisible(); await smart.getByRole('button', { name: 'Ricomincia', exact: true }).click();
    await openPatientSection(page, 'quadro'); await expect(summary).toContainText('Nessuna proposta da rivedere');
    expect(insightCalls).toBe(1); expect(calls.preview).toBe(1); expect(calls.legacyApply).toBe(0);
  } finally { await zoom.close(); }
});
