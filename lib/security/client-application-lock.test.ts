/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    APPLICATION_LOCK_RECEIPT_SCHEMA_VERSION,
    checkAuthHealthRequest,
    createClientAuthorityNetworkBarrier,
    loginWithPinRequest,
    requestApplicationLockConfirmation,
    setupSecurityRequest,
} from './client-auth-api';

const confirmedReceipt = { schemaVersion: APPLICATION_LOCK_RECEIPT_SCHEMA_VERSION, state: 'server_invalidation_confirmed' };
const unconfirmedReceipt = { schemaVersion: APPLICATION_LOCK_RECEIPT_SCHEMA_VERSION, state: 'server_invalidation_unconfirmed' };

async function bootstrapAuthControl(etag: string): Promise<void> {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        assert.equal(input, '/api/auth/check');
        assert.deepEqual(init, { cache: 'no-store', credentials: 'same-origin' });
        return new Response(JSON.stringify({ status: 'ok', isSetup: true }), { status: 200, headers: { ETag: etag } });
    };
    try {
        const { response, controlState } = await checkAuthHealthRequest();
        assert.equal(response.status, 200);
        assert.equal(controlState, 'accepted');
    }
    finally { globalThis.fetch = originalFetch; }
}

function mutationHeaders(init?: RequestInit): Headers {
    assert.equal(init?.credentials, 'same-origin');
    return new Headers(init?.headers);
}

function assertRandomMutationKey(value: string | null): asserts value is string { assert.match(value ?? '', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u); }

function jsonResponse(body: unknown, status: number, etag?: string): Response { return new Response(JSON.stringify(body), { status, headers: etag ? { ETag: etag } : undefined }); }

test('application lock confirmation posts only to the same-origin lock endpoint', async () => {
    await bootstrapAuthControl('"fence-lock-0"');
    const originalFetch = globalThis.fetch;
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    globalThis.fetch = async (input, init) => {
        calls.push({ input, init });
        return jsonResponse(confirmedReceipt, 200, '"fence-lock-1"');
    };
    try {
        assert.equal(await requestApplicationLockConfirmation(), true);
        assert.equal(calls.length, 1);
        assert.equal(calls[0]?.input, '/api/auth/lock');
        assert.equal(calls[0]?.init?.method, 'POST');
        const headers = mutationHeaders(calls[0]?.init);
        assert.equal(headers.get('If-Match'), '"fence-lock-0"');
        assertRandomMutationKey(headers.get('Idempotency-Key'));
    } finally { globalThis.fetch = originalFetch; }
});

test('application lock confirmation accepts only an exact 200 confirmation receipt', async () => {
    const originalFetch = globalThis.fetch;
    const cases: Array<[number, unknown, boolean]> = [
        [200, confirmedReceipt, true], [409, confirmedReceipt, false], [200, { ...confirmedReceipt, extra: true }, false],
        [200, { schemaVersion: APPLICATION_LOCK_RECEIPT_SCHEMA_VERSION, state: 'server_invalidation_unconfirmed' }, false], [200, null, false],
    ];
    try {
        for (const [index, [status, body, expected]] of cases.entries()) {
            await bootstrapAuthControl(`"fence-exact-${index}"`);
            globalThis.fetch = async () => jsonResponse(body, status, `"fence-exact-${index + 1}"`);
            assert.equal(await requestApplicationLockConfirmation(), expected);
        }
    } finally { globalThis.fetch = originalFetch; }
});

test('application lock confirmation rejects malformed parsed records and transport or body failures', async () => {
    const originalFetch = globalThis.fetch;
    try {
        await bootstrapAuthControl('"fence-transport"');
        globalThis.fetch = async () => { throw new Error('transport failed'); };
        await assert.rejects(requestApplicationLockConfirmation(), /transport failed/);
        await bootstrapAuthControl('"fence-malformed"');
        globalThis.fetch = async () => new Response('{', { status: 200 });
        assert.equal(await requestApplicationLockConfirmation(), false);
        await bootstrapAuthControl('"fence-body"');
        globalThis.fetch = async () => ({
            status: 200,
            headers: new Headers({ ETag: '"fence-body-next"' }),
            text: async () => { throw new Error('response body failed'); },
        }) as unknown as Response;
        await assert.rejects(requestApplicationLockConfirmation(), /response body failed/);
    } finally { globalThis.fetch = originalFetch; }
});

test('auth mutations retain the strong check ETag and preserve their public bodies', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    try {
        await bootstrapAuthControl('"fence-login"');
        globalThis.fetch = async (input, init) => { calls.push({ input, init }); return jsonResponse({ id: 'synthetic-user' }, 200, '"fence-login-next"'); };
        const login = await loginWithPinRequest('123456');
        assert.equal(login.controlState, 'accepted');

        await bootstrapAuthControl('"fence-setup"');
        const setup = await setupSecurityRequest({
            username: 'admin', password: '654321', encryptedMasterKey: 'synthetic-encrypted-key',
            salt: 'synthetic-salt', displayName: 'Synthetic Admin', ambulatoryName: 'Synthetic Clinic',
        });
        assert.equal(setup.controlState, 'accepted');

        assert.equal(calls.length, 2);
        const loginHeaders = mutationHeaders(calls[0]?.init);
        const setupHeaders = mutationHeaders(calls[1]?.init);
        assert.equal(calls[0]?.input, '/api/auth/login'); assert.equal(loginHeaders.get('If-Match'), '"fence-login"');
        assert.equal(loginHeaders.get('Content-Type'), 'application/json'); assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { password: '123456' });
        assert.equal(calls[1]?.input, '/api/auth/setup'); assert.equal(setupHeaders.get('If-Match'), '"fence-setup"');
        assert.equal(setupHeaders.get('Content-Type'), 'application/json');
        assert.equal(JSON.parse(String(calls[1]?.init?.body)).password, '654321');
        assertRandomMutationKey(loginHeaders.get('Idempotency-Key'));
        assertRandomMutationKey(setupHeaders.get('Idempotency-Key'));
        assert.notEqual(loginHeaders.get('Idempotency-Key'), setupHeaders.get('Idempotency-Key'));
    } finally { globalThis.fetch = originalFetch; }
});

test('a late auth check response cannot roll the retained fence back', async () => {
    await bootstrapAuthControl('"fence-cas-0"');
    const originalFetch = globalThis.fetch;
    let resolveCheck: (response: Response) => void = () => undefined;
    const pendingCheckResponse = new Promise<Response>((resolve) => { resolveCheck = resolve; });
    const observedMutationFences: string[] = [];
    globalThis.fetch = async (input, init) => {
        if (input === '/api/auth/check') return pendingCheckResponse;
        const headers = mutationHeaders(init);
        observedMutationFences.push(headers.get('If-Match') ?? '');
        if (input === '/api/auth/login') return jsonResponse({ id: 'synthetic-user' }, 200, '"fence-cas-1"');
        return jsonResponse(confirmedReceipt, 200, '"fence-cas-2"');
    };
    try {
        const lateCheck = checkAuthHealthRequest();
        await loginWithPinRequest('123456');
        resolveCheck(jsonResponse({ status: 'ok', isSetup: true, hasSession: false }, 200, '"fence-cas-stale"'));
        const lateResult = await lateCheck;
        assert.equal(lateResult.controlState, 'stale');
        assert.equal(lateResult.payload?.hasSession, false);
        assert.equal(await requestApplicationLockConfirmation(), true);
        assert.deepEqual(observedMutationFences, ['"fence-cas-0"', '"fence-cas-1"']);
    } finally { globalThis.fetch = originalFetch; }
});

test('concurrent auth checks share one bootstrap request and release the latch after settlement', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    let release: (response: Response) => void = () => undefined;
    const deferred = new Promise<Response>((resolve) => { release = resolve; });
    globalThis.fetch = async () => {
        calls += 1;
        if (calls === 1) return deferred;
        return jsonResponse({ status: 'ok', isSetup: true }, 200, '"fence-bootstrap-b"');
    };
    try {
        const first = checkAuthHealthRequest();
        const second = checkAuthHealthRequest();
        await Promise.resolve();
        assert.equal(calls, 1);
        release(jsonResponse({ status: 'ok', isSetup: true }, 200, '"fence-bootstrap-a"'));
        const [firstResult, secondResult] = await Promise.all([first, second]);
        assert.equal(firstResult.controlState, 'accepted');
        assert.strictEqual(firstResult, secondResult);

        const thirdResult = await checkAuthHealthRequest();
        assert.equal(calls, 2);
        assert.equal(thirdResult.controlState, 'accepted');
    } finally { globalThis.fetch = originalFetch; }
});

test('a rejected shared auth check releases the bootstrap latch for retry', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
        calls += 1;
        if (calls === 1) throw new Error('synthetic bootstrap failure');
        return jsonResponse({ status: 'ok', isSetup: true }, 200, '"fence-bootstrap-recovered"');
    };
    try {
        const first = checkAuthHealthRequest();
        const second = checkAuthHealthRequest();
        const failures = await Promise.allSettled([first, second]);
        assert.deepEqual(failures.map((result) => result.status), ['rejected', 'rejected']);
        assert.equal(calls, 1);
        assert.equal((await checkAuthHealthRequest()).controlState, 'accepted');
        assert.equal(calls, 2);
    } finally { globalThis.fetch = originalFetch; }
});

test('successful auth mutations without a strong successor fence fail their client control observation', async () => {
    const originalFetch = globalThis.fetch;
    try {
        for (const [index, etag] of [undefined, 'W/"weak-fence"', '"fence-no-successor"'].entries()) {
            await bootstrapAuthControl('"fence-no-successor"');
            globalThis.fetch = async () => jsonResponse({ id: `synthetic-user-${index}` }, 200, etag);
            const result = await loginWithPinRequest('123456');
            assert.equal(result.response.ok, true);
            assert.equal(result.controlState, 'invalid');
        }
    } finally { globalThis.fetch = originalFetch; }
});

test('login and setup surface post-response body loss as invalid authority that can be locked', async () => {
    const originalFetch = globalThis.fetch;
    const setupPayload = {
        username: 'admin', password: '654321', encryptedMasterKey: 'synthetic-encrypted-key',
        salt: 'synthetic-salt', displayName: 'Synthetic Admin', ambulatoryName: 'Synthetic Clinic',
    };
    const cases = [
        ['/api/auth/login', () => loginWithPinRequest('123456')],
        ['/api/auth/setup', () => setupSecurityRequest(setupPayload)],
    ] as const;
    try {
        for (const [index, [endpoint, request]] of cases.entries()) {
            const current = `"fence-body-loss-${index}"`;
            const successor = `"fence-body-loss-${index}-next"`;
            const terminal = `"fence-body-loss-${index}-locked"`;
            await bootstrapAuthControl(current);
            const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
            globalThis.fetch = async (input, init) => {
                calls.push({ input, init });
                if (input === endpoint) {
                    return {
                        ok: true,
                        status: 200,
                        headers: new Headers({ ETag: successor }),
                        text: async () => { throw new Error('synthetic post-response body loss'); },
                    } as unknown as Response;
                }
                assert.equal(input, '/api/auth/lock');
                return jsonResponse(confirmedReceipt, 200, terminal);
            };

            const result = await request();
            assert.equal(result.response.ok, true);
            assert.equal(result.payload, null);
            assert.equal(result.controlState, 'invalid');
            assert.equal(await requestApplicationLockConfirmation(), true);
            assert.deepEqual(calls.map((call) => call.input), [endpoint, '/api/auth/lock']);
            assert.equal(mutationHeaders(calls[1]?.init).get('If-Match'), successor);
        }
    } finally { globalThis.fetch = originalFetch; }
});

test('lock replays a lost response with the same key and retries one stale fence with a new key', async () => {
    await bootstrapAuthControl('"fence-race-0"');
    const originalFetch = globalThis.fetch;
    const calls: RequestInit[] = [];
    globalThis.fetch = async (input, init) => {
        assert.equal(input, '/api/auth/lock');
        calls.push(init ?? {});
        if (calls.length === 1) throw new Error('synthetic lost response');
        if (calls.length === 2) return jsonResponse(unconfirmedReceipt, 409, '"fence-race-1"');
        return jsonResponse(confirmedReceipt, 200, '"fence-race-2"');
    };
    try {
        assert.equal(await requestApplicationLockConfirmation(), true);
        assert.equal(calls.length, 3);
        const headers = calls.map(mutationHeaders);
        assert.equal(headers[0]?.get('If-Match'), '"fence-race-0"');
        assert.equal(headers[1]?.get('If-Match'), '"fence-race-0"');
        assert.equal(headers[2]?.get('If-Match'), '"fence-race-1"');
        assert.equal(headers[0]?.get('Idempotency-Key'), headers[1]?.get('Idempotency-Key'));
        assert.notEqual(headers[1]?.get('Idempotency-Key'), headers[2]?.get('Idempotency-Key'));
    } finally { globalThis.fetch = originalFetch; }
});

test('lock replays a post-CAS body-read failure with the same logical key', async () => {
    await bootstrapAuthControl('"fence-body-replay-0"');
    const originalFetch = globalThis.fetch;
    const calls: RequestInit[] = [];
    globalThis.fetch = async (input, init) => {
        assert.equal(input, '/api/auth/lock');
        calls.push(init ?? {});
        if (calls.length === 1) {
            return {
                status: 200,
                headers: new Headers({ ETag: '"fence-body-replay-1"' }),
                text: async () => { throw new Error('synthetic body loss'); },
            } as unknown as Response;
        }
        return jsonResponse(confirmedReceipt, 200, '"fence-body-replay-1"');
    };
    try {
        assert.equal(await requestApplicationLockConfirmation(), true);
        assert.equal(calls.length, 2);
        const headers = calls.map(mutationHeaders);
        assert.equal(headers[0]?.get('If-Match'), '"fence-body-replay-0"');
        assert.equal(headers[1]?.get('If-Match'), '"fence-body-replay-0"');
        assert.equal(headers[0]?.get('Idempotency-Key'), headers[1]?.get('Idempotency-Key'));
    } finally { globalThis.fetch = originalFetch; }
});

test('application lock confirmation rejects forbidden Object.prototype keys present before import', () => {
    const source = readFileSync(new URL('./client-auth-api.ts', import.meta.url), 'utf8');
    for (const key of ['then', 'value', 'schemaVersion', 'state']) {
        const script = `import ts from 'typescript'; const output = ts.transpileModule(${JSON.stringify(source)}, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText; Object.defineProperty(Object.prototype, ${JSON.stringify(key)}, { configurable: true, value: undefined }); globalThis.fetch = async (input) => input === '/api/auth/check' ? new Response('{"status":"ok"}', { status: 200, headers: { ETag: '"fence-poison"' } }) : new Response(${JSON.stringify(JSON.stringify(confirmedReceipt))}, { status: 200, headers: { ETag: '"fence-poison-next"' } }); const api = await import('data:text/javascript;base64,' + Buffer.from(output).toString('base64')); await api.checkAuthHealthRequest(); if (await api.requestApplicationLockConfirmation()) process.exitCode = 1;`;
        execFileSync(process.execPath, ['--input-type=module', '--eval', script]);
    }
});

test('client authority network barrier serializes authority starts and recovers after rejection', async () => {
    const barrier = createClientAuthorityNetworkBarrier();
    const events: string[] = [];
    let releaseLogin: () => void = () => undefined;
    const loginDone = new Promise<void>((resolve) => { releaseLogin = resolve; });
    const login = barrier.run(async () => { events.push('login-start'); await loginDone; events.push('login-terminal'); });
    const setup = barrier.run(async () => { events.push('setup-start', 'setup-terminal'); });
    await Promise.resolve(); assert.deepEqual(events, ['login-start']);
    releaseLogin(); await login; await Promise.resolve();
    await setup;
    assert.deepEqual(events, ['login-start', 'login-terminal', 'setup-start', 'setup-terminal']);

    const recovery = createClientAuthorityNetworkBarrier();
    await assert.rejects(recovery.run(async () => { throw new Error('synthetic request failure'); }), /synthetic request failure/);
    assert.equal(await recovery.run(async () => 'next request started'), 'next request started');
});

test('application lock bypasses a pending authority barrier and cancels a queued authority start', async () => {
    const barrier = createClientAuthorityNetworkBarrier();
    const events: string[] = [];
    let generation = 0;
    let releaseLogin: () => void = () => undefined;
    const loginDone = new Promise<void>((resolve) => { releaseLogin = resolve; });
    const firstGeneration = generation;
    const login = barrier.run(async () => {
        events.push('login-start');
        await loginDone;
        events.push('login-terminal');
    });
    const queuedGeneration = generation;
    const queued = barrier.run(async () => {
        if (generation !== queuedGeneration) {
            events.push('queued-login-skipped');
            return;
        }
        events.push('queued-login-start');
    });

    await Promise.resolve();
    assert.equal(firstGeneration, generation);
    generation += 1;
    events.push('lock-start', 'lock-terminal');
    assert.deepEqual(events, ['login-start', 'lock-start', 'lock-terminal']);

    releaseLogin();
    await login;
    await queued;
    assert.deepEqual(events, ['login-start', 'lock-start', 'lock-terminal', 'login-terminal', 'queued-login-skipped']);
});

test('security provider clears stale persisted authority and fences stale auth paths', () => {
    const source = readFileSync(new URL('../../components/security-provider.tsx', import.meta.url), 'utf8');
    const authApiSource = readFileSync(new URL('./client-auth-api.ts', import.meta.url), 'utf8');
    const lockStart = source.indexOf('const lock = () => {');
    const requestStart = source.indexOf('void requestApplicationLockConfirmation()', lockStart);
    assert.ok(lockStart >= 0 && source.indexOf('clearClientAuthority();', lockStart) < requestStart);
    for (const pattern of [
        /authorityAttemptGenerationRef\.current === attemptGeneration/,
        /runAuthorityNetworkRequest\(async \(\) => \{\s*if \(authorityAttemptGenerationRef\.current !== attemptGeneration\) return null;\s*return loginWithPinRequest\(pin\);/,
        /runAuthorityNetworkRequest\(async \(\) => \{\s*if \(authorityAttemptGenerationRef\.current !== attemptGeneration\) return null;\s*return setupSecurityRequest\(/,
        /await persistSecuritySession\(masterKey, userData\);[\s\S]*?clearClientAuthority\(\);/,
        /setupSecurityRequest[\s\S]*?authorityAttemptGenerationRef\.current !== attemptGeneration[\s\S]*?SETUP_ALREADY_COMPLETED/,
        /handleApiAuthUnavailable[\s\S]*?\+\+authorityAttemptGenerationRef\.current[\s\S]*?clearClientAuthority\(\);/,
        /checkAuthStatus[\s\S]*?controlState === 'stale'\) return;[\s\S]*?controlState === 'invalid'[\s\S]*?clearClientAuthority\(\);/,
        /checkAuthStatus[\s\S]*?if \(!data\)[\s\S]*?clearClientAuthority\(\);[\s\S]*?if \(!res\.ok\)[\s\S]*?clearClientAuthority\(\);[\s\S]*?if \(data\?\.status === 'error' \|\| data\?\.error\)[\s\S]*?clearClientAuthority\(\);[\s\S]*?if \(!data\.isSetup\)[\s\S]*?clearClientAuthority\(\);[\s\S]*?catch \(e\)[\s\S]*?clearClientAuthority\(\);/,
        /loginWithPinRequest[\s\S]*?res\.ok && controlState !== 'accepted'[\s\S]*?lock\(\);[\s\S]*?return false;/,
        /unacceptedServerAuthority = true;[\s\S]*?if \(!data[\s\S]*?lock\(\);[\s\S]*?const userData: User = \{[\s\S]*?unacceptedServerAuthority = false;/,
        /setupSecurityRequest[\s\S]*?res\.ok && controlState !== 'accepted'[\s\S]*?lock\(\);[\s\S]*?return;/,
        /payload\?\.success !== true[\s\S]*?lock\(\);[\s\S]*?return;/,
        /wrapMasterKeyVersioned\(masterKey, pin, salt\);[\s\S]*?authorityAttemptGenerationRef\.current !== attemptGeneration[\s\S]*?runAuthorityNetworkRequest\(async \(\) =>/,
        /let pinMutationDispatched = false;[\s\S]*?pinMutationDispatched = true;[\s\S]*?changePinRequest\(/,
        /changePinRequest[\s\S]*?if \(!res\.ok\)[\s\S]*?return \{ ok: false[\s\S]*?\+\+authorityAttemptGenerationRef\.current;[\s\S]*?clearClientAuthority\(\);[\s\S]*?return \{ ok: true \};[\s\S]*?catch \(e\)[\s\S]*?if \(pinMutationDispatched\) lock\(\);/,
    ]) assert.match(source, pattern);
    assert.doesNotMatch(source, /runAuthorityNetworkRequest\(requestApplicationLockConfirmation\)/);
    assert.match(source, /res\.status === 409 && payload\?\.code === 'SETUP_ALREADY_COMPLETED'/u);
    const setupAlreadyCompleted = source.match(
        /if \(res\.status === 409 && payload\?\.code === 'SETUP_ALREADY_COMPLETED'\) \{([\s\S]*?)\n\s*\}/u,
    );
    assert.ok(setupAlreadyCompleted);
    assert.match(setupAlreadyCompleted[1], /clearClientAuthority\(\);[\s\S]*?setRequiresSetup\(false\);/u);
    assert.doesNotMatch(setupAlreadyCompleted[1], /\blogin\s*\(|setupSecurityRequest|runAuthorityNetworkRequest/u);
    assert.doesNotMatch(source, /res\.status === 403 \|\| res\.status === 409/u);
    assert.doesNotMatch(source, /logoutSecuritySession|\/api\/auth\/logout/);
    assert.doesNotMatch(authApiSource, /export function isExactApplicationLockReceipt/);
    assert.match(authApiSource, /forbiddenLockObjectPrototypeKeys = Object\.freeze\(\['then', 'value', 'schemaVersion', 'state'\]/);
    assert.match(authApiSource, /hasUnchangedObjectPrototype\(\)/);
});
