import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocalUiPairingRequest } from './plugin-local-ui-pairing-request.ts';

test('pairing uses the actual Host transport when Next normalizes the request URL', () => {
  const request = new Request('http://localhost:3210/api/plugin-local-ui/pairing', { method: 'POST', headers: {
    host: '127.0.0.1:3210', origin: 'http://127.0.0.1:3210', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json',
  }, body: '{}' });
  assert.equal(isLocalUiPairingRequest(request), true);
  assert.equal(isLocalUiPairingRequest(request, true), true);
  const mutations: Record<string, string>[] = [{ host: 'foreign.invalid:3210' }, { origin: 'http://127.0.0.1:3211' }, { 'sec-fetch-site': 'cross-site' }, { 'content-type': 'text/plain' }];
  for (const headers of mutations) {
    const forged = new Request(request.url, { method: 'POST', headers: { ...Object.fromEntries(request.headers), ...headers }, body: '{}' });
    assert.equal(isLocalUiPairingRequest(forged, true), false);
  }
});
