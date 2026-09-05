import test from 'node:test';
import assert from 'node:assert/strict';
/* @Codex */
import { isHttpsRequest, isTrustedWebMutationRequest, sessionCookieOptionsForRequest } from './request-transport.ts';

const PROXY_HEADERS = { 'x-mediflow-tls-proxy': 'local-api' };

test('isHttpsRequest returns true for direct https requests', () => {
    const request = new Request('https://127.0.0.1:3443/api/auth/login');

    assert.equal(isHttpsRequest(request), true);
    assert.equal(sessionCookieOptionsForRequest(request).secure, true);
});

test('isHttpsRequest trusts forwarded https only when the local TLS proxy marker is present', () => {
    const request = new Request('http://127.0.0.1:3000/api/auth/login', {
        headers: {
            ...PROXY_HEADERS,
            'x-forwarded-proto': 'https',
        },
    });

    assert.equal(isHttpsRequest(request), true);
    assert.equal(sessionCookieOptionsForRequest(request).secure, true);
});

test('isHttpsRequest handles comma-separated forwarded proto values from the proxy', () => {
    const request = new Request('http://127.0.0.1:3000/api/auth/login', {
        headers: {
            ...PROXY_HEADERS,
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

// D1 security hardening: x-forwarded-proto is client-spoofable, so a forged
// value from a non-proxy source must NOT flip the cookie to secure.
test('isHttpsRequest ignores forged x-forwarded-proto without the proxy marker', () => {
    const request = new Request('http://127.0.0.1:3000/api/auth/login', {
        headers: {
            'x-forwarded-proto': 'https',
        },
    });

    assert.equal(isHttpsRequest(request), false);
    assert.equal(sessionCookieOptionsForRequest(request).secure, false);
});

// D1 reviewer fix: the genuine LAN paired path reaches the loopback-only Next
// server through the TLS proxy, which forwards the client's ORIGINAL Host header
// (a .local mDNS name or LAN IP). The request URL host is therefore non-loopback
// on a real remote device. The proxy marker alone must still assert secure:true
// here, otherwise LAN pairing regresses to insecure cookies.
test('isHttpsRequest trusts the proxy marker on a non-loopback (LAN paired) host', () => {
    const request = new Request('http://mediflow-home.local:3000/api/auth/login', {
        headers: {
            ...PROXY_HEADERS,
            'x-forwarded-proto': 'https',
        },
    });

    assert.equal(isHttpsRequest(request), true);
    assert.equal(sessionCookieOptionsForRequest(request).secure, true);
});

test('isHttpsRequest ignores an unrelated proxy-marker value', () => {
    const request = new Request('http://127.0.0.1:3000/api/auth/login', {
        headers: {
            'x-mediflow-tls-proxy': 'attacker',
            'x-forwarded-proto': 'https',
        },
    });

    assert.equal(isHttpsRequest(request), false);
});

test('the proxy marker alone (no forwarded https) does not assert a secure transport', () => {
    const request = new Request('http://127.0.0.1:3000/api/auth/login', {
        headers: {
            ...PROXY_HEADERS,
        },
    });

    assert.equal(isHttpsRequest(request), false);
    assert.equal(sessionCookieOptionsForRequest(request).secure, false);
});

test('isHttpsRequest trusts the proxy marker on a localhost host', () => {
    const request = new Request('http://localhost:3000/api/auth/login', {
        headers: {
            ...PROXY_HEADERS,
            'x-forwarded-proto': 'https',
        },
    });

    assert.equal(isHttpsRequest(request), true);
});

test('accepts only exact same-origin JSON mutation transport', () => {
    const trusted = new Request('http://127.0.0.1:3000/api/system/probe', { method: 'POST', headers: {
        origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json',
    }, body: '{}' });
    assert.equal(isTrustedWebMutationRequest(trusted), true);

    const deniedHeaders: Array<Record<string, string>> = [
        { origin: 'http://127.0.0.1:4000', 'sec-fetch-site': 'same-site', 'content-type': 'application/json' },
        { origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain' },
        { origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
        { origin: 'http://127.0.0.1:3000', 'content-type': 'application/json' },
    ];

    for (const headers of deniedHeaders) {
        const denied = new Request('http://127.0.0.1:3000/api/system/probe', {
            method: 'POST', headers, body: '{}',
        });
        assert.equal(isTrustedWebMutationRequest(denied), false);
    }
});

test('accepts a same-origin bodyless mutation and reconstructs TLS-proxy origin', () => {
    const bodyless = new Request('http://127.0.0.1:3000/api/system/revoke', { method: 'DELETE', headers: {
        origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'same-origin',
    } });
    assert.equal(isTrustedWebMutationRequest(bodyless, false), true);

    const proxied = new Request('http://mediflow-home.local:3000/api/system/probe', { method: 'POST', headers: {
        ...PROXY_HEADERS, 'x-forwarded-proto': 'https', origin: 'https://mediflow-home.local:3000',
        'sec-fetch-site': 'same-origin', 'content-type': 'application/json',
    }, body: '{}' });
    assert.equal(isTrustedWebMutationRequest(proxied), true);
});
