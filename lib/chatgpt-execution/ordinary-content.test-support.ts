/* @Codex */
/* Synthetic ordinary-content fixtures. No runtime account or clinical data. */
import assert from 'node:assert/strict';
import { createPatientInsightOrdinaryTaskProfile, createSmartImportOrdinaryTaskProfile, createDocumentSynthesisOrdinaryTaskProfile, createTreatmentReasoningOrdinaryTaskProfile } from './ordinary-task-profile';
import { captureDocumentSynthesisSourceSet } from '../ai-providers/fabric/document-synthesis-source-set-contract';
import type { TreatmentReasoningPromptInput } from '../treatment-reasoning-contract';
export const configuration = { pythonExecutable: '/synthetic/python', workerPath: '/synthetic/worker', modelDirectory: '/synthetic/model' };
export const PI = { schemaVersion: 'mediflow.patient-insight.projection.v1', clinicalFocus: 'Bea Riva in controllo', activeConditions: ['Condizione di Bea Riva'], currentTherapies: [], recentClinicalEvents: [] } as const;
export const SI = { schemaVersion: 'mediflow.smart-import.projection.v1', capability: 'smart_import', patientRef: 'patient_synthetic', selectionEpoch: 1, patientRevision: 1, sourceRevision: 1, capturedAt: '2026-09-12T10:00:00.000Z', currentDiagnoses: [], currentActiveTherapies: [], therapyCandidateHints: [], sources: [{ id: 'source_synthetic', kind: 'clinical-entry', label: 'Bea Riva', date: '2026-09-12T10:00:00.000Z', content: 'Bea Riva in controllo' }] } as const;
export const TR: TreatmentReasoningPromptInput = { question: 'Bea Riva?', patientContext: 'Bea Riva in controllo', diagnoses: ['Ipertensione'], sources: [{ id: 'source_synthetic', sourceKind: 'clinical-entry', label: 'Bea Riva', excerpt: 'Bea Riva in controllo', date: '12/09/2026' }] };
export function sourceSet(text = 'Bea Riva in controllo.', count = 1) {
    const result = captureDocumentSynthesisSourceSet({ sources: Array.from({ length: count }, (_, index) => ({ documentSourceRef: `doc-synthetic-${index}`, documentRevision: BigInt(1), documentFreshnessEpoch: BigInt(1), sourceText: text })), sourceSetEpoch: BigInt(1), revocationGeneration: BigInt(1) });
    assert.equal(result.status, 'available'); return result.sourceSet;
}
export function outputs() {
    return [
        { schemaVersion: 'mediflow.ai.extract.v1', task: 'patient_insight', summary: 'Bea Riva [S1]', data: { currentState: ['Bea Riva [S1]'], alerts: [], nextSteps: [], gaps: [] } },
        { schemaVersion: 'mediflow.ai.extract.v1', task: 'smart_import', summary: 'Bea Riva', data: { diagnoses: [{ label: 'Ipertensione', icdQuery: 'Hypertension', confidence: 'high', evidence: 'Bea Riva in controllo', sourceId: 'source_synthetic' }], therapies: [], servicePrescriptions: [] } },
        { schemaVersion: 'mediflow.document-synthesis.provider-envelope.v2', output: { schemaVersion: 'mediflow.ai.extract.v1', task: 'document_synthesis', summary: 'Bea Riva', data: { qualityLevel: 'yellow', medications: [], diagnoses: [], problemStatements: [], therapyCandidates: [], servicePrescriptions: [] } }, citations: [{ label: 'S1', quote: 'Bea Riva in controllo.' }], claims: [{ claimPath: 'summary', labels: ['S1'] }, { claimPath: 'data.qualityLevel', labels: ['S1'] }] },
        { schemaVersion: 'mediflow.treatment_reasoning.v1', task: 'treatment_reasoning', summary: 'Bea Riva', data: { recommendation: 'Bea Riva in controllo', keyEvidence: [], reasoning: [], caveats: [], safetyFlags: [], suggestedActions: [], trace: { mode: 'chatgpt_subscription', toolsUsed: [], limitations: [] } }, sourceBindings: [{ claimPath: 'summary', claim: 'Bea Riva', evidenceRefs: ['source_synthetic'] }, { claimPath: 'data.recommendation', claim: 'Bea Riva in controllo', evidenceRefs: ['source_synthetic'] }] },
    ];
}
export function profiles() { return [createPatientInsightOrdinaryTaskProfile(PI), createSmartImportOrdinaryTaskProfile({ projection: SI, generatedAt: SI.capturedAt }), createDocumentSynthesisOrdinaryTaskProfile(sourceSet()), createTreatmentReasoningOrdinaryTaskProfile(TR)]; }
export const tokenFrom = (text: string) => { const token = text.match(/\{\{MF_PII_[a-f0-9]{32}_\d+\}\}/u)?.[0]; assert.ok(token); return token; };
