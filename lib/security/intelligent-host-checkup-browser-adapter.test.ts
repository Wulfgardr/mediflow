/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { IntelligentHostCheckupBrowserAdapterError,
  createIntelligentHostCheckupBrowserAdapter } from './intelligent-host-checkup-browser-adapter.ts';

const PATIENT = 'patient.synthetic.checkup-browser.01', AMBULATORY = 'ambulatory.synthetic.checkup-browser.01';
const CHECKUP_A = 'checkup.synthetic.browser.a';
const CHECKUP_B = 'checkup.synthetic.browser.b', CHECKUP_REF_A = `hcsr_${'a'.repeat(64)}`;
const CHECKUP_REF_B = `hcsr_${'b'.repeat(64)}`, PROPOSAL_REF = `hcsp_${'c'.repeat(64)}`;
const BINDING_A = `hcub_${'d'.repeat(64)}`, BINDING_B = `hcub_${'e'.repeat(64)}`;
const HASH = `sha256:${'f'.repeat(64)}`, OPERATION = 'mediflow.patient.checkup.status.transition.v1';
const TITLE_A = 'Controllo sintetico A', TITLE_B = 'Controllo sintetico B';
const LEASE = Object.freeze({ sessionRef: `ssr_${'1'.repeat(32)}`, selectionEpoch: 1,
  patientRef: `ptr_${'2'.repeat(32)}`, ambulatoryRef: `abr_${'3'.repeat(32)}`,
  leaseRef: `lsr_${'4'.repeat(32)}`, expiresAt: 1_900_000_000_000 });
function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function selected(checkup = CHECKUP_A) {
  return checkup === CHECKUP_A
    ? { checkupRef: CHECKUP_REF_A, uiBindingRef: BINDING_A, resourceTitle: TITLE_A, resourceRevision: 4 }
    : { checkupRef: CHECKUP_REF_B, uiBindingRef: BINDING_B, resourceTitle: TITLE_B, resourceRevision: 8 };
}
function proposal(title = TITLE_A, revision = 4) {
  return { schemaVersion: 'mediflow.patient.checkup.status.transition.proposal-view.v1',
    proposalRef: PROPOSAL_REF, targetStatus: 'completed', expectedRevision: revision,
    expiresAt: 1_900_000_000_000, resourceTitle: title, resourceRevision: revision };
}
function receipt(revision = 4) {
  return { schemaVersion: 'mediflow.patient.checkup.status.transition.receipt.v1', operationId: OPERATION,
    capabilityId: OPERATION, outcome: 'status_transitioned', denialCode: null, fromStatus: 'pending',
    toStatus: 'completed', previousRevision: revision, newRevision: revision + 1, ownerRefHash: HASH,
    resourceRefHash: HASH, proofRefHash: HASH, receiptRefHash: HASH, generation: 2,
    revocationGeneration: 0, selectionEpoch: 7, timestamp: 1_800_000_000_000 };
}
function rejects(code: IntelligentHostCheckupBrowserAdapterError['code']) {
  return (error: unknown) => error instanceof IntelligentHostCheckupBrowserAdapterError && error.code === code;
}
function deferred<T>() {
  let resolve!: (value: T) => void; const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

test('activates H1a before select and carries one opaque UI binding through read, confirm, replay, and revoke', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = createIntelligentHostCheckupBrowserAdapter({ fetch: async (input, init = {}) => {
    const url = String(input); calls.push({ url, init });
    if (url === '/api/system/intelligent-host/checkup-active-role') {
      return response(init.method === 'POST'
        ? { schemaVersion: 'mediflow.headless-checkup-active-role-enrollment.v1', status: 'active', attestationVersion: 1 }
        : { schemaVersion: 'mediflow.headless-checkup-active-role-revocation.v1', status: 'revoked',
          attestationVersion: 1, revocationGeneration: 1 });
    }
    if (url === '/api/ai/smart-import/selection') return response(init.method === 'GET'
      ? { selectionEpoch: 0 } : { selection: LEASE });
    if (url.endsWith('/intelligent-host/activate')) return response({ state: 'active', expiresAt: 1_900_000_000_000 });
    if (url.endsWith('/checkup-status') && init.method === 'POST') return response(selected());
    if (url.endsWith(`/proposals/${PROPOSAL_REF}`) && init.method === 'GET') return response(proposal());
    if (url.endsWith(`/proposals/${PROPOSAL_REF}`) && init.method === 'POST') return response(receipt());
    if (url.endsWith('/checkup-status') && init.method === 'DELETE') return response({ state: 'revoked' });
    return response({}, 500);
  } });

  await client.enroll('2468');
  const selection = await client.select(PATIENT, AMBULATORY, CHECKUP_A);
  assert.deepEqual(selection, { checkupRef: CHECKUP_REF_A, resourceTitle: TITLE_A, resourceRevision: 4 });
  assert.equal('uiBindingRef' in selection, false);
  const current = await client.read(PATIENT, PROPOSAL_REF);
  const first = await client.confirm(PATIENT, current, '2468');
  const replay = await client.confirm(PATIENT, current, '2468');
  assert.deepEqual(first, replay); assert.deepEqual(first, { outcome: 'status_transitioned',
    toStatus: 'completed', previousRevision: 4, newRevision: 5, receiptRefHash: HASH });
  assert.equal(await client.revokeOperation(PATIENT), 'revoked');

  assert.deepEqual(calls.map(({ url, init }) => `${init.method}:${url}`), [
    'POST:/api/system/intelligent-host/checkup-active-role',
    'GET:/api/ai/smart-import/selection',
    'POST:/api/ai/smart-import/selection',
    `POST:/api/patients/${PATIENT}/intelligent-host/activate`,
    `POST:/api/patients/${PATIENT}/intelligent-host/checkup-status`,
    `GET:/api/patients/${PATIENT}/intelligent-host/checkup-status/proposals/${PROPOSAL_REF}`,
    `POST:/api/patients/${PATIENT}/intelligent-host/checkup-status/proposals/${PROPOSAL_REF}`,
    `POST:/api/patients/${PATIENT}/intelligent-host/checkup-status/proposals/${PROPOSAL_REF}`,
    `DELETE:/api/patients/${PATIENT}/intelligent-host/checkup-status`,
  ]);
  assert.deepEqual(JSON.parse(calls[2]!.init.body as string), { expectedEpoch: 0,
    patientId: PATIENT, ambulatoryId: AMBULATORY });
  assert.deepEqual(JSON.parse(calls[3]!.init.body as string), { selectionEpoch: 1 });
  assert.deepEqual(JSON.parse(calls[4]!.init.body as string), { checkupId: CHECKUP_A });
  assert.equal((calls[5]!.init.headers as Record<string, string>)['x-mediflow-checkup-ui-binding'], BINDING_A);
  for (const index of [6, 7]) assert.deepEqual(JSON.parse(calls[index]!.init.body as string), {
    targetStatus: 'completed', expectedRevision: 4, candidatePin: '2468', uiBindingRef: BINDING_A,
  });
});

test('revokes A before selecting B and rejects the retained A proposal without another request', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = []; let selectedCount = 0;
  const client = createIntelligentHostCheckupBrowserAdapter({ fetch: async (input, init = {}) => {
    const url = String(input); calls.push({ url, init });
    if (url === '/api/ai/smart-import/selection') return response(init.method === 'GET'
      ? { selectionEpoch: 0 } : { selection: LEASE });
    if (url.endsWith('/activate')) return response({ state: 'active', expiresAt: 1_900_000_000_000 });
    if (url.endsWith('/checkup-status') && init.method === 'POST') {
      selectedCount += 1; return response(selected(selectedCount === 1 ? CHECKUP_A : CHECKUP_B));
    }
    if (url.endsWith(`/proposals/${PROPOSAL_REF}`) && init.method === 'GET') return response(proposal());
    if (url.endsWith('/checkup-status') && init.method === 'DELETE') return response({ state: 'revoked' });
    return response(receipt());
  } });
  await client.select(PATIENT, AMBULATORY, CHECKUP_A);
  const oldProposal = await client.read(PATIENT, PROPOSAL_REF);
  await client.revokeOperation(PATIENT); await client.select(PATIENT, AMBULATORY, CHECKUP_B);
  const before = calls.length;
  await assert.rejects(() => client.confirm(PATIENT, oldProposal, '2468'), rejects('conflict'));
  assert.equal(calls.length, before);
  assert.deepEqual(calls.filter(({ url }) => url.endsWith('/checkup-status')).map(({ init }) => init.method),
    ['POST', 'DELETE', 'POST']);
});

test('requires the exact proposal object issued by reread and validates every receipt field', async () => {
  let calls = 0;
  const client = createIntelligentHostCheckupBrowserAdapter({ fetch: async (input, init = {}) => {
    calls += 1; const url = String(input);
    if (url === '/api/ai/smart-import/selection') return response(init.method === 'GET'
      ? { selectionEpoch: 0 } : { selection: LEASE });
    if (url.endsWith('/activate')) return response({ state: 'active', expiresAt: 1_900_000_000_000 });
    if (url.endsWith('/checkup-status')) return response(selected());
    if (init.method === 'GET') return response(proposal());
    return response(receipt());
  } });
  await client.select(PATIENT, AMBULATORY, CHECKUP_A);
  const current = await client.read(PATIENT, PROPOSAL_REF);
  const before = calls;
  await assert.rejects(() => client.confirm(PATIENT, { ...current }, '2468'), rejects('conflict'));
  assert.equal(calls, before);

  for (const mutation of [{ ownerRefHash: 'bad' }, { operationId: 'other' }, { generation: 0 },
    { selectionEpoch: -1 }, { newRevision: 99 }]) {
    const malformed = createIntelligentHostCheckupBrowserAdapter({ fetch: async (input, init = {}) => {
      const url = String(input);
      if (url === '/api/ai/smart-import/selection') return response(init.method === 'GET'
        ? { selectionEpoch: 0 } : { selection: LEASE });
      if (url.endsWith('/activate')) return response({ state: 'active', expiresAt: 1_900_000_000_000 });
      if (url.endsWith('/checkup-status')) return response(selected());
      if (init.method === 'GET') return response(proposal());
      return response({ ...receipt(), ...mutation });
    } });
    await malformed.select(PATIENT, AMBULATORY, CHECKUP_A);
    const candidate = await malformed.read(PATIENT, PROPOSAL_REF);
    await assert.rejects(() => malformed.confirm(PATIENT, candidate, '2468'), rejects('response_invalid'));
  }
});

test('fails closed on a missing current epoch and fences a delayed activation after reset', async () => {
  const missing = createIntelligentHostCheckupBrowserAdapter({ fetch: async (_input, init = {}) =>
    response(init.method === 'GET' ? { selectionEpoch: 0 } : { selectionEpoch: 0 }) });
  await assert.rejects(() => missing.select(PATIENT, AMBULATORY, CHECKUP_A), rejects('response_invalid'));

  const pending = deferred<Response>(); let calls = 0;
  const stale = createIntelligentHostCheckupBrowserAdapter({ fetch: async (_input, init = {}) => {
    calls += 1;
    if (init.method === 'GET') return response({ selectionEpoch: 0 });
    if (calls === 2) return response({ selection: LEASE });
    return pending.promise;
  } });
  const selection = stale.select(PATIENT, AMBULATORY, CHECKUP_A);
  await new Promise((resolve) => setImmediate(resolve));
  stale.reset(); pending.resolve(response({ state: 'active', expiresAt: 1_900_000_000_000 }));
  await assert.rejects(() => selection, rejects('operation_superseded'));
});
