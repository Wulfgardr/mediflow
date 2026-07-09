/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    generatePatientTreatmentReasoningDraft,
    type TreatmentReasoningAiRuntime,
} from './treatment-reasoning-service';
import { AiTreatmentReasoningDisabledError } from './ai-treatment-reasoning-kill-switch';
import { TREATMENT_REASONING_SCHEMA_VERSION } from './treatment-reasoning-contract';
import type { Patient, Therapy } from './db';

const patient: Patient = {
    id: 'patient-1',
    firstName: 'Test',
    lastName: 'Patient',
    taxCode: 'TSTPNT00A00H501X',
    address: '',
    phone: '',
    diagnoses: [{
        system: 'ICD-11',
        code: 'BA00',
        description: 'Ipertensione essenziale',
        date: new Date('2026-01-01T00:00:00Z'),
    }],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
};

const therapy: Therapy = {
    id: 'therapy-1',
    patientId: patient.id,
    drugName: 'Bisoprololo',
    activePrinciple: 'Bisoprololo',
    dosage: '2,5 mg 1 cp',
    status: 'active',
    startDate: new Date('2026-05-01T00:00:00Z'),
    createdAt: new Date('2026-05-01T00:00:00Z'),
};

function fakeAI(response: unknown): TreatmentReasoningAiRuntime {
    return {
        getModelInfo: () => ({ provider: 'ollama', model: 'fake-local-model' }),
        chat: async () => ({
            content: JSON.stringify(response),
            stats: { latency: 12, tokensIn: 10, tokensOut: 20 },
        }),
    };
}

test('patient treatment reasoning service calls local model and returns contract-bound draft', async () => {
    const response = {
        schemaVersion: TREATMENT_REASONING_SCHEMA_VERSION,
        task: 'treatment_reasoning',
        summary: 'Piano da rivedere senza modifiche automatiche.',
        data: {
            recommendation: 'Valutare tollerabilita del beta-bloccante prima di modificare.',
            keyEvidence: [{
                id: 'evidence-1',
                statement: 'Terapia beta-bloccante attiva.',
                evidenceRefs: ['therapy:therapy-1'],
            }],
            reasoning: ['La terapia e coerente con ipertensione, ma serve valutazione sintomi.'],
            caveats: ['Mancano pressione seriata e frequenza cardiaca recente.'],
            safetyFlags: [{
                id: 'safety-1',
                severity: 'caution',
                label: 'Monitorare PA/FC',
                rationale: 'La fonte non contiene trend recente.',
                evidenceRefs: ['therapy:therapy-1'],
            }],
            suggestedActions: [{
                id: 'action-1',
                intent: 'review_only',
                label: 'Rivedi posologia',
                rationale: 'Solo revisione clinica.',
                writePolicy: 'review_only',
                evidenceRefs: ['therapy:therapy-1'],
            }],
            trace: { mode: 'local_model', toolsUsed: [], limitations: [] },
        },
    };

    const draft = await generatePatientTreatmentReasoningDraft(patient.id, {}, {
        getKillSwitchValue: async () => 'enabled',
        loadPatientData: async () => ({
            patient,
            entries: [],
            therapies: [therapy],
            observations: [],
            attachments: [],
        }),
        createAI: async () => fakeAI(response),
    });

    assert.equal(draft.model.model, 'fake-local-model');
    assert.equal(draft.parse.validJson, true);
    assert.equal(draft.parse.validTask, true);
    assert.equal(draft.parse.validEvidenceRefs, true);
    assert.equal(draft.envelope.data.trace.mode, 'local_model');
    assert.equal(draft.envelope.data.trace.model, 'fake-local-model');
    assert.equal(draft.envelope.data.suggestedActions[0].writePolicy, 'review_only');
});

test('patient treatment reasoning service is blocked by absent kill switch value', async () => {
    await assert.rejects(
        () => generatePatientTreatmentReasoningDraft(patient.id, {}, {
            getKillSwitchValue: async () => undefined,
            loadPatientData: async () => {
                throw new Error('should not load data while disabled');
            },
            createAI: async () => fakeAI({}),
        }),
        AiTreatmentReasoningDisabledError,
    );
});

test('patient treatment reasoning service records invalid evidence refs as limitations', async () => {
    const response = {
        schemaVersion: TREATMENT_REASONING_SCHEMA_VERSION,
        task: 'treatment_reasoning',
        summary: 'Citazione non valida intercettata.',
        data: {
            recommendation: 'Non applicare.',
            keyEvidence: [{
                statement: 'Fonte inesistente.',
                evidenceRefs: ['not-a-source'],
            }],
            reasoning: [],
            caveats: [],
            safetyFlags: [],
            suggestedActions: [],
            trace: { mode: 'local_model', toolsUsed: [], limitations: [] },
        },
    };

    const draft = await generatePatientTreatmentReasoningDraft(patient.id, {}, {
        getKillSwitchValue: async () => 'enabled',
        loadPatientData: async () => ({
            patient,
            entries: [],
            therapies: [therapy],
            observations: [],
            attachments: [],
        }),
        createAI: async () => fakeAI(response),
    });

    assert.equal(draft.parse.validEvidenceRefs, false);
    assert.match(draft.envelope.data.trace.limitations.join(' '), /citazioni/i);
});
