/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { collectAiRolloutModelGuards, type AiRolloutGuardPayload } from './ai-rollout-model-guard.ts';

test('collectAiRolloutModelGuards reports hold verdict for selected challenger model', () => {
    const payload: AiRolloutGuardPayload = {
        lanes: [{
            lane: 'generative_challenger',
            available: true,
            report: {
                status: 'hold',
                selectedModel: 'gemma4:e4b',
                blockers: [{ id: 'smart-import', message: 'therapyStateRecall 0.7 < 0.95' }],
            },
        }],
    };

    const guards = collectAiRolloutModelGuards(payload, [
        { roleId: 'clinical', roleLabel: 'Radiologo & Clinico', model: 'gemma4:e4b' },
        { roleId: 'reasoning', roleLabel: 'Internista (Reasoning)', model: 'qwen3.5:35b-a3b' },
    ]);

    assert.equal(guards.length, 1);
    assert.equal(guards[0]?.model, 'gemma4:e4b');
    assert.equal(guards[0]?.status, 'hold');
    assert.deepEqual(guards[0]?.roles, ['Radiologo & Clinico']);
    assert.deepEqual(guards[0]?.lanes, ['Generative Challenger']);
    assert.match(guards[0]?.blockerMessages.join(' | ') || '', /therapyStateRecall 0.7 < 0.95/);
});

test('collectAiRolloutModelGuards aggregates roles and promotes rollback-required severity', () => {
    const payload: AiRolloutGuardPayload = {
        lanes: [
            {
                lane: 'generative_challenger',
                available: true,
                report: {
                    status: 'hold',
                    selectedModel: 'gemma4:e4b',
                    blockers: [{ message: 'Challenger still under review.' }],
                },
            },
            {
                lane: 'smart_import',
                available: true,
                report: {
                    status: 'rollback-required',
                    selectedModel: 'gemma4:e4b',
                    blockers: [{ message: 'forbiddenLeakRate 0.2 > 0.05' }],
                },
            },
        ],
    };

    const guards = collectAiRolloutModelGuards(payload, [
        { roleId: 'clinical', roleLabel: 'Radiologo & Clinico', model: 'gemma4:e4b' },
        { roleId: 'reasoning', roleLabel: 'Internista (Reasoning)', model: 'gemma4:e4b' },
    ]);

    assert.equal(guards.length, 1);
    assert.equal(guards[0]?.status, 'rollback-required');
    assert.deepEqual(guards[0]?.roles, ['Radiologo & Clinico', 'Internista (Reasoning)']);
    assert.deepEqual(guards[0]?.lanes, ['Generative Challenger', 'Smart Import']);
    assert.equal(guards[0]?.blockerMessages.length, 2);
});

test('collectAiRolloutModelGuards ignores shadow-ready or unrelated selections', () => {
    const payload: AiRolloutGuardPayload = {
        lanes: [
            {
                lane: 'patient_insight',
                available: true,
                report: {
                    status: 'shadow-ready',
                    selectedModel: 'qwen3.5:35b-a3b',
                    blockers: [],
                },
            },
            {
                lane: 'redaction',
                available: false,
                report: null,
            },
        ],
    };

    const guards = collectAiRolloutModelGuards(payload, [
        { roleId: 'clinical', roleLabel: 'Radiologo & Clinico', model: 'gemma4:e4b' },
    ]);

    assert.deepEqual(guards, []);
});
