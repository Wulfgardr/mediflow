/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import { loginWithWebAuthControl } from './web-auth-control-test-client.mjs';

const CONTROL_ID = 'c'.repeat(64);
const INITIAL_ETAG = `"${'e'.repeat(64)}"`;
const SUCCESSOR_ETAG = `"${'f'.repeat(64)}"`;
const SESSION_ID = 'a'.repeat(64);

test('bootstraps one control and binds the synthetic login mutation to its cookie and fence', async () => {
    const calls = [];
    const fetchImplementation = async (input, init) => {
        calls.push({ input: String(input), init });
        if (calls.length === 1) {
            return new Response('{"status":"ok","isSetup":true}', {
                status: 200,
                headers: { ETag: INITIAL_ETAG, 'Set-Cookie': `mediflow_auth_control=${CONTROL_ID}; Path=/; HttpOnly` },
            });
        }
        return new Response('{"id":"synthetic-user"}', {
            status: 200,
            headers: { ETag: SUCCESSOR_ETAG, 'Set-Cookie': `mediflow_session=${SESSION_ID}; Path=/; HttpOnly` },
        });
    };

    const result = await loginWithWebAuthControl(
        'http://127.0.0.1:3200',
        { username: 'synthetic-admin', password: '2468' },
        fetchImplementation,
    );
    assert.equal(calls.length, 2);
    assert.equal(calls[0].input, 'http://127.0.0.1:3200/api/auth/check');
    assert.equal(calls[1].input, 'http://127.0.0.1:3200/api/auth/login');
    const headers = new Headers(calls[1].init.headers);
    assert.equal(headers.get('cookie'), `mediflow_auth_control=${CONTROL_ID}`);
    assert.equal(headers.get('if-match'), INITIAL_ETAG);
    assert.match(headers.get('idempotency-key') ?? '', /^[0-9a-f-]{36}$/u);
    assert.deepEqual(JSON.parse(calls[1].init.body), { username: 'synthetic-admin', password: '2468' });
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.json, { id: 'synthetic-user' });
    assert.equal(result.sessionCookie, `mediflow_session=${SESSION_ID}`);
    assert.equal(result.controlEtag, SUCCESSOR_ETAG);
});

test('fails closed on missing bootstrap transport and weak login successors', async () => {
    await assert.rejects(
        loginWithWebAuthControl('http://127.0.0.1:3200', {}, async () => new Response('{}', { status: 200 })),
        /strong auth control ETag/u,
    );

    let calls = 0;
    await assert.rejects(
        loginWithWebAuthControl('http://127.0.0.1:3200', {}, async () => {
            calls += 1;
            if (calls === 1) {
                return new Response('{}', {
                    status: 200,
                    headers: { ETag: INITIAL_ETAG, 'Set-Cookie': `mediflow_auth_control=${CONTROL_ID}` },
                });
            }
            return new Response('{}', { status: 401, headers: { ETag: `W/${SUCCESSOR_ETAG}` } });
        }),
        /strong auth control ETag/u,
    );
});

test('Node smoke callers delegate login to the exact control helper', () => {
    const networkCallers = readdirSync(new URL('.', import.meta.url))
        .filter((name) => /^network-home-base-.*\.test\.mjs$/u.test(name));
    const callers = [
        ...networkCallers,
        'legacy-clinical-writes.test.mjs',
        'patient-concurrency.test.mjs',
        'benchmark-list-routes.mjs',
    ];

    for (const caller of callers) {
        const source = readFileSync(new URL(caller, import.meta.url), 'utf8');
        assert.match(source, /loginWithWebAuthControl/u, caller);
        assert.doesNotMatch(source, /request\(\s*['"]POST['"]\s*,\s*['"]\/api\/auth\/login['"]/u, caller);
        assert.doesNotMatch(source, /fetch\([^)]*\/api\/auth\/login/u, caller);
    }
});
