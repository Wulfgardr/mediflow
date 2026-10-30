import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localUiLeaseRequest } from './local-ui-lease-request';
const input = { tab: '75700000-0000-4000-8000-000000000000', action: 'renew' };
const request = (headers = {}) => new Request('http://127.0.0.1:4321/api/plugin-local-ui/lease', { method: 'POST', headers: {
    host: '127.0.0.1:4321', origin: 'http://127.0.0.1:4321', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...headers,
} });
test('UI lease accepts only exact same-origin loopback mutations and a closed body', () => {
    assert.deepEqual(localUiLeaseRequest(request(), input), input);
    for (const headers of [{ origin: 'http://localhost:4321' }, { origin: 'http://127.0.0.1:4322' }, { 'sec-fetch-site': 'same-site' },
        { 'sec-fetch-site': 'cross-site' }, { 'content-type': 'text/plain' }, { host: 'localhost:4321' }, { origin: '' }]) {
        assert.equal(localUiLeaseRequest(request(headers), input), null);
    }
    for (const body of [{ ...input, capability: 'clinical.write' }, { ...input, tab: '../forged' }, { ...input, action: 'stop' }]) {
        assert.equal(localUiLeaseRequest(request(), body), null);
    }
});
