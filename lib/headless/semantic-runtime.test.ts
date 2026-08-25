import assert from 'node:assert/strict';
import test from 'node:test';

import { createSemanticRuntime } from './semantic-runtime';

/* @Codex */
const operation = (execute = () => ({ outcome: 'read' as const, resultRef: 'synthetic:record:1' })) => ({
  operationId: 'headless.synthetic.read.v1',
  capabilityId: 'capability.synthetic.read.v1',
  applicationServiceRef: 'SyntheticReadApplicationService',
  maximumStage: 'read' as const,
  authorityPolicy: 'read_only' as const,
  execute,
});

const session = (overrides: Record<string, unknown> = {}) => ({
  sessionRef: 'synthetic-session-1', active: true, activeRole: 'clinician', leaseEpoch: 7,
  revoked: false, authorizedCapabilityIds: ['capability.synthetic.read.v1'], ...overrides,
});

const plan = (overrides: Record<string, unknown> = {}) => ({
  requestRef: 'synthetic-request-1', actions: [{
    actionRef: 'synthetic-action-1', operationId: 'headless.synthetic.read.v1',
    capabilityId: 'capability.synthetic.read.v1', applicationServiceRef: 'SyntheticReadApplicationService',
    stage: 'read', idempotencyKey: 'synthetic-idempotency-1', input: { query: 'synthetic' },
  }], ...overrides,
});

test('executes only a closed, explicitly bound synthetic operation and returns a PHI-safe frozen receipt', () => {
  let calls = 0;
  const runtime = createSemanticRuntime([operation(() => { calls += 1; return { outcome: 'read', resultRef: 'synthetic:record:1' }; })], { maxOperations: 1 });
  const receipt = runtime.execute(plan(), session()).receipts[0];
  assert.equal(calls, 1); assert.equal(receipt.outcome, 'read'); assert.equal(receipt.applyPolicy, 'none'); assert.equal(receipt.writesPerformed, 0);
  assert.equal(Object.getPrototypeOf(receipt), null); assert.equal(Object.isFrozen(receipt), true);
  assert.equal('prompt' in receipt, false); assert.equal('patientId' in receipt, false);
});

test('replays the same scoped digest, conflicts on a changed digest, and never re-enters the host closure', () => {
  let calls = 0; const holder: { runtime?: ReturnType<typeof createSemanticRuntime> } = {};
  const runtime = createSemanticRuntime([operation(() => { calls += 1; const nested = holder.runtime!.execute(plan({ requestRef: 'nested' }), session()); assert.equal(nested.receipts[0].denialCode, 'reentry'); return { outcome: 'read', resultRef: 'synthetic:record:1' }; })]); holder.runtime = runtime;
  const first = runtime.execute(plan(), session()).receipts[0];
  const replay = runtime.execute(plan(), session()).receipts[0];
  const conflict = runtime.execute(plan({ actions: [{ ...plan().actions[0], input: { query: 'changed' } }] }), session()).receipts[0];
  assert.equal(calls, 1); assert.equal(replay.policyDecision, 'replay'); assert.equal(replay.actionRef, first.actionRef); assert.equal(conflict.denialCode, 'idempotency_conflict');
});

test('denies session, authority, limit, forbidden execution fields, and hostile host values before or at the boundary', () => {
  const hostile = createSemanticRuntime([operation(() => ({ outcome: 'read', resultRef: 'x', then() { throw new Error('must not run'); } } as never))], { maxOperations: 1 });
  assert.equal(hostile.execute(plan(), session()).receipts[0].denialCode, 'host_result_invalid');
  const throwing = createSemanticRuntime([operation(() => { throw new Error('synthetic only'); })]);
  assert.equal(throwing.execute(plan({ actions: [{ ...plan().actions[0], idempotencyKey: 'throwing' }] }), session()).receipts[0].denialCode, 'host_threw');
  const runtime = createSemanticRuntime([operation()], { maxOperations: 1 });
  assert.equal(runtime.execute(plan(), session({ revoked: true })).receipts[0].denialCode, 'session_revoked');
  assert.equal(runtime.execute(plan(), session({ authorizedCapabilityIds: [] })).receipts[0].denialCode, 'operation_unauthorized');
  assert.equal(runtime.execute(plan({ actions: [plan().actions[0], { ...plan().actions[0], actionRef: 'two', idempotencyKey: 'two' }] }), session()).receipts[0].denialCode, 'operation_limit');
  assert.equal(runtime.execute(plan({ actions: [{ ...plan().actions[0], input: { prompt: 'blocked' } }] }), session()).receipts[0].denialCode, 'forbidden_input');
});

test('fails closed on accessors, proxies, promises, and an ambient then without executing or drifting', () => {
  let calls = 0; const originalThen = Promise.prototype.then as unknown as { call(receiver: object, ...args: unknown[]): unknown }; let ambientThenCalls = 0;
  (Promise.prototype as unknown as { then: (...args: unknown[]) => unknown }).then = function (this: Promise<unknown>, ...args) { ambientThenCalls += 1; return originalThen.call(this, ...args); };
  try {
    const runtime = createSemanticRuntime([operation(() => { calls += 1; return Promise.resolve({ outcome: 'read', resultRef: 'late' }) as never; })]);
    assert.equal(runtime.execute(plan(), session()).receipts[0].denialCode, 'host_result_invalid');
    const accessor = Object.defineProperty({ query: 'synthetic' }, 'later', { get() { throw new Error('no access'); }, enumerable: true });
    assert.equal(runtime.execute(plan({ actions: [{ ...plan().actions[0], input: accessor }] }), session()).receipts[0].denialCode, 'invalid_plan');
    const proxyRuntime = createSemanticRuntime([operation(() => new Proxy({ outcome: 'read', resultRef: 'x' }, { ownKeys() { throw new Error('no trap'); } }) as never)]);
    assert.equal(proxyRuntime.execute(plan({ actions: [{ ...plan().actions[0], idempotencyKey: 'proxy' }] }), session()).receipts[0].denialCode, 'host_result_invalid');
    assert.equal(calls, 1); assert.equal(ambientThenCalls, 0);
  } finally { (Promise.prototype as unknown as { then: unknown }).then = originalThen; }
});
