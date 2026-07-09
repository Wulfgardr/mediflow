import test from 'node:test';
import assert from 'node:assert/strict';
import {
    TREATMENT_REASONING_SCHEMA_VERSION,
    buildTreatmentReasoningPrompt,
    parseTreatmentReasoningResponse,
} from './treatment-reasoning-contract';

test('treatment reasoning parser accepts valid review-only output', () => {
    const parsed = parseTreatmentReasoningResponse(JSON.stringify({
        schemaVersion: TREATMENT_REASONING_SCHEMA_VERSION,
        task: 'treatment_reasoning',
        summary: 'Rivedere metformina per funzione renale ridotta.',
        data: {
            recommendation: 'La terapia va rivalutata in base a eGFR e tollerabilita; questa non e una prescrizione automatica.',
            keyEvidence: [
                {
                    id: 'e1',
                    statement: 'eGFR recente 35 ml/min/1.73m2.',
                    evidenceRefs: ['obs-egfr'],
                },
            ],
            reasoning: ['La funzione renale condiziona appropriatezza e monitoraggio.'],
            caveats: ['Mancano allergie e trend creatinina.'],
            safetyFlags: [
                {
                    id: 's1',
                    severity: 'caution',
                    label: 'Funzione renale da monitorare',
                    rationale: 'La decisione terapeutica dipende dal trend eGFR.',
                    evidenceRefs: ['obs-egfr'],
                },
            ],
            suggestedActions: [
                {
                    id: 'a1',
                    intent: 'open_therapy_form_prefill',
                    label: 'Apri revisione terapia',
                    rationale: 'Serve revisione medica della posologia.',
                    writePolicy: 'form_prefill_only',
                    evidenceRefs: ['obs-egfr'],
                    prefill: { motivation: 'Rivalutazione per eGFR ridotto' },
                },
            ],
            trace: {
                mode: 'local_model',
                model: 'synthetic-fixture',
                toolsUsed: ['local-chart'],
                limitations: ['No external guideline lookup in fixture.'],
            },
        },
    }), { allowedEvidenceIds: ['obs-egfr'] });

    assert.equal(parsed.validJson, true);
    assert.equal(parsed.validTask, true);
    assert.equal(parsed.validEvidenceRefs, true);
    assert.equal(parsed.value.data.suggestedActions[0].writePolicy, 'form_prefill_only');
});

test('treatment reasoning parser drops fabricated evidence refs', () => {
    const parsed = parseTreatmentReasoningResponse(JSON.stringify({
        schemaVersion: TREATMENT_REASONING_SCHEMA_VERSION,
        task: 'treatment_reasoning',
        summary: 'Citazione inventata da scartare.',
        data: {
            recommendation: 'Serve revisione.',
            keyEvidence: [
                {
                    statement: 'Fonte reale piu fonte inventata.',
                    evidenceRefs: ['therapy-1', 'fake-source'],
                },
            ],
            reasoning: [],
            caveats: [],
            safetyFlags: [],
            suggestedActions: [],
            trace: { mode: 'local_contract', toolsUsed: [], limitations: [] },
        },
    }), { allowedEvidenceIds: ['therapy-1'] });

    assert.equal(parsed.validEvidenceRefs, false);
    assert.deepEqual(parsed.value.data.keyEvidence[0].evidenceRefs, ['therapy-1']);
});

test('treatment reasoning parser blocks automatic write policies', () => {
    const parsed = parseTreatmentReasoningResponse(JSON.stringify({
        schemaVersion: TREATMENT_REASONING_SCHEMA_VERSION,
        task: 'treatment_reasoning',
        summary: 'Il modello ha chiesto auto apply.',
        data: {
            recommendation: 'Non applicare automaticamente.',
            keyEvidence: [],
            reasoning: [],
            caveats: [],
            safetyFlags: [],
            suggestedActions: [
                {
                    intent: 'open_therapy_form_prefill',
                    label: 'Aggiorna terapia',
                    rationale: 'Richiesta non ammessa come scrittura automatica.',
                    writePolicy: 'auto_apply',
                    evidenceRefs: [],
                },
            ],
            trace: { mode: 'local_model', toolsUsed: [], limitations: [] },
        },
    }));

    const action = parsed.value.data.suggestedActions[0];
    assert.equal(action.writePolicy, 'review_only');
    assert.match(action.blockedReason ?? '', /Automatic clinical writes/i);
});

test('treatment reasoning prompt preserves no-auto-write and source discipline', () => {
    const prompt = buildTreatmentReasoningPrompt({
        question: 'Rivedere terapia anti-infiammatoria?',
        patientContext: 'Paziente sintetico con terapia anticoagulante.',
        activeTherapies: ['Apixaban 5 mg x2/die'],
        diagnoses: ['Fibrillazione atriale'],
        observations: ['Hb 12 g/dL'],
        sources: [
            {
                id: 'therapy-apixaban',
                sourceKind: 'therapy',
                label: 'Terapia attiva',
                excerpt: 'Apixaban 5 mg due volte al giorno',
            },
        ],
    });

    assert.match(prompt, /non devi applicare modifiche alla cartella/i);
    assert.match(prompt, /mai auto_apply/i);
    assert.match(prompt, /therapy-apixaban/);
    assert.match(prompt, new RegExp(TREATMENT_REASONING_SCHEMA_VERSION));
});
