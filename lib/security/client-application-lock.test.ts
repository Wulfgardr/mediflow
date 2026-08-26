/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { APPLICATION_LOCK_RECEIPT_SCHEMA_VERSION, createClientAuthorityNetworkBarrier, requestApplicationLockConfirmation } from './client-auth-api';

const confirmedReceipt = { schemaVersion: APPLICATION_LOCK_RECEIPT_SCHEMA_VERSION, state: 'server_invalidation_confirmed' };

test('application lock confirmation posts only to the same-origin lock endpoint', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    globalThis.fetch = async (input, init) => {
        calls.push({ input, init });
        return new Response(JSON.stringify(confirmedReceipt), { status: 200 });
    };
    try {
        assert.equal(await requestApplicationLockConfirmation(), true);
        assert.deepEqual(calls, [{ input: '/api/auth/lock', init: { method: 'POST', credentials: 'same-origin' } }]);
    } finally { globalThis.fetch = originalFetch; }
});

test('application lock confirmation accepts only an exact 200 confirmation receipt', async () => {
    const originalFetch = globalThis.fetch;
    const cases: Array<[number, unknown, boolean]> = [
        [200, confirmedReceipt, true], [409, confirmedReceipt, false], [200, { ...confirmedReceipt, extra: true }, false],
        [200, { schemaVersion: APPLICATION_LOCK_RECEIPT_SCHEMA_VERSION, state: 'server_invalidation_unconfirmed' }, false], [200, null, false],
    ];
    try {
        for (const [status, body, expected] of cases) {
            globalThis.fetch = async () => new Response(JSON.stringify(body), { status });
            assert.equal(await requestApplicationLockConfirmation(), expected);
        }
    } finally { globalThis.fetch = originalFetch; }
});

test('application lock confirmation rejects malformed parsed records and transport or body failures', async () => {
    const originalFetch = globalThis.fetch;
    try {
        globalThis.fetch = async () => { throw new Error('transport failed'); };
        await assert.rejects(requestApplicationLockConfirmation(), /transport failed/);
        globalThis.fetch = async () => new Response('{', { status: 200 });
        assert.equal(await requestApplicationLockConfirmation(), false);
        globalThis.fetch = async () => ({ status: 200, text: async () => { throw new Error('response body failed'); } }) as unknown as Response;
        await assert.rejects(requestApplicationLockConfirmation(), /response body failed/);
    } finally { globalThis.fetch = originalFetch; }
});

test('application lock confirmation fails closed when Object.prototype is polluted', async () => {
    const originalFetch = globalThis.fetch;
    assert.equal(Object.getOwnPropertyDescriptor(Object.prototype, 'then'), undefined);
    Object.defineProperty(Object.prototype, 'then', { configurable: true, value: undefined });
    try {
        globalThis.fetch = async () => new Response(JSON.stringify(confirmedReceipt), { status: 200 });
        assert.equal(await requestApplicationLockConfirmation(), false);
    } finally {
        delete (Object.prototype as { then?: unknown }).then;
        globalThis.fetch = originalFetch;
    }
});

test('client authority network barrier preserves login-lock and lock-login request ordering', async () => {
    const barrier = createClientAuthorityNetworkBarrier();
    const events: string[] = [];
    let releaseLogin: () => void = () => undefined;
    let releaseLock: () => void = () => undefined;
    const loginDone = new Promise<void>((resolve) => { releaseLogin = resolve; });
    const lockDone = new Promise<void>((resolve) => { releaseLock = resolve; });
    const login = barrier.run(async () => { events.push('login-start'); await loginDone; events.push('login-terminal'); });
    const lock = barrier.run(async () => { events.push('lock-start'); await lockDone; events.push('lock-terminal'); });
    await Promise.resolve(); assert.deepEqual(events, ['login-start']);
    releaseLogin(); await login; await Promise.resolve();
    assert.deepEqual(events, ['login-start', 'login-terminal', 'lock-start']);
    releaseLock(); await lock;

    const reverse = createClientAuthorityNetworkBarrier();
    const reverseEvents: string[] = [];
    let releaseFirstLock: () => void = () => undefined;
    const firstLockDone = new Promise<void>((resolve) => { releaseFirstLock = resolve; });
    const firstLock = reverse.run(async () => { reverseEvents.push('lock-start'); await firstLockDone; reverseEvents.push('lock-terminal'); });
    const laterLogin = reverse.run(async () => { reverseEvents.push('login-start', 'login-terminal'); });
    await Promise.resolve(); assert.deepEqual(reverseEvents, ['lock-start']);
    releaseFirstLock(); await firstLock; await laterLogin;
    assert.deepEqual(reverseEvents, ['lock-start', 'lock-terminal', 'login-start', 'login-terminal']);

    const recovery = createClientAuthorityNetworkBarrier();
    await assert.rejects(recovery.run(async () => { throw new Error('synthetic request failure'); }), /synthetic request failure/);
    assert.equal(await recovery.run(async () => 'next request started'), 'next request started');
});

test('security provider clears stale persisted authority and fences stale auth paths', () => {
    const source = readFileSync(new URL('../../components/security-provider.tsx', import.meta.url), 'utf8');
    const authApiSource = readFileSync(new URL('./client-auth-api.ts', import.meta.url), 'utf8');
    const lockStart = source.indexOf('const lock = () => {');
    const requestStart = source.indexOf('void runAuthorityNetworkRequest(requestApplicationLockConfirmation)', lockStart);
    assert.ok(lockStart >= 0 && source.indexOf('clearClientAuthority();', lockStart) < requestStart);
    for (const pattern of [
        /authorityAttemptGenerationRef\.current === attemptGeneration/,
        /await runAuthorityNetworkRequest\(\(\) => loginWithPinRequest\(pin\)\)/,
        /await runAuthorityNetworkRequest\(\(\) => setupSecurityRequest\(/,
        /await persistSecuritySession\(masterKey, userData\);[\s\S]*?clearClientAuthority\(\);/,
        /setupSecurityRequest[\s\S]*?authorityAttemptGenerationRef\.current !== attemptGeneration[\s\S]*?SETUP_ALREADY_COMPLETED/,
        /handleApiAuthUnavailable[\s\S]*?\+\+authorityAttemptGenerationRef\.current[\s\S]*?clearClientAuthority\(\);/,
    ]) assert.match(source, pattern);
    assert.doesNotMatch(source, /logoutSecuritySession|\/api\/auth\/logout/);
    assert.doesNotMatch(authApiSource, /export function isExactApplicationLockReceipt/);
});
