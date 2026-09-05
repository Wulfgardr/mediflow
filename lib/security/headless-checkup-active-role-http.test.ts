/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { HeadlessCheckupActiveRoleEnrollmentError } from './headless-checkup-active-role-enrollment.ts';
import { createHeadlessCheckupActiveRoleHttpHandlersV1 } from './headless-checkup-active-role-http.ts';

const ACTIVE = Object.freeze(Object.assign(Object.create(null), {
  schemaVersion: 'mediflow.headless-checkup-active-role-enrollment.v1',
  status: 'active', attestationVersion: 1,
}));
const REVOKED = Object.freeze(Object.assign(Object.create(null), {
  schemaVersion: 'mediflow.headless-checkup-active-role-revocation.v1',
  status: 'revoked', attestationVersion: 1, revocationGeneration: 1,
}));

function request(candidatePin: unknown = '2468'): Request {
  return new Request('http://127.0.0.1/api/system/intelligent-host/checkup-active-role', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1',
      'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ candidatePin }),
  });
}
function requestValue(value: unknown): Request {
  return { url: 'http://127.0.0.1/api/system/intelligent-host/checkup-active-role',
    headers: new Headers({ 'content-type': 'application/json', origin: 'http://127.0.0.1',
      'sec-fetch-site': 'same-origin' }), json: async () => value } as Request;
}
function fixture(options: Readonly<{ authorized?: unknown; enroll?: unknown; revoke?: unknown;
  retire?: unknown }> = {}) {
  let authReads = 0, enrollCalls = 0, revokeCalls = 0, retireCalls = 0;
  const handlers = createHeadlessCheckupActiveRoleHttpHandlersV1({
    readAuthorizedAdmin: async () => { authReads += 1; return options.authorized ?? true; },
    enroll: async () => { enrollCalls += 1;
      if (options.enroll instanceof Error) throw options.enroll; return options.enroll ?? ACTIVE; },
    revoke: async () => { revokeCalls += 1;
      if (options.revoke instanceof Error) throw options.revoke; return options.revoke ?? REVOKED; },
    retireOperation: () => { retireCalls += 1;
      if (options.retire instanceof Error) throw options.retire; return options.retire ?? true; },
  });
  return Object.freeze({ handlers, counts: () => ({ authReads, enrollCalls, revokeCalls, retireCalls }) });
}
async function failure(response: Response, status: number, code: string): Promise<void> {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { error: 'Ruolo checkup non disponibile.', code });
}

test('authenticates before observing the request and returns only safe setup projections', async () => {
  let observations = 0;
  const hostile = new Proxy({}, { get() { observations += 1; throw new Error('sensitive'); } }) as Request;
  const denied = fixture({ authorized: false });
  await failure(await denied.handlers.POST(hostile), 401, 'session_unavailable');
  await failure(await denied.handlers.DELETE(hostile), 401, 'session_unavailable');
  assert.deepEqual(denied.counts(), { authReads: 2, enrollCalls: 0, revokeCalls: 0, retireCalls: 0 });
  assert.equal(observations, 0);

  const current = fixture({ retire: false });
  const enrolled = await current.handlers.POST(request());
  assert.equal(enrolled.status, 201); assert.equal(enrolled.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await enrolled.json(), { schemaVersion: ACTIVE.schemaVersion,
    status: 'active', attestationVersion: 1 });
  const revoked = await current.handlers.DELETE(request());
  assert.equal(revoked.status, 200); assert.equal(revoked.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await revoked.json(), { schemaVersion: REVOKED.schemaVersion,
    status: 'revoked', attestationVersion: 1, revocationGeneration: 1 });
  assert.deepEqual(current.counts(), { authReads: 2, enrollCalls: 1, revokeCalls: 1, retireCalls: 1 });
});

test('rejects non-exact input, accessor output, and an unbounded cleanup result', async () => {
  const current = fixture();
  const accessor = Object.create(null);
  Object.defineProperty(accessor, 'schemaVersion', { enumerable: true, get() { return ACTIVE.schemaVersion; } });
  for (const malformed of [
    { candidatePin: '2468', extra: true }, {}, Object.assign(Object.create({ inherited: true }), { candidatePin: '2468' }),
  ]) await failure(await current.handlers.POST(requestValue(malformed)), 400, 'invalid_input');
  const badOutput = fixture({ enroll: accessor });
  await failure(await badOutput.handlers.POST(request()), 503, 'storage_unavailable');
  const badCleanup = fixture({ retire: Promise.resolve(true) });
  await failure(await badCleanup.handlers.DELETE(request()), 503, 'storage_unavailable');
  assert.equal(badCleanup.counts().retireCalls, 1);
});

test('rejects cross-port and text/plain mutation transport before enrollment', async () => {
  const current = fixture();
  for (const headers of [
    { origin: 'http://127.0.0.1:4000', 'sec-fetch-site': 'same-site', 'content-type': 'application/json' },
    { origin: 'http://127.0.0.1', 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain' },
  ]) {
    const denied = new Request('http://127.0.0.1/api/system/intelligent-host/checkup-active-role', {
      method: 'POST', headers, body: JSON.stringify({ candidatePin: '2468' }),
    });
    await failure(await current.handlers.POST(denied), 403, 'request_transport_invalid');
  }
  assert.deepEqual(current.counts(), { authReads: 2, enrollCalls: 0, revokeCalls: 0, retireCalls: 0 });
});

test('maps controlled enrollment failures without echoing sensitive errors', async () => {
  for (const [code, status] of [['enrollment_denied', 403], ['enrollment_conflict', 409],
    ['storage_unavailable', 503]] as const) {
    const current = fixture({ enroll: new HeadlessCheckupActiveRoleEnrollmentError(code) });
    await failure(await current.handlers.POST(request()), status, code);
  }
  const unexpected = fixture({ revoke: new Error('synthetic-sensitive-detail') });
  const response = await unexpected.handlers.DELETE(request());
  assert.equal(response.status, 503); assert.equal((await response.text()).includes('synthetic-sensitive-detail'), false);
});

test('route remains an auth-first dynamic Node adapter without grant or database output', () => {
  const route = readFileSync(new URL(
    '../../app/api/system/intelligent-host/checkup-active-role/route.ts', import.meta.url,
  ), 'utf8');
  assert.match(route, /runtime\s*=\s*'nodejs'/u); assert.match(route, /dynamic\s*=\s*'force-dynamic'/u);
  assert.match(route, /readAuthenticatedWebSession/u); assert.match(route, /isWebAdminSession/u);
  assert.match(route, /disposeCheckupStatusTransitionForHostV1/u);
  assert.doesNotMatch(route, /\bdb\b|database|grant|attestationRef|sessionRef|actorRef|console\./iu);
});
