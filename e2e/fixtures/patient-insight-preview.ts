import type { FunctionModelPreferences } from '../../lib/function-models/browser';
import type { PatientInsightPreviewRequest } from '../../lib/ai-providers/fabric/patient-insight-preview-contract';

export const MODEL = 'synthetic-patient-insight:latest';
const REVIEW_REF = `review_${'b'.repeat(32)}`;
export const MODEL_OPTION_ID = `model_option_${'a'.repeat(32)}`;
export const PATIENT_INSIGHT_CATALOG = {
  schemaVersion: 'mediflow.function-preferences.v1',
  revision: `sha256_${'c'.repeat(64)}`,
  catalogRevision: `sha256_${'d'.repeat(64)}`,
  check: 'configuration_only',
  apply: 'denied',
  presets: ['host_defaults', 'all_off'],
  functions: (['patient_insight', 'smart_import', 'document_synthesis', 'treatment_reasoning'] as const).map(id => ({
    id,
    enabled: id === 'patient_insight',
    defaultModelOptionId: MODEL_OPTION_ID,
    defaultSource: 'host_configuration',
    bindingState: 'current',
    options: [{ modelOptionId: MODEL_OPTION_ID, label: MODEL, provider: 'ollama', state: 'available_unqualified' }],
  })),
} satisfies FunctionModelPreferences;

export function availablePreview(request: PatientInsightPreviewRequest) {
  return {
    preview: {
      writesPerformed: 0,
      apply: 'denied',
      status: 'available',
      code: null,
      proposal: {
        schemaVersion: 'mediflow.patient-insight.review-proposal.v2',
        reviewOnly: true,
        summary: 'Proposta sintetica da revisionare. [S1]',
        currentState: ['Quadro sintetico stabile da verificare. [S1]'],
        alerts: ['Attenzione sintetica da confermare. [S1]'],
        nextSteps: ['Rivedere la fonte sintetica durante il follow-up. [S1]'],
        gaps: ['Dato sintetico ancora da integrare.'],
        generatedAt: request.capturedAt,
        currentness: {
          selectionEpoch: 7,
          patientRevision: request.patientRevision,
          projectionDigest: `sha256_${'a'.repeat(64)}`,
          capturedAt: request.capturedAt,
          verifiedAt: request.capturedAt,
        },
      },
      receipt: {
        schemaVersion: 'mediflow.ai.fabric-resolution.v1',
        capability: 'patient_insight',
        venue: 'local_process',
        provider: 'ollama',
        model: MODEL,
        egress: 'none',
      },
      provenance: {
        schemaVersion: 'mediflow.ai.fabric-provenance.v1',
        capability: 'patient_insight',
        venue: 'local_process',
        provider: 'ollama',
        model: MODEL,
        preprocessing: ['context_minimization', 'envelope_validation'],
        attempts: 2,
      },
      reviewRef: REVIEW_REF,
    },
  };
}
