import type { Page } from '@playwright/test';
import type { TreatmentReasoningProjectionAttachment } from '../../lib/ai-providers/fabric/treatment-reasoning-projection';
import type { FunctionModelPreferences } from '../../lib/function-models/browser';

export const HANDLE = `trp_${'a'.repeat(32)}`;
export const RECEIPT_REF = 'receipt_synthetic_01';
export const PROVENANCE_REF = 'provenance_synthetic_01';
export const AMBULATORY_A = { id: 'ambulatory.synthetic.01', name: 'Ambulatorio sintetico A', address: 'Via sintetica 1', version: 3 };
export const AMBULATORY_B = { id: 'ambulatory.synthetic.02', name: 'Ambulatorio sintetico B', address: 'Via sintetica 2', version: 5 };
const MODEL_OPTION_ID = `model_option_${'7'.repeat(32)}`;
export const FIXTURE_CATALOG = {
  schemaVersion: 'mediflow.function-preferences.v1', revision: `sha256_${'8'.repeat(64)}`,
  catalogRevision: `sha256_${'9'.repeat(64)}`, check: 'configuration_only', apply: 'denied',
  presets: ['host_defaults', 'all_off'],
  functions: (['patient_insight', 'smart_import', 'document_synthesis', 'treatment_reasoning'] as const).map((id) => ({
    id, enabled: id === 'treatment_reasoning', defaultModelOptionId: id === 'treatment_reasoning' ? MODEL_OPTION_ID : null,
    defaultSource: 'host_configuration', bindingState: 'current',
    options: id === 'treatment_reasoning'
      ? [{ modelOptionId: MODEL_OPTION_ID, label: 'ATHENA / MLX fixture', provider: 'athena_mlx' as const, state: 'available_unqualified' as const }]
      : [],
  })),
} satisfies FunctionModelPreferences;

type Projection = TreatmentReasoningProjectionAttachment;

export function publicationFor(projection: Projection) {
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
      { claimPath: 'data.recommendation', claim: recommendation, evidenceRefs: [profileRef] },
      { claimPath: 'data.reasoning.0', claim: reasoning, evidenceRefs: [profileRef] },
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

export async function createFixture(page: Page): Promise<{ patientId: string; therapyId: string }> {
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

