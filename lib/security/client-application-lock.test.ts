/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    APPLICATION_LOCK_RECEIPT_SCHEMA_VERSION,
    isExactApplicationLockReceipt,
    requestApplicationLockConfirmation,
} from './client-auth-api';

const confirmedReceipt = {
    schemaVersion: APPLICATION_LOCK_RECEIPT_SCHEMA_VERSION,
    state: 'server_invalidation_confirmed',
};

test('application lock confirmation posts only to the same-origin lock endpoint', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    globalThis.fetch = async (input, init) => {
        calls.push({ input, init });
        return new Response(JSON.stringify(confirmedReceipt), { status: 200 });
    };

    try {
        assert.equal(await requestApplicationLockConfirmation(), true);
        assert.deepEqual(calls, [{
            input: '/api/auth/lock',
            init: { method: 'POST', credentials: 'same-origin' },
        }]);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('application lock confirmation accepts only an exact 200 confirmation receipt', async () => {
    const originalFetch = globalThis.fetch;
    const cases: Array<{ status: number; body: unknown; expected: boolean }> = [
        { status: 200, body: confirmedReceipt, expected: true },
        { status: 409, body: confirmedReceipt, expected: false },
        { status: 200, body: { ...confirmedReceipt, extra: true }, expected: false },
        { status: 200, body: { schemaVersion: APPLICATION_LOCK_RECEIPT_SCHEMA_VERSION, state: 'server_invalidation_unconfirmed' }, expected: false },
        { status: 200, body: null, expected: false },
    ];

    try {
        for (const value of cases) {
            globalThis.fetch = async () => new Response(JSON.stringify(value.body), { status: value.status });
            assert.equal(await requestApplicationLockConfirmation(), value.expected);
        }
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('application lock confirmation rejects malformed parsed records and propagates transport or JSON failures', async () => {
    const accessor = {};
    Object.defineProperty(accessor, 'schemaVersion', { enumerable: true, get: () => APPLICATION_LOCK_RECEIPT_SCHEMA_VERSION });
    Object.defineProperty(accessor, 'state', { enumerable: true, get: () => 'server_invalidation_confirmed' });
    const nonEnumerable = { ...confirmedReceipt };
    Object.defineProperty(nonEnumerable, 'state', { enumerable: false, value: 'server_invalidation_confirmed' });
    const proxyLike = new Proxy({}, { ownKeys: () => { throw new Error('hostile ownKeys'); } });

    assert.equal(isExactApplicationLockReceipt(accessor), false);
    assert.equal(isExactApplicationLockReceipt(nonEnumerable), false);
    assert.equal(isExactApplicationLockReceipt(proxyLike), false);

    const originalFetch = globalThis.fetch;
    try {
        globalThis.fetch = async () => { throw new Error('transport failed'); };
        await assert.rejects(requestApplicationLockConfirmation(), /transport failed/);

        globalThis.fetch = async () => new Response('{', { status: 200 });
        assert.equal(await requestApplicationLockConfirmation(), false);

        globalThis.fetch = async () => ({
            status: 200,
            text: async () => { throw new Error('response body failed'); },
        }) as unknown as Response;
        await assert.rejects(requestApplicationLockConfirmation(), /response body failed/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('security provider revokes local authority before the asynchronous confirmation and ignores stale responses', () => {
    const source = readFileSync(new URL('../../components/security-provider.tsx', import.meta.url), 'utf8');
    const lockStart = source.indexOf('const lock = () => {');
    const requestStart = source.indexOf('void requestApplicationLockConfirmation()', lockStart);

    assert.ok(lockStart >= 0 && requestStart > lockStart);
    assert.ok(source.indexOf('clearSecuritySession();', lockStart) < requestStart);
    assert.ok(source.indexOf('setActiveMasterKey(null);', lockStart) < requestStart);
    assert.ok(source.indexOf('setIsAuthenticated(false);', lockStart) < requestStart);
    assert.match(source, /authorityAttemptGenerationRef\.current === attemptGeneration/);
    assert.doesNotMatch(source, /logoutSecuritySession|\/api\/auth\/logout/);
});
