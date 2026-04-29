import test from 'node:test';
import assert from 'node:assert/strict';
/* @Codex */
import { isHttpsRequest, sessionCookieOptionsForRequest } from './request-transport.ts';

test('isHttpsRequest returns true for direct https requests', () => {
    const request = new Request('https://127.0.0.1:3443/api/auth/login');

    assert.equal(isHttpsRequest(request), true);
    assert.equal(sessionCookieOptionsForRequest(request).secure, true);
});

test('isHttpsRequest trusts forwarded https requests from the TLS proxy', () => {
    const request = new Request('http://127.0.0.1:3000/api/auth/login', {
        headers: {
            'x-forwarded-proto': 'https',
        },
    });

    assert.equal(isHttpsRequest(request), true);
    assert.equal(sessionCookieOptionsForRequest(request).secure, true);
});

test('isHttpsRequest handles comma-separated forwarded proto values', () => {
    const request = new Request('http://127.0.0.1:3000/api/auth/login', {
        headers: {
            'x-forwarded-proto': 'https, http',
        },
    });

    assert.equal(isHttpsRequest(request), true);
});

test('isHttpsRequest returns false when neither the url nor forwarded headers are https', () => {
    const request = new Request('http://127.0.0.1:3000/api/auth/login');

    assert.equal(isHttpsRequest(request), false);
    assert.equal(sessionCookieOptionsForRequest(request).secure, false);
});
