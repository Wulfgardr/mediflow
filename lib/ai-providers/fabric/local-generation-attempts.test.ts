import assert from 'node:assert/strict';
import test from 'node:test';

import { FABRIC_VENUES } from './contract';
import { maxGenerationAttempts, runLocalGenerationAttempts, type LocalGenerationAttempt } from './local-generation-attempts';

function scripted(results: LocalGenerationAttempt<string>[]) {
    let calls = 0; let between = 0;
    return {
        calls: () => calls, betweens: () => between,
        attempt: async () => results[Math.min(calls++, results.length - 1)],
        between: async () => { between += 1; return null; },
    };
}

test('only the local process venue gets a second attempt', () => {
    for (const venue of FABRIC_VENUES) assert.equal(maxGenerationAttempts(venue), venue === 'local_process' ? 2 : 1, venue);
});

test('local: a rejected first answer is retried once and the second valid one is accepted', async () => {
    const run = scripted([{ status: 'rejected', reason: 'invalid' }, { status: 'accepted', value: 'ok' }]);
    const outcome = await runLocalGenerationAttempts({ venue: 'local_process', attempt: run.attempt, between: run.between });
    assert.deepEqual(outcome, { status: 'accepted', value: 'ok', attempts: 2, rejections: ['invalid'] });
    assert.equal(run.calls(), 2); assert.equal(run.betweens(), 1);
});

test('local: two rejected answers stop at two calls, never three', async () => {
    const run = scripted([{ status: 'rejected', reason: 'truncated' }, { status: 'rejected', reason: 'invalid' }, { status: 'accepted', value: 'never' }]);
    const outcome = await runLocalGenerationAttempts({ venue: 'local_process', attempt: run.attempt, between: run.between });
    assert.deepEqual(outcome, { status: 'rejected', attempts: 2, rejections: ['truncated', 'invalid'] });
    assert.equal(run.calls(), 2);
});

test('local: a provider failure is never retried', async () => {
    const run = scripted([{ status: 'provider_failed' }, { status: 'accepted', value: 'never' }]);
    const outcome = await runLocalGenerationAttempts({ venue: 'local_process', attempt: run.attempt, between: run.between });
    assert.equal(outcome.status, 'provider_failed'); assert.equal(run.calls(), 1); assert.equal(run.betweens(), 0);
});

test('local: a stop decided between the attempts prevents the second call', async () => {
    let calls = 0;
    const outcome = await runLocalGenerationAttempts<string, 'revoked'>({ venue: 'local_process',
        attempt: async () => { calls += 1; return { status: 'rejected', reason: 'invalid' }; },
        between: async () => 'revoked' });
    assert.deepEqual(outcome, { status: 'stopped', stop: 'revoked', attempts: 1, rejections: ['invalid'] });
    assert.equal(calls, 1);
});

test('remote venues: an invalid answer is not retried (no second egress, no second quota use)', async () => {
    for (const venue of ['cloud', 'home_base', 'on_device'] as const) {
        const run = scripted([{ status: 'rejected', reason: 'invalid' }, { status: 'accepted', value: 'never' }]);
        const outcome = await runLocalGenerationAttempts({ venue, attempt: run.attempt, between: run.between });
        assert.deepEqual(outcome, { status: 'rejected', attempts: 1, rejections: ['invalid'] }, venue);
        assert.equal(run.calls(), 1, venue); assert.equal(run.betweens(), 0, venue);
    }
});
