/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { NextResponse } from 'next/server';

import {
    setWebAuthControlCookie,
    setWebAuthControlEtag,
    strongWebAuthControlEtag,
    webAuthControlEtagFromHeader,
    webAuthControlIdFromRequest,
    webAuthControlMutationFromRequest,
    webAuthSessionIdFromRequest,
} from './web-auth-control-transport';

const CONTROL_ID = 'c'.repeat(64);
const ETAG = 'e'.repeat(64);
const SESSION_ID = 'a'.repeat(64);
const IDEMPOTENCY_KEY = '8a340d36-0920-4d13-b915-0cbb44f3db44';

function mutationRequest(overrides: Record<string, string> = {}) {
    return new Request('http://127.0.0.1/api/auth/login', {
        method: 'POST',
        headers: {
            cookie: `mediflow_session=${SESSION_ID}; mediflow_auth_control=${CONTROL_ID}`,
            'if-match': `"${ETAG}"`,
            'idempotency-key': IDEMPOTENCY_KEY,
            ...overrides,
        },
    });
}

test('parses one exact control mutation and keeps bearer plus control as inert locators', () => {
    const request = mutationRequest();
    assert.equal(webAuthControlIdFromRequest(request), CONTROL_ID);
    assert.equal(webAuthSessionIdFromRequest(request), SESSION_ID);
    const mutation = webAuthControlMutationFromRequest(request);
    assert.ok(mutation);
    assert.equal(Object.getPrototypeOf(mutation), Object.prototype);
    assert.equal(Object.isFrozen(mutation), true);
    assert.deepEqual(Object.keys(mutation).sort(), ['controlId', 'idempotencyKey', 'ifMatch']);
    assert.equal(mutation.controlId, CONTROL_ID);
    assert.equal(mutation.ifMatch, ETAG);
    assert.equal(mutation.idempotencyKey, IDEMPOTENCY_KEY);
});

test('denies weak ETags, duplicate controls and non-random idempotency keys', () => {
    for (const request of [
        mutationRequest({ 'if-match': `W/"${ETAG}"` }),
        mutationRequest({ 'if-match': ETAG }),
        mutationRequest({ 'idempotency-key': 'predictable-key' }),
        mutationRequest({ cookie: `mediflow_auth_control=${CONTROL_ID}; mediflow_auth_control=${CONTROL_ID}` }),
    ]) {
        assert.equal(webAuthControlMutationFromRequest(request), null);
    }
    assert.equal(webAuthSessionIdFromRequest(mutationRequest({ cookie: `mediflow_session=${'A'.repeat(64)}` })), null);
});

test('quotes only strong opaque ETags and emits a session control cookie without persistence', () => {
    assert.equal(webAuthControlEtagFromHeader(`"${ETAG}"`), ETAG);
    assert.equal(webAuthControlEtagFromHeader(`W/"${ETAG}"`), null);
    assert.equal(strongWebAuthControlEtag(ETAG), `"${ETAG}"`);

    const response = NextResponse.json({ status: 'ok' });
    const request = new Request('https://127.0.0.1/api/auth/check');
    assert.equal(setWebAuthControlEtag(response, ETAG), true);
    assert.equal(setWebAuthControlCookie(response, request, CONTROL_ID), true);
    const cookie = response.headers.get('set-cookie');
    assert.equal(response.headers.get('etag'), `"${ETAG}"`);
    assert.match(cookie ?? '', /^mediflow_auth_control=/u);
    assert.match(cookie ?? '', /Path=\//u);
    assert.match(cookie ?? '', /HttpOnly/u);
    assert.match(cookie ?? '', /SameSite=lax/iu);
    assert.match(cookie ?? '', /Secure/u);
    assert.doesNotMatch(cookie ?? '', /Max-Age|Expires/iu);
});
