import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AiFunctionUnavailableError } from './ai-function-availability.ts';
import { generatePatientTreatmentReasoningDraft, generateTreatmentReasoningDraftFromContext } from './treatment-reasoning-service.ts';

for (const enabled of ['enabled', 'disabled']) test(`legacy service denies ${enabled} before data reads or provider creation`, async () => {
    let calls = 0;
    await assert.rejects(generatePatientTreatmentReasoningDraft('synthetic-patient', {}, {
        getKillSwitchValue: async () => enabled,
        loadPatientData: async () => { calls++; throw new Error('unexpected read'); },
        createAI: async () => { calls++; throw new Error('unexpected provider'); },
    }), AiFunctionUnavailableError);
    assert.equal(calls, 0);
});
test('direct context generation cannot bypass the release denial with an already selected model', async () => {
    let calls = 0;
    await assert.rejects(generateTreatmentReasoningDraftFromContext({ sources: [{ id: 'synthetic' }] } as never, {
        getModelInfo: () => ({ provider: 'other_provider', model: 'synthetic-present-model' }),
        chat: async () => { calls++; return { content: '' }; },
    }), AiFunctionUnavailableError);
    assert.equal(calls, 0);
});
