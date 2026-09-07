/* @Codex */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAbsolute } from 'node:path';
import { mkdirSync } from 'node:fs';
const dataDir = process.env.MEDIFLOW_DATA_DIR;
assert.ok(dataDir && isAbsolute(dataDir), 'Absolute synthetic data directory required before imports');
mkdirSync(dataDir, { recursive: true });
const { waitForOwnedExecutionGroupExit, terminateOwnedExecutionLeader } = await import('./execution-host.ts');

test('owned-group host: present group is observed until absent without signals', async () => {
    const observed: number[] = [];
    assert.equal(await waitForOwnedExecutionGroupExit(4242, 100, pid => { observed.push(pid); return observed.length === 2; }), true);
    assert.deepEqual(observed, [4242, 4242]);
});

test('owned-group host: a still-present group is not cleanup evidence', async () => {
    const started = performance.now();
    assert.equal(await waitForOwnedExecutionGroupExit(4242, 20, () => false), false);
    assert.ok(performance.now() - started < 500);
});

test('owned-group host: observation failure is unknown, never absence', async () => {
    assert.equal(await waitForOwnedExecutionGroupExit(4242, 20, () => { throw new Error('unknown'); }), false);
});

test('owned-group host: no PID from failed spawn needs no OS observation', async () => {
    assert.equal(await waitForOwnedExecutionGroupExit(undefined, 20, () => assert.fail('No process to observe')), true);
});

for (const pid of [0, 1, -1, NaN, 1.5]) test('owned-group host: invalid identity cannot reach observer', async () => {
    assert.equal(await waitForOwnedExecutionGroupExit(pid, 20, () => assert.fail('Invalid PID')), false);
});
for (const timeout of [0, -1, NaN, Infinity, 1001]) test('owned-group host: invalid budget cannot reach observer', async () => {
    assert.equal(await waitForOwnedExecutionGroupExit(4242, timeout, () => assert.fail('Invalid budget')), false);
});

for (const state of ['active', 'exited', 'signaled', 'spawn-failed'] as const) test(`owned-group host: ${state} leader signals only its owned handle`, () => {
    const signals: (NodeJS.Signals | number | undefined)[] = [];
    const leader = { pid: state === 'spawn-failed' ? undefined : 4242, exitCode: state === 'exited' ? 0 : null,
        signalCode: state === 'signaled' ? 'SIGTERM' as const : null,
        kill(signal?: NodeJS.Signals | number) { signals.push(signal); return true; } };
    assert.equal(terminateOwnedExecutionLeader(leader, 'SIGKILL'), state === 'active');
    assert.deepEqual(signals, state === 'active' ? ['SIGKILL'] : []);
});

test('owned-group host: failed owned-handle signal does not authorize a fallback target', () => {
    let calls = 0;
    const leader = { pid: 4242, exitCode: null, signalCode: null, kill() { calls++; throw new Error('unknown'); } };
    assert.equal(terminateOwnedExecutionLeader(leader, 'SIGTERM'), false);
    assert.equal(calls, 1);
});
