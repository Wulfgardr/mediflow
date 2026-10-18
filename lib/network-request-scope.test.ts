import assert from 'node:assert/strict';
import test from 'node:test';
import { bindNetworkRequestScope, NETWORK_EXPECTED_SCOPE_HEADER } from './network-request-scope';

function request(expected?: string) {
    return new Request('http://127.0.0.1/synthetic', {
        headers: expected === undefined ? {} : { [NETWORK_EXPECTED_SCOPE_HEADER]: expected },
    });
}

test('an expected scope asserts the resolved context and never grants or substitutes a scope', () => {
    assert.equal(bindNetworkRequestScope(request('synthetic-b'), 'synthetic-b'), 'synthetic-b');
    assert.equal(bindNetworkRequestScope(request('synthetic-b'), 'synthetic-default'), null);
    assert.equal(bindNetworkRequestScope(request('synthetic-b'), null), null);
    assert.equal(bindNetworkRequestScope(request('synthetic-b'), ''), null);
});

test('headerless clients retain the existing resolved cookie/default scope', () => {
    assert.equal(bindNetworkRequestScope(request(), 'synthetic-default'), 'synthetic-default');
    assert.equal(bindNetworkRequestScope(request(), 'synthetic-selected'), 'synthetic-selected');
    assert.equal(bindNetworkRequestScope(request(), null), null);
});

test('scope assertions preserve opaque IDs with one canonical encoding', () => {
    for (const id of ["synthetic !'()*~-_.", 'synthetic,scope', 'synthetic/é漢字%2F;=', 'synthetic%scope']) {
        const encoded = encodeURIComponent(id);
        assert.equal(bindNetworkRequestScope(request(encoded), id), id);
        assert.equal(bindNetworkRequestScope(request(encodeURIComponent(encoded)), id), null);
    }
});

test('malformed, unencoded, empty and duplicate scope assertions are rejected', () => {
    for (const expected of ['', '%', '%ZZ', '%73ynthetic', 'synthetic, synthetic', 'other']) {
        assert.equal(bindNetworkRequestScope(request(expected), 'synthetic'), null, expected);
    }
    assert.equal(bindNetworkRequestScope(request('synthetic%2fscope'), 'synthetic/scope'), null);
    const duplicated = request('synthetic');
    duplicated.headers.append(NETWORK_EXPECTED_SCOPE_HEADER, 'synthetic');
    assert.equal(bindNetworkRequestScope(duplicated, 'synthetic'), null);
});
