/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { HeadlessCheckupStatusTransitionV1Error } from '../../packages/aip/src/checkup-status-transition.ts';
import { createHeadlessCheckupStatusTransitionWebHttpHandlersV1 } from
  './headless-checkup-status-transition-web-http.ts';

const PATIENT = 'patient.synthetic.checkup-http.01', CHECKUP = 'checkup.synthetic.http.01';
const CHECKUP_REF = `hcsr_${'a'.repeat(64)}`, PROPOSAL_REF = `hcsp_${'b'.repeat(64)}`;
const UI_BINDING = `hcub_${'c'.repeat(64)}`, HASH = `sha256:${'d'.repeat(64)}`;
const TITLE = 'Controllo sintetico annuale';
const OPERATION = 'mediflow.patient.checkup.status.transition.v1';
const SELECTED = Object.freeze(Object.assign(Object.create(null), { checkupRef: CHECKUP_REF,
  uiBindingRef: UI_BINDING, resourceTitle: TITLE, resourceRevision: 4 }));
const PROPOSAL = Object.freeze(Object.assign(Object.create(null), {
  schemaVersion: 'mediflow.patient.checkup.status.transition.proposal-view.v1', proposalRef: PROPOSAL_REF,
  targetStatus: 'completed', expectedRevision: 4, expiresAt: 1_900_000_000_000,
  resourceTitle: TITLE, resourceRevision: 4,
}));
const RECEIPT = Object.freeze(Object.assign(Object.create(null), {
  schemaVersion: 'mediflow.patient.checkup.status.transition.receipt.v1', operationId: OPERATION,
  capabilityId: OPERATION, outcome: 'status_transitioned', denialCode: null, fromStatus: 'pending',
  toStatus: 'completed', previousRevision: 4, newRevision: 5, ownerRefHash: HASH,
  resourceRefHash: HASH, proofRefHash: HASH, receiptRefHash: HASH, generation: 2,
  revocationGeneration: 0, selectionEpoch: 7, timestamp: 1_800_000_000_000,
}));
type Kind = 'select' | 'read' | 'confirm' | 'revoke';
function context(proposal = false) {
  return Object.freeze({ params: Promise.resolve(Object.freeze({ id: PATIENT,
    ...(proposal ? { proposalRef: PROPOSAL_REF } : {}) })) });
}
function request(method: 'POST' | 'GET' | 'DELETE', body?: unknown, binding = UI_BINDING): Request {
  return new Request(`http://127.0.0.1/api/patients/${PATIENT}/intelligent-host/checkup-status`, {
    method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(binding ? { 'x-mediflow-checkup-ui-binding': binding } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function fixture(options: Readonly<{ authenticated?: unknown; result?: Partial<Record<Kind, unknown>> }> = {}) {
  let authReads = 0; const received: Array<readonly [Kind, unknown]> = [];
  const invoke = async (kind: Kind, input: unknown) => {
    received.push([kind, input]); const value = options.result?.[kind];
    if (value instanceof Error) throw value;
    return value ?? ({ select: SELECTED, read: PROPOSAL, confirm: RECEIPT, revoke: true } as const)[kind];
  };
  return Object.freeze({ received, handlers: createHeadlessCheckupStatusTransitionWebHttpHandlersV1({
    readAuthenticated: async () => { authReads += 1; return options.authenticated ?? true; },
    select: (input) => invoke('select', input), read: (input) => invoke('read', input),
    confirm: (input) => invoke('confirm', input), revoke: (input) => invoke('revoke', input),
  }), authReads: () => authReads });
}
async function failure(response: Response, status: number, code: string): Promise<void> {
  assert.equal(response.status, status); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { error: 'Transizione checkup non disponibile.', code });
}

test('authenticates before observing request or route state on every operation', async () => {
  let observations = 0;
  const hostile = new Proxy({}, { get() { observations += 1; throw new Error('sensitive'); } });
  const current = fixture({ authenticated: false });
  await failure(await current.handlers.select(hostile as Request, hostile as never), 401, 'session_unavailable');
  await failure(await current.handlers.read(hostile as Request, hostile as never), 401, 'session_unavailable');
  await failure(await current.handlers.confirm(hostile as Request, hostile as never), 401, 'session_unavailable');
  await failure(await current.handlers.revoke(hostile as Request, hostile as never), 401, 'session_unavailable');
  assert.equal(current.authReads(), 4); assert.equal(current.received.length, 0); assert.equal(observations, 0);
});

test('binds select, UI reread, confirm, and revoke to exact patient and opaque UI binding', async () => {
  const current = fixture();
  const selected = await current.handlers.select(request('POST', { checkupId: CHECKUP }), context());
  assert.deepEqual(await selected.json(), { checkupRef: CHECKUP_REF, uiBindingRef: UI_BINDING,
    resourceTitle: TITLE, resourceRevision: 4 });
  const read = await current.handlers.read(request('GET'), context(true));
  assert.deepEqual(await read.json(), { ...PROPOSAL });
  const confirmed = await current.handlers.confirm(request('POST', { targetStatus: 'completed',
    expectedRevision: 4, candidatePin: '2468', uiBindingRef: UI_BINDING }), context(true));
  assert.deepEqual(await confirmed.json(), { ...RECEIPT });
  assert.deepEqual(await (await current.handlers.revoke(request('DELETE'), context())).json(), { state: 'revoked' });
  assert.deepEqual(current.received, [
    ['select', { expectedPatientId: PATIENT, checkupId: CHECKUP }],
    ['read', { expectedPatientId: PATIENT, proposalRef: PROPOSAL_REF, uiBindingRef: UI_BINDING }],
    ['confirm', { expectedPatientId: PATIENT, proposalRef: PROPOSAL_REF, targetStatus: 'completed',
      expectedRevision: 4, candidatePin: '2468', uiBindingRef: UI_BINDING }],
    ['revoke', PATIENT],
  ]);
  for (const response of [selected, read, confirmed]) assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('rejects malformed bodies, route params, and missing or wrong-shaped UI bindings before sources', async () => {
  const current = fixture();
  await failure(await current.handlers.select(request('POST', { checkupId: CHECKUP, extra: true }), context()),
    400, 'invalid_input');
  await failure(await current.handlers.select(request('POST', { checkupId: '../checkup' }), context()),
    400, 'invalid_input');
  await failure(await current.handlers.read(request('GET', undefined, ''), context(true)), 400, 'invalid_input');
  for (const body of [{ targetStatus: 'completed', expectedRevision: 4, candidatePin: '2468' },
    { targetStatus: 'other', expectedRevision: 4, candidatePin: '2468', uiBindingRef: UI_BINDING },
    { targetStatus: 'completed', expectedRevision: 0, candidatePin: '2468', uiBindingRef: UI_BINDING },
    { targetStatus: 'completed', expectedRevision: 4, candidatePin: '2', uiBindingRef: UI_BINDING }]) {
    await failure(await current.handlers.confirm(request('POST', body), context(true)), 400, 'invalid_input');
  }
  await failure(await current.handlers.revoke(request('DELETE'), Object.freeze({ params: Promise.resolve({ id: '../x' }) })),
    400, 'invalid_input');
  assert.equal(current.received.length, 0);
});

test('sanitizes malformed resource projections and receipts without leaking their content', async () => {
  const malformed = [
    { kind: 'select' as const, value: { ...SELECTED, resourceTitle: 'x'.repeat(513) },
      call: (subject: ReturnType<typeof fixture>) => subject.handlers.select(request('POST', { checkupId: CHECKUP }), context()) },
    { kind: 'read' as const, value: { ...PROPOSAL, resourceRevision: 5 },
      call: (subject: ReturnType<typeof fixture>) => subject.handlers.read(request('GET'), context(true)) },
    { kind: 'confirm' as const, value: { ...RECEIPT, ownerRefHash: 'sensitive-owner' },
      call: (subject: ReturnType<typeof fixture>) => subject.handlers.confirm(request('POST', {
        targetStatus: 'completed', expectedRevision: 4, candidatePin: '2468', uiBindingRef: UI_BINDING,
      }), context(true)) },
  ];
  for (const candidate of malformed) {
    const current = fixture({ result: { [candidate.kind]: candidate.value } });
    const response = await candidate.call(current); const text = await response.text();
    assert.equal(response.status, 503); assert.equal(text.includes('sensitive-owner'), false);
    assert.equal(text.includes('x'.repeat(100)), false);
  }
});

test('maps controlled protocol errors to stable HTTP outcomes', async () => {
  const expected = new Map<string, number>([['invalid_input', 400], ['session_unavailable', 401],
    ['role_unavailable', 403], ['resource_unavailable', 404], ['preview_expired', 410],
    ['scope_changed', 409], ['idempotency_conflict', 409], ['operation_unavailable', 503],
    ['audit_unavailable', 503]]);
  for (const [code, status] of expected) {
    const current = fixture({ result: { select: new HeadlessCheckupStatusTransitionV1Error(code as never) } });
    await failure(await current.handlers.select(request('POST', { checkupId: CHECKUP }), context()), status, code);
  }
});

test('routes remain thin dynamic Node adapters with preview absent from HTTP', () => {
  const base = readFileSync(new URL(
    '../../app/api/patients/[id]/intelligent-host/checkup-status/route.ts', import.meta.url,
  ), 'utf8');
  const proposalRoute = readFileSync(new URL(
    '../../app/api/patients/[id]/intelligent-host/checkup-status/proposals/[proposalRef]/route.ts', import.meta.url,
  ), 'utf8');
  for (const source of [base, proposalRoute]) {
    assert.match(source, /runtime\s*=\s*'nodejs'/u); assert.match(source, /dynamic\s*=\s*'force-dynamic'/u);
    assert.match(source, /readAuthenticatedWebSession/u);
    assert.doesNotMatch(source, /\bdb\b|database|candidatePin\s*=|handlePreview|process\.send|console\./iu);
  }
  assert.match(base, /export const POST = handlers\.select/u); assert.match(base, /export const DELETE = handlers\.revoke/u);
  assert.match(proposalRoute, /export const GET = handlers\.read/u);
  assert.match(proposalRoute, /export const POST = handlers\.confirm/u);
});
