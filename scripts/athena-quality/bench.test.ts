import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { loadInputs, runComparison, fakeRunner, requireLocalVenue, approveRun } from './bench.ts';

test('local comparison detects every semantic mutation and denies hostile outputs', async () => {
    const { corpus } = loadInputs();
    const clean = await runComparison(corpus, fakeRunner, fakeRunner);
    assert.equal(clean.every(row => row.equivalent && row.expectedStatus), true);
    for (const metric of ['sourcePage', 'negation', 'uncertainty', 'subject', 'time'] as const) {
        const changed = await runComparison(corpus, fakeRunner, (item, instruction) => fakeRunner(item, instruction, metric));
        assert.equal(changed.some(row => !row.equivalent), true, metric);
        assert.equal(changed.some(row => metric === 'sourcePage' ? row.fabric.status === 'denied' : row.fabric.metrics?.[metric] === 0), true, metric);
    }
    for (const mutation of ['inventedSources', 'unconfirmedWrites', 'malformed'] as const) {
        const changed = await runComparison(corpus, fakeRunner, (item, instruction) => fakeRunner(item, instruction, mutation));
        assert.equal(changed.some(row => !row.equivalent), true, mutation);
    }
});

test('remote venues and unapproved or tampered artifacts fail closed', () => {
    for (const status of ['Proposed', 'Accepted']) {
        for (const venue of ['openai', 'anthropic', 'chatgpt', '', 'local_process ']) assert.throws(() => requireLocalVenue(venue, `Status: ${status}`));
    }
    requireLocalVenue('local_process', 'Status: Proposed');
    const inputs = loadInputs();
    assert.throws(() => approveRun({}, inputs));
    assert.equal(approveRun({ reviewer: 'Leonardo', status: 'approved', corpusSha256: inputs.corpusSha256, thresholdsSha256: inputs.thresholdsSha256, approvedAt: new Date().toISOString() }, inputs).status, 'approved');
    assert.throws(() => approveRun({ reviewer: 'Leonardo', status: 'approved', corpusSha256: 'bad', thresholdsSha256: 'bad' }, inputs));
    assert.throws(() => loadInputs(readFileSync(new URL('./corpus.json', import.meta.url), 'utf8').replace('ibuprofene', 'altro')), /ARTIFACT_HASH_MISMATCH/);
});

test('positive cases denied by both runners cannot establish quality', async () => {
    const rows = await runComparison(loadInputs().corpus, async () => '{}', async () => '{}');
    assert.equal(rows.every(row => row.equivalent), true);
    assert.equal(rows.every(row => row.expectedStatus), false);
});

test('thresholds evaluate each cell and cannot turn mutual denial into semantic success', async () => {
    const { evaluateThresholds } = await import('./bench.ts');
    const { corpus, thresholds } = loadInputs();
    const rows = await runComparison(corpus, async () => '{}', async () => '{}');
    const scores = evaluateThresholds(rows, thresholds, false);
    assert.equal(scores.length, 18);
    assert.ok(scores.filter(row => row.metric === 'negation').every(row => !row.passed && row.observed === 0));
    assert.ok(scores.filter(row => row.metric === 'unexpectedEgress').every(row => !row.passed && row.observed === null));
});

test('CLI self-test uses only the fake runner and refuses remote venue before execution', async () => {
    const { spawnSync } = await import('node:child_process');
    const launcher = new URL('../athena-quality-bench.mjs', import.meta.url);
    const { fileURLToPath } = await import('node:url');
    const clean = spawnSync(process.execPath, [fileURLToPath(launcher), '--self-test'], { encoding: 'utf8' });
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(clean.stdout, /8 mutazioni rilevate/);
    const denied = spawnSync(process.execPath, [fileURLToPath(launcher), '--self-test', '--venue', 'chatgpt'], { encoding: 'utf8' });
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /ADR_0166_NOT_ACCEPTED|REMOTE_VENUE_NOT_IMPLEMENTED/);
});

test('runner unavailability stops comparison immediately without retry or fallback', async () => {
    let calls = 0;
    const unavailable = async () => { calls += 1; throw new Error('synthetic MLX unavailable'); };
    await assert.rejects(runComparison(loadInputs().corpus, unavailable, fakeRunner), /MLX_RUNNER_FAILED/);
    assert.equal(calls, 1);
    calls = 0;
    await assert.rejects(runComparison(loadInputs().corpus, fakeRunner, unavailable), /MLX_RUNNER_FAILED/);
    assert.equal(calls, 1);
});
