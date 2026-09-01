/* @Codex */
import { expect, test, type Page } from '@playwright/test';

import {
  snapshotTreatmentReasoningProjectionAttachment,
  type TreatmentReasoningProjectionAttachment,
} from '../lib/ai-providers/fabric/treatment-reasoning-projection';
import { bootstrapUnlockedSession, setAiLaneKillSwitch } from './utils';

const HANDLE = `trp_${'a'.repeat(32)}`;
const RECEIPT_REF = 'receipt_synthetic_01';
const PROVENANCE_REF = 'provenance_synthetic_01';

type Projection = TreatmentReasoningProjectionAttachment;

type RecordedBodies = {
  selection?: unknown;
  ingest?: unknown;
  preview?: unknown;
};

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return keys;
  }
  if (!value || typeof value !== 'object') return keys;
  for (const [key, item] of Object.entries(value)) {
    keys.add(key);
    collectKeys(item, keys);
  }
  return keys;
}

function publicationFor(projection: Projection) {
  const profileRef = projection.evidenceRefs[0];
  const therapyRef = projection.therapyRefs[0];
  if (!profileRef || !therapyRef) throw new Error('La projection sintetica deve includere profilo e terapia.');

  const fabricReceipt = {
    schemaVersion: 'mediflow.ai.fabric-resolution.v1',
    capability: 'treatment_reasoning',
    class: 'generative',
    venue: 'local_process',
    egressProfile: {
      id: 'local_only',
      version: 'mediflow.ai.egress-profile.v1',
      egress: 'none',
    },
    provider: 'athena_mlx',
    model: null,
    providerReceipt: null,
    fallbackCount: 0,
  };
  const summary = 'Sintesi terapeutica sintetica da revisionare.';
  const recommendation = 'Rivedere la terapia sintetica prima di ogni decisione clinica.';
  const reasoning = 'La fonte terapeutica richiede conferma clinica.';
  const caveat = 'Fixture sintetica, non prescrittiva.';

  return {
    schemaVersion: 'mediflow.ai.treatment-reasoning-publication.v1',
    capability: 'treatment_reasoning',
    stage: 'preview',
    review: 'required',
    status: 'available',
    value: {
      schemaVersion: 'mediflow.treatment_reasoning.v1',
      task: 'treatment_reasoning',
      summary,
      data: {
        recommendation,
        keyEvidence: [{
          id: 'evidence.synthetic.therapy',
          statement: 'Terapia sintetica presente nel contesto corrente.',
          evidenceRefs: [therapyRef],
        }],
        reasoning: [reasoning],
        caveats: [caveat],
        safetyFlags: [{
          id: 'safety.synthetic.review',
          severity: 'caution',
          label: 'Revisione richiesta',
          rationale: 'Il risultato resta una proposta non applicabile.',
          evidenceRefs: [profileRef],
        }],
        suggestedActions: [{
          id: 'action.synthetic.review',
          intent: 'review_only',
          label: 'Rivedi le evidenze',
          rationale: 'Nessuna scrittura clinica è consentita.',
          writePolicy: 'review_only',
          evidenceRefs: [therapyRef],
        }],
        trace: {
          mode: 'local_model',
          toolsUsed: [],
          limitations: ['Nessun lookup esterno.'],
        },
      },
    },
    sourceBindings: [
      { claimPath: 'summary', claim: summary, evidenceRefs: [profileRef] },
      { claimPath: 'data.recommendation', claim: recommendation, evidenceRefs: [therapyRef] },
      { claimPath: 'data.reasoning.0', claim: reasoning, evidenceRefs: [therapyRef] },
      { claimPath: 'data.caveats.0', claim: caveat, evidenceRefs: [profileRef] },
    ],
    attestation: {
      schema: 'mediflow.ai.treatment-reasoning-athena-attestation.v1',
      readiness: 'available_unqualified',
      provider: 'athena_mlx',
      venue: 'local_process',
      egress: 'none',
      receiptRef: RECEIPT_REF,
      provenanceRef: PROVENANCE_REF,
    },
    fabricReceipt,
    provenance: {
      schemaVersion: 'mediflow.ai.fabric-provenance.v1',
      capability: 'treatment_reasoning',
      venue: 'local_process',
      provider: 'athena_mlx',
      model: null,
      preprocessing: ['context_minimization', 'envelope_validation'],
      receipt: fabricReceipt,
    },
    sourceRevision: projection.sourceRevision,
    capturedAt: projection.capturedAt,
    writesPerformed: 0,
    applyPolicy: 'none',
  };
}

async function createFixture(page: Page): Promise<{ patientId: string; therapyId: string }> {
  const marker = `${Date.now()}`.slice(-10);
  return page.evaluate(async (suffix) => {
    const patientResponse = await fetch('/api/patients', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Treatment',
        lastName: `Review${suffix.slice(-4)}`,
        taxCode: `TRFAB${suffix.padStart(11, '0')}`,
        birthDate: '1975-01-01T00:00:00.000Z',
        address: 'Indirizzo sintetico Treatment Reasoning',
        phone: '0000000085',
        diagnoses: [],
      }),
    });
    if (!patientResponse.ok) throw new Error(`Fixture paziente: HTTP ${patientResponse.status}`);
    const patientId = (await patientResponse.json() as { id: string }).id;
    const therapyId = `therapy.synthetic.${suffix}`;
    const therapyResponse = await fetch('/api/therapies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: therapyId,
        patientId,
        drugName: 'Farmaco sintetico locale',
        activePrinciple: 'Principio sintetico',
        dosage: '5 mg una volta al giorno',
        status: 'active',
        startDate: '2026-08-20T08:00:00.000Z',
      }),
    });
    if (!therapyResponse.ok) throw new Error(`Fixture terapia: HTTP ${therapyResponse.status}`);
    return { patientId, therapyId };
  }, marker);
}

test.describe.configure({ retries: 0 });

test('Treatment Reasoning UI invia payload strict e mostra una proposta source-bound', async ({ page }) => {
  const calls: string[] = [];
  const bodies: RecordedBodies = {};
  const postGestureMutations: string[] = [];
  let projection: Projection | null = null;
  let generationStarted = false;

  page.on('request', (request) => {
    if (!generationStarted || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) return;
    const pathname = new URL(request.url()).pathname;
    postGestureMutations.push(`${request.method()} ${pathname}`);
  });

  await page.route('**/api/context', async (route) => {
    calls.push(`${route.request().method()}:/api/context`);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ambulatoryId: 'ambulatory.synthetic.01' }),
    });
  });
  await page.route('**/api/ai/smart-import/selection', async (route) => {
    const method = route.request().method();
    calls.push(`${method}:/api/ai/smart-import/selection`);
    if (method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ selectionEpoch: 0 }) });
      return;
    }
    bodies.selection = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        selection: {
          sessionRef: `ssr_${'1'.repeat(32)}`,
          selectionEpoch: 1,
          patientRef: `ptr_${'2'.repeat(32)}`,
          ambulatoryRef: `abr_${'3'.repeat(32)}`,
          leaseRef: `lsr_${'4'.repeat(32)}`,
          expiresAt: Number.MAX_SAFE_INTEGER,
        },
      }),
    });
  });
  await page.route('**/api/ai/treatment-reasoning/ingest', async (route) => {
    calls.push(`${route.request().method()}:/api/ai/treatment-reasoning/ingest`);
    bodies.ingest = route.request().postDataJSON();
    if (!bodies.ingest || typeof bodies.ingest !== 'object' || Array.isArray(bodies.ingest)) {
      throw new Error('La UI Treatment Reasoning ha inviato un payload ingest non conforme.');
    }
    expect(Object.keys(bodies.ingest)).toEqual(['projection', 'requestId']);
    const ingest = bodies.ingest as { projection?: unknown; requestId?: unknown };
    expect(ingest.requestId).toMatch(/^req_[0-9a-f]{32}$/u);
    projection = snapshotTreatmentReasoningProjectionAttachment(ingest.projection, new Date().toISOString());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ handle: HANDLE }) });
  });
  await page.route('**/api/ai/treatment-reasoning/preview', async (route) => {
    calls.push(`${route.request().method()}:/api/ai/treatment-reasoning/preview`);
    bodies.preview = route.request().postDataJSON();
    if (!projection) throw new Error('Preview richiesta prima della projection sintetica.');
    if (!bodies.preview || typeof bodies.preview !== 'object' || Array.isArray(bodies.preview)) {
      throw new Error('La UI Treatment Reasoning ha inviato un payload preview non conforme.');
    }
    expect(Object.keys(bodies.preview)).toEqual(['handle', 'requestId']);
    const preview = bodies.preview as { handle?: unknown; requestId?: unknown };
    expect(preview.handle).toBe(HANDLE);
    expect(preview.requestId).toMatch(/^req_[0-9a-f]{32}$/u);
    expect(preview.requestId).not.toBe((bodies.ingest as { requestId?: unknown }).requestId);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(publicationFor(projection)) });
  });

  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await setAiLaneKillSwitch(page, 'aiTreatmentReasoningKillSwitch', 'enabled');
  const fixture = await createFixture(page);
  await page.goto(`/patients/${fixture.patientId}/modules`);
  await expect(page).toHaveURL(new RegExp(`/patients/${fixture.patientId}/modules$`));

  const therapies = page.getByRole('button', { name: /Terapie farmacologiche/u });
  await expect(therapies).toBeVisible();
  if (await therapies.getAttribute('aria-expanded') !== 'true') await therapies.click();

  const panel = page.getByTestId('treatment-reasoning-panel');
  const generate = panel.getByRole('button', { name: 'Genera bozza' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('review-only');
  await expect(panel).toContainText('Non modifica la scheda e richiede sempre revisione clinica.');
  await expect(generate).toBeEnabled();
  expect(calls).toEqual([]);

  generationStarted = true;
  await generate.click();

  await expect(panel).toContainText('Anteprima da rivedere');
  await expect(panel).toContainText('Rivedere la terapia sintetica prima di ogni decisione clinica.');
  await expect(panel).toContainText('non è una prescrizione, esegue 0 scritture e non applica modifiche');
  await expect(panel).toContainText('Rivedi le evidenze');
  await expect(panel.getByRole('button', { name: /applica/u })).toHaveCount(0);

  const bindings = panel.getByText('Fonti citate per claim');
  await bindings.click();
  await expect(panel).toContainText('data.recommendation');
  await expect(panel).toContainText('Terapia sintetica presente nel contesto corrente.');

  const governance = panel.getByText('Receipt, provenienza e currentness');
  await governance.click();
  await expect(panel).toContainText('ATHENA MLX · locale');
  await expect(panel).toContainText('available_unqualified · required · 0 scritture');
  await expect(panel).toContainText('local_process · local_only@mediflow.ai.egress-profile.v1 · egress none');
  await expect(panel).toContainText('context_minimization → envelope_validation');
  await expect(panel).toContainText(RECEIPT_REF);
  await expect(panel).toContainText(PROVENANCE_REF);
  const publishedProjection = (bodies.ingest as { projection?: Projection }).projection;
  if (!publishedProjection) throw new Error('Projection sintetica non pubblicata nel payload di ingest.');
  await expect(panel).toContainText(publishedProjection.sourceRevision);

  expect(calls).toEqual([
    'GET:/api/context',
    'GET:/api/ai/smart-import/selection',
    'POST:/api/ai/smart-import/selection',
    'POST:/api/ai/treatment-reasoning/ingest',
    'POST:/api/ai/treatment-reasoning/preview',
  ]);
  expect(bodies.selection).toEqual({
    expectedEpoch: 0,
    patientId: fixture.patientId,
    ambulatoryId: 'ambulatory.synthetic.01',
  });
  expect(Object.keys(bodies.ingest as object)).toEqual(['projection', 'requestId']);
  expect(bodies.preview).toEqual({
    handle: HANDLE,
    requestId: expect.stringMatching(/^req_[0-9a-f]{32}$/u),
  });
  expect((bodies.ingest as { projection: Projection }).projection.therapyRefs).toContain(`therapy:${fixture.therapyId}`);

  const callerKeys = collectKeys([bodies.selection, bodies.ingest, bodies.preview]);
  for (const forbidden of ['provider', 'model', 'endpoint', 'venue', 'prompt', 'fallback', 'egress', 'apply']) {
    expect(callerKeys.has(forbidden), `Il caller non deve fornire ${forbidden}`).toBe(false);
  }
  expect(postGestureMutations).toEqual([
    'POST /api/ai/smart-import/selection',
    'POST /api/ai/treatment-reasoning/ingest',
    'POST /api/ai/treatment-reasoning/preview',
  ]);
});
