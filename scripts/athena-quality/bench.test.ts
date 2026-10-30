import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { loadInputs, runComparison, fakeRunner, requireLocalVenue, approveRun, type CellOutcome, type Comparison } from './bench.ts';

test('release denial precedes both comparison runners and every semantic mutation', async () => {
    let calls = 0;
    const runner = async () => { calls++; return '{}'; };
    await assert.rejects(runComparison(loadInputs().corpus, runner, runner), error => error instanceof Error && 'code' in error && error.code === 'treatment_reasoning_unavailable_in_release');
    assert.equal(calls, 0);
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

function deniedRows(): Comparison[] {
    const cell: CellOutcome = { status: 'denied', code: 'treatment_reasoning_unavailable_in_release', value: null, metrics: null,
        writes: 0, elapsedMs: 0, responseSha256: null, instructionSha256: null };
    return loadInputs().corpus.cases.map(item => ({ id: item.id, direct: cell, fabric: cell, equivalent: true, expectedStatus: false }));
}

test('thresholds evaluate each cell and cannot turn mutual denial into semantic success', async () => {
    const { evaluateThresholds } = await import('./bench.ts');
    const { thresholds } = loadInputs();
    const rows = deniedRows();
    const scores = evaluateThresholds(rows, thresholds, false);
    assert.equal(scores.length, 18);
    assert.ok(scores.filter(row => row.metric === 'negation').every(row => !row.passed && row.observed === 0));
    assert.ok(scores.filter(row => row.metric === 'unexpectedEgress').every(row => !row.passed && row.observed === null));
});

test('CLI self-test refuses the unavailable release and remote venues before execution', async () => {
    const { spawnSync } = await import('node:child_process');
    const launcher = new URL('../athena-quality-bench.mjs', import.meta.url);
    const { fileURLToPath } = await import('node:url');
    const clean = spawnSync(process.execPath, [fileURLToPath(launcher), '--self-test'], { encoding: 'utf8' });
    assert.equal(clean.status, 1);
    assert.match(clean.stderr, /Non disponibile in questa versione/);
    const denied = spawnSync(process.execPath, [fileURLToPath(launcher), '--self-test', '--venue', 'chatgpt'], { encoding: 'utf8' });
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /Non disponibile in questa versione/);
    for (const mode of ['--run', '--preflight']) {
        const result = spawnSync(process.execPath, [fileURLToPath(launcher), mode, '--approval', '/missing-synthetic-approval'], { encoding: 'utf8' });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Non disponibile in questa versione/);
        assert.doesNotMatch(result.stderr, /ENOENT|MLX_UNAVAILABLE|NETWORK_DENIAL_NOT_VERIFIED/);
    }
});

test('release denial precedes even an unavailable runner without retry or fallback', async () => {
    let calls = 0;
    const unavailable = async () => { calls += 1; throw new Error('synthetic MLX unavailable'); };
    await assert.rejects(runComparison(loadInputs().corpus, unavailable, fakeRunner), /Non disponibile in questa versione/);
    assert.equal(calls, 0);
    calls = 0;
    await assert.rejects(runComparison(loadInputs().corpus, fakeRunner, unavailable), /Non disponibile in questa versione/);
    assert.equal(calls, 0);
});
