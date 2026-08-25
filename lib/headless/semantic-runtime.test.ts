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
function trapProxy<T extends object>(value: T, throwing = false): { value: T; traps: () => number } {
  let count = 0; const trap = <R>(fallback: () => R): R => { count += 1; if (throwing) throw new Error('proxy trap must not run'); return fallback(); };
  return { value: new Proxy(value, { getPrototypeOf(target) { return trap(() => Reflect.getPrototypeOf(target)); }, ownKeys(target) { return trap(() => Reflect.ownKeys(target)); }, getOwnPropertyDescriptor(target, property) { return trap(() => Reflect.getOwnPropertyDescriptor(target, property)); }, get(target, property, receiver) { return trap(() => Reflect.get(target, property, receiver)); } }), traps: () => count };
}
function nonEnumerable<T extends object, K extends keyof T>(value: T, key: K): T { Object.defineProperty(value, key, { ...Object.getOwnPropertyDescriptor(value, key)!, enumerable: false }); return value; }
type ArrayFault = 'sparse' | 'symbol' | 'extra' | 'non-enumerable' | 'accessor' | 'prototype' | 'iterator' | 'map';
function malformedArray<T>(item: T, fault: ArrayFault): { value: T[]; reads: () => number } {
  const value = [item]; let reads = 0;
  if (fault === 'sparse') value.length = 2; if (fault === 'symbol') Object.defineProperty(value, Symbol('extra'), { value: true }); if (fault === 'extra') Object.defineProperty(value, 'extra', { value: true });
  if (fault === 'non-enumerable') Object.defineProperty(value, '0', { value: item, enumerable: false }); if (fault === 'accessor') Object.defineProperty(value, '0', { enumerable: true, get() { reads += 1; return item; } });
  if (fault === 'prototype') Object.setPrototypeOf(value, Object.create(Array.prototype)); if (fault === 'iterator') Object.defineProperty(value, Symbol.iterator, { value() { reads += 1; return Array.prototype[Symbol.iterator].call(this); } }); if (fault === 'map') Object.defineProperty(value, 'map', { value(...args: Parameters<Array<unknown>['map']>) { reads += 1; return Array.prototype.map.apply(this, args); } });
  return { value, reads: () => reads };
}
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

test('rejects proxy and non-enumerable boundaries before reflection or host execution', async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  try {
    for (const throwing of [false, true]) {
      let calls = 0;
      const runtime = createSemanticRuntime([operation(() => { calls += 1; return { outcome: 'read', resultRef: 'synthetic:result' }; })]);
      const rawPlan = trapProxy(plan(), throwing);
      assert.equal(runtime.execute(rawPlan.value, session()).receipts[0].denialCode, 'invalid_plan');
      assert.equal(rawPlan.traps(), 0); assert.equal(calls, 0);

      const rawSession = trapProxy(session(), throwing);
      assert.equal(runtime.execute(plan({ requestRef: `session-${throwing}` }), rawSession.value).receipts[0].denialCode, 'invalid_session');
      assert.equal(rawSession.traps(), 0); assert.equal(calls, 0);

      const rawRegistry = trapProxy([operation()], throwing);
      const registryRuntime = createSemanticRuntime(rawRegistry.value);
      assert.equal(registryRuntime.execute(plan({ requestRef: `registry-${throwing}` }), session()).receipts[0].denialCode, 'registry_invalid');
      assert.equal(rawRegistry.traps(), 0);

      const rawInput = trapProxy({ query: 'synthetic' }, throwing);
      assert.equal(runtime.execute(plan({ requestRef: `input-${throwing}`, actions: [{ ...plan().actions[0], idempotencyKey: `input-${throwing}`, input: rawInput.value }] }), session()).receipts[0].denialCode, 'invalid_plan');
      assert.equal(rawInput.traps(), 0); assert.equal(calls, 0);

      const rawResult = trapProxy({ outcome: 'read', resultRef: 'synthetic:result' }, throwing);
      const resultRuntime = createSemanticRuntime([operation(() => rawResult.value as never)]);
      assert.equal(resultRuntime.execute(plan({ requestRef: `result-${throwing}`, actions: [{ ...plan().actions[0], idempotencyKey: `result-${throwing}` }] }), session()).receipts[0].denialCode, 'host_result_invalid');
      assert.equal(rawResult.traps(), 0);
    }

    const runtime = createSemanticRuntime([operation()]);
    assert.equal(runtime.execute(nonEnumerable(plan(), 'requestRef'), session()).receipts[0].denialCode, 'invalid_plan');
    assert.equal(runtime.execute(plan({ requestRef: 'non-enumerable-session' }), nonEnumerable(session(), 'sessionRef')).receipts[0].denialCode, 'invalid_session');
    assert.equal(createSemanticRuntime([nonEnumerable(operation(), 'operationId')]).execute(plan({ requestRef: 'non-enumerable-registry' }), session()).receipts[0].denialCode, 'registry_invalid');
    assert.equal(runtime.execute(plan({ requestRef: 'non-enumerable-input', actions: [{ ...plan().actions[0], idempotencyKey: 'non-enumerable-input', input: nonEnumerable({ query: 'synthetic' }, 'query') }] }), session()).receipts[0].denialCode, 'invalid_plan');
    const resultRuntime = createSemanticRuntime([operation(() => nonEnumerable({ outcome: 'read', resultRef: 'synthetic:result' }, 'resultRef'))]);
    assert.equal(resultRuntime.execute(plan({ requestRef: 'non-enumerable-result', actions: [{ ...plan().actions[0], idempotencyKey: 'non-enumerable-result' }] }), session()).receipts[0].denialCode, 'host_result_invalid');

    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally { process.off('unhandledRejection', onUnhandled); }
});

test('denies malformed and over-depth arrays without getters, iterators, maps, proxy traps, or host calls', () => {
  const faults: readonly ArrayFault[] = ['sparse', 'symbol', 'extra', 'non-enumerable', 'accessor', 'prototype', 'iterator', 'map'];
  for (const fault of faults) {
    let calls = 0; const runtime = createSemanticRuntime([operation(() => { calls += 1; return { outcome: 'read', resultRef: 'synthetic:result' }; })]); const action = plan().actions[0]!;
    const actions = malformedArray(action, fault); assert.equal(runtime.execute(plan({ actions: actions.value }), session()).receipts[0].denialCode, 'invalid_plan'); assert.equal(actions.reads(), 0); assert.equal(calls, 0);
    const capabilities = malformedArray('capability.synthetic.read.v1', fault); assert.equal(runtime.execute(plan({ requestRef: `capabilities-${fault}` }), session({ authorizedCapabilityIds: capabilities.value })).receipts[0].denialCode, 'invalid_session'); assert.equal(capabilities.reads(), 0); assert.equal(calls, 0);
    const nested = malformedArray('synthetic', fault); assert.equal(runtime.execute(plan({ requestRef: `input-${fault}`, actions: [{ ...action, idempotencyKey: `input-${fault}`, input: { nested: nested.value } }] }), session()).receipts[0].denialCode, 'invalid_plan'); assert.equal(nested.reads(), 0); assert.equal(calls, 0);
    const registry = malformedArray(operation(), fault); assert.equal(createSemanticRuntime(registry.value).execute(plan({ requestRef: `registry-${fault}` }), session()).receipts[0].denialCode, 'registry_invalid'); assert.equal(registry.reads(), 0);
    const result = malformedArray('synthetic:result', fault); const resultRuntime = createSemanticRuntime([operation(() => { calls += 1; return { outcome: 'read', resultRef: result.value as never }; })]); assert.equal(resultRuntime.execute(plan({ requestRef: `result-${fault}`, actions: [{ ...action, idempotencyKey: `result-${fault}` }] }), session()).receipts[0].denialCode, 'host_result_invalid'); assert.equal(result.reads(), 0);
  }
  const deep = (leaf: unknown) => { let value = leaf; for (let index = 0; index < 9; index += 1) value = { nested: value }; return value; };
  for (const throwing of [false, true]) {
    let calls = 0; const nested = trapProxy({ synthetic: true }, throwing); const runtime = createSemanticRuntime([operation(() => { calls += 1; return { outcome: 'read', resultRef: 'synthetic:result' }; })]);
    assert.equal(runtime.execute(plan({ requestRef: `deep-${throwing}`, actions: [{ ...plan().actions[0], idempotencyKey: `deep-${throwing}`, input: { deep: deep(nested.value) } }] }), session()).receipts[0].denialCode, 'invalid_plan'); assert.equal(nested.traps(), 0); assert.equal(calls, 0);
  }
  let ordinaryCalls = 0; const ordinary = createSemanticRuntime([operation(() => { ordinaryCalls += 1; return { outcome: 'read', resultRef: 'synthetic:result' }; })]);
  assert.equal(ordinary.execute(plan({ requestRef: 'deep-ordinary', actions: [{ ...plan().actions[0], idempotencyKey: 'deep-ordinary', input: { deep: deep('synthetic') } }] }), session()).receipts[0].denialCode, 'invalid_plan'); assert.equal(ordinaryCalls, 0);
});
