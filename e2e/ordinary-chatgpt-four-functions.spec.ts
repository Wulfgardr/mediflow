/* @Codex: four real clinical UI journeys with an entirely synthetic HTTP peer. */
import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { bootstrapUnlockedSession, openPatientSection, setAiLaneKillSwitch } from './utils';
import { finishOrdinaryChatGpt, installOrdinaryChatGptTransport, remoteMetadata, selectOrdinaryChatGpt } from './ordinary-chatgpt-ui-fixture';
import { snapshotTreatmentReasoningProjectionAttachment, type TreatmentReasoningProjectionAttachment } from '../lib/ai-providers/fabric/treatment-reasoning-projection';

const HEX = { session: '1'.repeat(32), patient: '2'.repeat(32), ambulatory: '3'.repeat(32), lease: '4'.repeat(32), projection: '5'.repeat(32) };
const AMBULATORY = { id: 'ambulatory.synthetic', name: 'Ambulatorio di prova', address: '', version: 1 };
const json = (route: import('@playwright/test').Route, value: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });

async function createPatient(page: Page, prefix: string, notes?: string) {
  return page.evaluate(async ({ prefix, notes }) => {
    const response = await fetch('/api/patients', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      firstName: prefix, lastName: 'Synthetic Review', taxCode: `${prefix.toUpperCase().slice(0, 4)}${Date.now()}`,
      birthDate: '1975-01-01T00:00:00.000Z', address: 'Via sintetica 1', phone: '0000000086',
      ...(notes ? { notes } : {}),
    }) });
    if (!response.ok) throw new Error(`Synthetic patient fixture HTTP ${response.status}`);
    return (await response.json() as { id: string }).id;
  }, { prefix, notes });
}

async function installSelectionFixture(page: Page) {
  await page.route('**/api/ambulatories', route => json(route, [AMBULATORY]));
  await page.route('**/api/ai/smart-import/selection', route => json(route, route.request().method() === 'GET'
    ? { selectionEpoch: 0 }
    : { selection: { sessionRef: `ssr_${HEX.session}`, selectionEpoch: 1, patientRef: `ptr_${HEX.patient}`,
      ambulatoryRef: `abr_${HEX.ambulatory}`, leaseRef: `lsr_${HEX.lease}`, expiresAt: Number.MAX_SAFE_INTEGER } }));
}

test.describe.configure({ retries: 0 });

test('Patient Insight ordinary ChatGPT: consent, catalog, review-only source proposal', async ({ page }) => {
  let request: { capturedAt: string; patientRevision: number } | null = null;
  const remote = await installOrdinaryChatGptTransport(page, 'patient_insight', () => {
    if (!request) throw new Error('Missing original Patient Insight request');
    const { receipt, provenance } = remoteMetadata('patient_insight');
    return { preview: { writesPerformed: 0, apply: 'denied', status: 'available', code: null,
      proposal: { schemaVersion: 'mediflow.patient-insight.review-proposal.v2', reviewOnly: true,
        summary: 'Sintesi remota sintetica da rivedere. [S1]', currentState: ['Fonte clinica sintetica. [S1]'],
        alerts: [], nextSteps: ['Rivedere la fonte. [S1]'], gaps: [], generatedAt: request.capturedAt,
        currentness: { selectionEpoch: 1, patientRevision: request.patientRevision,
          projectionDigest: `sha256_${'d'.repeat(64)}`, capturedAt: request.capturedAt, verifiedAt: request.capturedAt } },
      receipt, provenance, reviewRef: `review_${'e'.repeat(32)}` } };
  });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await setAiLaneKillSwitch(page, 'aiPatientInsightKillSwitch', 'enabled');
  const patientId = await createPatient(page, 'Insight');
  await page.goto(`/patients/${patientId}/modules#quadro`); await openPatientSection(page, 'quadro');
  const disclosure = page.locator('#patient-insight'); await disclosure.locator(':scope > summary').click();
  const controls = await selectOrdinaryChatGpt(disclosure);
  remote.arm(); await disclosure.getByRole('button', { name: 'Avvia supporto' }).click();
  await expect(controls).toContainText('Contesto preparato e redatto: 100 byte.');
  request = remote.previews[0] as typeof request;
  await finishOrdinaryChatGpt(controls);
  const proposal = page.getByTestId('patient-insight-review-proposal');
  await expect(proposal).toContainText('Sintesi remota sintetica da rivedere. [S1]');
  await expect(proposal).toContainText('Fonte clinica sintetica. [S1]');
  await expect(proposal).toContainText('0 scritture');
  await expect(proposal).toContainText('chatgpt_subscription · synthetic-current-model · cloud');
  remote.assertCompleted();
});

test('Smart Import ordinary ChatGPT: selected context returns a source-linked proposal without apply', async ({ page }) => {
  const { receipt, provenance } = remoteMetadata('smart_import');
  const remote = await installOrdinaryChatGptTransport(page, 'smart_import', () => ({ preview: {
    writesPerformed: 0, apply: 'denied', status: 'available', code: null,
    proposal: { schemaVersion: 'mediflow.smart-import.proposal.v1', generatedAt: '2026-09-01T10:00:00.000Z',
      contract: { validJson: true, validTask: true, legacyContract: false }, summary: 'Proposta remota sintetica da rivedere.',
      diagnoses: [{ label: 'Diagnosi sintetica', icdQuery: 'synthetic', confidence: 'high', evidence: 'Evidenza sintetica', sourceId: 'source.synthetic.1' }],
      therapies: [], servicePrescriptions: [], writesPerformed: 0 }, receipt, provenance, reviewRef: `review_${'6'.repeat(32)}`,
  } }));
  await page.route('**/api/context', route => json(route, { ambulatoryId: AMBULATORY.id }));
  await installSelectionFixture(page);
  await page.route('**/api/ai/smart-import/ingest', route => json(route, { handle: `prj_${HEX.projection}` }));
  let legacyApply = 0;
  await page.route('**/api/patients/*/smart-import', route => { legacyApply += 1; return route.abort(); });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await setAiLaneKillSwitch(page, 'aiSmartImportKillSwitch', 'enabled');
  const patientId = await createPatient(page, 'Smart', 'Diagnosi sintetica in revisione.');
  await page.goto(`/patients/${patientId}/modules#quadro`); await openPatientSection(page, 'quadro');
  await page.getByText('Proposte dalle fonti cliniche · Smart Import', { exact: true }).click();
  const card = page.getByTestId('fabric-preview-card');
  await card.getByRole('button', { name: 'Prepara proposta' }).click();
  await card.getByRole('combobox', { name: 'Ambulatorio per questa proposta' }).selectOption(AMBULATORY.id);
  await card.getByRole('checkbox', { name: /Confermo paziente e ambulatorio/u }).check();
  const controls = await selectOrdinaryChatGpt(card);
  remote.arm(); await card.getByRole('button', { name: 'Conferma e genera proposta' }).click();
  await finishOrdinaryChatGpt(controls);
  await expect(card).toContainText('Proposta remota sintetica da rivedere.');
  await expect(card).toContainText('0 scritture · applicazione non consentita');
  await expect(card).toContainText('chatgpt_subscription · synthetic-current-model');
  await card.getByText('Dettagli di verifica').click();
  await expect(card).toContainText('Testo redatto inviato a OpenAI con consenso · nessun provider alternativo');
  expect(legacyApply).toBe(0); remote.assertCompleted();
});

test('Document Synthesis ordinary ChatGPT: encrypted fixture, source citation and review-only wire', async ({ page }) => {
  const markdown = '# Documento sintetico\n\nFonte clinica sintetica di sola prova.';
  const quote = 'Fonte clinica sintetica di sola prova.';
  const { receipt, provenance } = remoteMetadata('document_synthesis');
  const remote = await installOrdinaryChatGptTransport(page, 'document_synthesis', () => ({
    schemaVersion: 'mediflow.document-synthesis.preview-wire.v1', status: 'available', publication: {
      output: { schemaVersion: 'mediflow.ai.extract.v1', task: 'document_synthesis', summary: 'Sintesi remota sintetica con fonte [S1].', qualityLevel: 'green' },
      citations: [{ label: 'S1', quote, startByte: Buffer.byteLength('# Documento sintetico\n\n'), endByte: Buffer.byteLength(markdown), quoteSha256: createHash('sha256').update(quote).digest('hex') }],
      receipt: { schemaVersion: 'mediflow.document-synthesis.publication-receipt.v1', capability: 'document_synthesis', outputSha256: 'c'.repeat(64),
        claimCitationsDigestSha256: Array(32).fill(1), sourceSetDigestSha256: Array(32).fill(2), providerBindingReceipt: receipt,
        reviewOnly: true, applyPolicy: 'none', writesPerformed: 0 },
      provenance: { schemaVersion: 'mediflow.document-synthesis.publication-provenance.v1', capability: 'document_synthesis',
        sourceSetAuthority: 'application_host', inputDigestScope: 'ordered_normalized_provider_projection_set',
        citationSupport: 'provider_declared_host_membership_and_locator_validated', modelCausality: 'not_established', fabricProvenance: provenance },
    },
  }));
  await page.route('**/api/ai/document-synthesis/capture', route => json(route, { captureHandle: `dsc_${'1'.repeat(32)}` }));
  await page.route('**/api/ai/document-synthesis/ingest', route => json(route, { previewHandle: `dsp_${'2'.repeat(32)}` }));
  await page.route('**/api/attachments/*/local-extraction', route => json(route, {
    schemaVersion: 'mediflow.anydoc_local_extraction.v1', provenance: { attachmentId: 'synthetic-fixture', sourceSha256: 'a'.repeat(64), byteLength: 24 },
    receipt: { receiptId: 'b'.repeat(64), parser: 'anydoc-local', outcome: 'extracted', sourceSha256: 'a'.repeat(64), sourceByteLength: 24,
      markdownSha256: createHash('sha256').update(markdown).digest('hex'), markdownByteLength: Buffer.byteLength(markdown) },
    review: 'required', writes: 0, apply: 'none', status: 'extracted', markdown, candidateUse: 'review_only',
  }));
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await setAiLaneKillSwitch(page, 'aiDocumentSynthesisKillSwitch', 'enabled');
  const patientId = await createPatient(page, 'Document');
  await page.goto(`/patients/${patientId}/modules`); await openPatientSection(page, 'documenti');
  const fileName = `documento-ordinary-${Date.now()}.rtf`;
  const saved = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/attachments');
  await page.locator('#documenti input[type="file"]').setInputFiles({ name: fileName, mimeType: 'application/rtf',
    buffer: Buffer.from('{\\rtf1\\ansi Documento sintetico cifrato dalla facade.}') });
  expect((await saved).ok()).toBe(true);
  const uploaded = (await saved).request().postDataJSON() as { id: string; data: string };
  expect(uploaded.data).toMatch(/^ENC:/u);
  await page.getByRole('button', { name: `Prepara sintesi di ${fileName}` }).click();
  const card = page.getByTestId(`document-synthesis-fabric-review-${uploaded.id}`);
  await card.getByRole('button', { name: 'Genera proposta' }).click();
  await card.getByLabel('Ambulatorio per questa proposta').selectOption({ index: 1 });
  await card.getByRole('checkbox', { name: /Confermo paziente, documento/u }).check();
  const controls = await selectOrdinaryChatGpt(card);
  remote.arm(); await card.getByRole('button', { name: 'Conferma e genera proposta' }).click();
  await finishOrdinaryChatGpt(controls);
  await expect(card).toContainText('Sintesi remota sintetica con fonte [S1].');
  await card.getByText(/Citazioni dal documento/u).click();
  await expect(card).toContainText(quote);
  await card.getByText('Dettagli di verifica').click();
  await expect(card).toContainText('0 scritture · applicazione non consentita');
  remote.assertCompleted();
});

test('Treatment Reasoning ordinary ChatGPT: source bindings and remote trace remain review-only', async ({ page }) => {
  let projection: TreatmentReasoningProjectionAttachment | null = null;
  const { receipt, provenance } = remoteMetadata('treatment_reasoning');
  const remote = await installOrdinaryChatGptTransport(page, 'treatment_reasoning', () => {
    if (!projection) throw new Error('Missing original Treatment Reasoning projection');
    const source = projection.evidenceRefs[0] ?? projection.therapyRefs[0];
    if (!source) throw new Error('Missing synthetic source reference');
    const summary = 'Sintesi terapeutica remota sintetica da rivedere.';
    const recommendation = 'Rivedere la terapia sintetica con la fonte corrente.';
    return { schemaVersion: 'mediflow.ai.treatment-reasoning-publication.chatgpt.v1', capability: 'treatment_reasoning',
      stage: 'preview', review: 'required', status: 'available',
      value: { schemaVersion: 'mediflow.treatment_reasoning.v1', task: 'treatment_reasoning', summary,
        data: { recommendation, keyEvidence: [], reasoning: [], caveats: [], safetyFlags: [], suggestedActions: [],
          trace: { mode: 'chatgpt_subscription', toolsUsed: [], limitations: ['Solo fonti sintetiche selezionate.'] } } },
      sourceBindings: [{ claimPath: 'summary', claim: summary, evidenceRefs: [source] },
        { claimPath: 'data.recommendation', claim: recommendation, evidenceRefs: [source] }],
      attestation: receipt, fabricReceipt: receipt, provenance, sourceRevision: projection.sourceRevision,
      capturedAt: projection.capturedAt, writesPerformed: 0, applyPolicy: 'none' };
  });
  await installSelectionFixture(page);
  await page.route('**/api/ai/treatment-reasoning/ingest', route => {
    const body = route.request().postDataJSON() as { projection: unknown };
    projection = snapshotTreatmentReasoningProjectionAttachment(body.projection, new Date().toISOString());
    return json(route, { handle: `trp_${'a'.repeat(32)}` });
  });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await setAiLaneKillSwitch(page, 'aiTreatmentReasoningKillSwitch', 'enabled');
  const patientId = await createPatient(page, 'Treatment');
  const therapy = await page.evaluate(async id => {
    const response = await fetch('/api/therapies', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      id: `therapy.synthetic.${Date.now()}`, patientId: id, drugName: 'Farmaco sintetico', activePrinciple: 'Principio sintetico',
      dosage: '5 mg una volta al giorno', status: 'active', startDate: '2026-08-20T08:00:00.000Z',
    }) }); return response.ok;
  }, patientId);
  expect(therapy).toBe(true);
  await page.goto(`/patients/${patientId}/modules`); await openPatientSection(page, 'terapie');
  const panel = page.getByTestId('treatment-reasoning-panel');
  await panel.getByRole('button', { name: 'Genera bozza' }).click();
  await panel.getByLabel('Ambulatorio per questa bozza').selectOption(AMBULATORY.id);
  await panel.getByRole('checkbox', { name: /Confermo paziente e ambulatorio/u }).check();
  const controls = await selectOrdinaryChatGpt(panel);
  remote.arm(); await panel.getByRole('button', { name: 'Conferma e genera bozza' }).click();
  await finishOrdinaryChatGpt(controls);
  await expect(panel).toContainText('Sintesi terapeutica remota sintetica da rivedere.');
  await expect(panel).toContainText('0 scritture');
  await panel.getByText('Fonti citate per claim').click();
  await expect(panel).toContainText('data.recommendation');
  await panel.getByText('Receipt, provenienza e currentness').click();
  await expect(panel).toContainText('OpenAI · synthetic-current-model · medium');
  remote.assertCompleted();
});

test('ordinary ChatGPT preparation closes on patient-context navigation before consent', async ({ page }) => {
  const remote = await installOrdinaryChatGptTransport(page, 'patient_insight', () => {
    throw new Error('No synthetic generation is allowed after context navigation');
  });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await setAiLaneKillSwitch(page, 'aiPatientInsightKillSwitch', 'enabled');
  const patientId = await createPatient(page, 'Cancel');
  await page.goto(`/patients/${patientId}/modules#quadro`); await openPatientSection(page, 'quadro');
  const disclosure = page.locator('#patient-insight'); await disclosure.locator(':scope > summary').click();
  const controls = await selectOrdinaryChatGpt(disclosure);
  remote.arm(); await disclosure.getByRole('button', { name: 'Avvia supporto' }).click();
  await expect(controls).toContainText('Contesto preparato e redatto: 100 byte.');
  await page.getByRole('link', { name: 'Pazienti', exact: true }).first().click();
  await expect(page).toHaveURL(/\?area=incarico/u);
  await expect.poll(() => remote.operations.filter(value => value === 'cancel').length).toBe(1);
  expect(remote.operations).not.toContain('generate');
  expect(remote.clinicalWrites).toEqual([]);
});
