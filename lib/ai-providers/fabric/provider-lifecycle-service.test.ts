/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { advanceOnboarding, startOnboarding } from './onboarding.ts';
import {
    createHostProviderLifecycleService,
    ProviderLifecycleServiceError,
} from './provider-lifecycle-service.ts';
import { getProviderLifecycleStorePaths, ProviderLifecycleStoreError } from './provider-lifecycle-store.ts';

const roots: string[] = [];
function root(): string {
    const value = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-lifecycle-service-'));
    roots.push(value); return value;
}
function enabledLocal() {
    let state = startOnboarding('ollama', 'local_model');
    for (const type of ['configure', 'credential_declared', 'attest_local', 'enable'] as const) {
        state = advanceOnboarding(state, { type });
    }
    return state;
}
function expectCode(code: string, run: () => unknown): void {
    assert.throws(run, (error) => (
        (error instanceof ProviderLifecycleServiceError || error instanceof ProviderLifecycleStoreError)
        && error.code === code
    ));
}
afterEach(() => { for (const value of roots.splice(0)) fs.rmSync(value, { recursive: true, force: true }); });

test('separates read service from host control and generates operation metadata', () => {
    const boundary = createHostProviderLifecycleService({
        appDataDir: root(),
        sources: {
            entropy: () => `${'1'.repeat(32)}${'2'.repeat(32)}`,
            now: () => '2026-08-22T11:00:00.000Z',
        },
    });
    assert.deepEqual(Object.keys(boundary), ['service', 'control']);
    assert.deepEqual(Object.keys(boundary.service), ['read']);
    assert.deepEqual(Object.keys(boundary.control), ['admit', 'degrade', 'recover', 'revoke']);
    assert.equal('admit' in boundary.service, false);

    const admitted = boundary.control.admit({ expectedVersion: 0, onboarding: enabledLocal() });
    assert.equal(admitted.actorRef, `actor_${'1'.repeat(32)}`);
    assert.equal(admitted.receiptRef, `receipt_${'2'.repeat(32)}`);
    assert.equal(admitted.hostTimestamp, '2026-08-22T11:00:00.000Z');
    const read = boundary.service.read();
    assert.equal(read.status, 'available');
    if (read.status === 'available') {
        assert.deepEqual(read.record, admitted);
        assert.notEqual(read.record, admitted);
        assert.equal(Object.isFrozen(read.record), true);
    }
});

test('rejects caller authority extras and snapshots host sources once', () => {
    const appDataDir = root();
    let entropyReads = 0; let clockReads = 0;
    const boundary = createHostProviderLifecycleService({ appDataDir, sources: {
        entropy: () => { entropyReads += 1; return 'a'.repeat(64); },
        now: () => { clockReads += 1; return '2026-08-22T11:01:00.000Z'; },
    } });
    expectCode('input_invalid', () => boundary.control.admit({
        expectedVersion: 0, onboarding: enabledLocal(), actorRef: 'actor_caller',
    }));
    expectCode('input_invalid', () => boundary.control.admit({
        expectedVersion: 0, onboarding: { ...enabledLocal(), token: 'synthetic-secret' },
    }));
    assert.deepEqual([entropyReads, clockReads], [0, 0]);
    boundary.control.admit({ expectedVersion: 0, onboarding: enabledLocal() });
    assert.deepEqual([entropyReads, clockReads], [1, 1]);

    const accessor = { now: () => '2026-08-22T11:01:00.000Z' } as Record<string, unknown>;
    Object.defineProperty(accessor, 'entropy', { enumerable: true, get: () => () => 'b'.repeat(64) });
    expectCode('source_invalid', () => createHostProviderLifecycleService({ appDataDir: root(), sources: accessor }));
    const malformed = createHostProviderLifecycleService({ appDataDir: root(), sources: {
        entropy: () => Object.defineProperty({}, 'value', { get: () => 'c'.repeat(64) }),
        now: () => '2026-08-22T11:01:00.000Z',
    } });
    expectCode('source_invalid', () => malformed.control.admit({ expectedVersion: 0, onboarding: enabledLocal() }));
});

test('keeps CAS stable and revocation terminal across restart', () => {
    const appDataDir = root();
    const options = { appDataDir, sources: {
        entropy: () => 'd'.repeat(64), now: () => '2026-08-22T11:02:00.000Z',
    } };
    const first = createHostProviderLifecycleService(options);
    first.control.admit({ expectedVersion: 0, onboarding: enabledLocal() });
    first.control.degrade({ expectedVersion: 1 });
    expectCode('version_conflict', () => first.control.recover({ expectedVersion: 1 }));
    first.control.revoke({ expectedVersion: 2 });
    const restarted = createHostProviderLifecycleService(options);
    const read = restarted.service.read();
    assert.equal(read.status === 'available' && read.record.lifecycle.status, 'revoked');
    expectCode('transition_invalid', () => restarted.control.recover({ expectedVersion: 3 }));
    const raw = fs.readFileSync(getProviderLifecycleStorePaths(appDataDir).recordPath, 'utf8');
    assert.doesNotMatch(raw, /patient|clinical|prompt|token|endpoint|response/i);
});

test('returns explicit fail-closed read dispositions', () => {
    const appDataDir = root();
    const boundary = createHostProviderLifecycleService({ appDataDir });
    assert.deepEqual(boundary.service.read(), { status: 'denied', reason: 'missing' });
    const paths = getProviderLifecycleStorePaths(appDataDir);
    fs.mkdirSync(paths.directory, { recursive: true });
    fs.writeFileSync(paths.recordPath, '{');
    assert.deepEqual(boundary.service.read(), { status: 'denied', reason: 'corrupt' });
    fs.rmSync(paths.recordPath); fs.mkdirSync(paths.recordPath);
    assert.deepEqual(boundary.service.read(), { status: 'denied', reason: 'unavailable' });
});
