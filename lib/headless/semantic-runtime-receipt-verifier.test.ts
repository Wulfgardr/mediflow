import assert from 'node:assert/strict';
import test from 'node:test';
import { createSemanticRuntime } from './semantic-runtime';
import { verifySemanticRuntimeReceiptBatch } from './semantic-runtime-receipt-verifier';

/* @Codex */
const graph = () => ({ operations: [
  { operationId: 'op.synthetic.read', capabilityId: 'cap.synthetic.read', applicationServiceRef: 'SyntheticReadService', maximumStage: 'read', authorityPolicy: 'read_only' },
  { operationId: 'op.synthetic.preview', capabilityId: 'cap.synthetic.preview', applicationServiceRef: 'SyntheticPreviewService', maximumStage: 'preview', authorityPolicy: 'read_only' },
] });
const expected = () => [
  { requestRef: 'request.synthetic', actionRef: 'action.read', operationId: 'op.synthetic.read', capabilityId: 'cap.synthetic.read', applicationServiceRef: 'SyntheticReadService', stage: 'read', outcome: 'read', revisionBinding: 'lease:7', resultRef: 'result.read' },
  { requestRef: 'request.synthetic', actionRef: 'action.preview', operationId: 'op.synthetic.preview', capabilityId: 'cap.synthetic.preview', applicationServiceRef: 'SyntheticPreviewService', stage: 'preview', outcome: 'preview', revisionBinding: 'lease:7', resultRef: 'result.preview' },
];
const batch = () => ({ receipts: expected().map(({ stage: _stage, applicationServiceRef: _service, ...receipt }) => ({ schema: 'mediflow.headless.receipt.v1' as const, ...receipt, policyDecision: 'executed' as const, createdAt: 'runtime:1', applyPolicy: 'none' as const, writesPerformed: 0 as const })) });
const deny = (value: unknown): void => assert.throws(() => verifySemanticRuntimeReceiptBatch(graph(), expected(), value));
function proxy<T extends object>(value: T): { value: T; traps: () => number } {
  let count = 0; const hit = <R>(fallback: () => R): R => { count += 1; return fallback(); };
  return { value: new Proxy(value, { getPrototypeOf(target) { return hit(() => Reflect.getPrototypeOf(target)); }, ownKeys(target) { return hit(() => Reflect.ownKeys(target)); }, getOwnPropertyDescriptor(target, key) { return hit(() => Reflect.getOwnPropertyDescriptor(target, key)); }, get(target, key, receiver) { return hit(() => Reflect.get(target, key, receiver)); } }), traps: () => count };
}

test('returns a frozen null-prototype coverage receipt for an exact synthetic P3a batch', () => {
  const output = verifySemanticRuntimeReceiptBatch(graph(), expected(), batch());
  assert.equal(output.schema, 'mediflow.headless.semantic-coverage-receipt.v1');
  assert.equal(output.applyPolicy, 'none'); assert.equal(output.writesPerformed, 0);
  assert.equal(output.verifiedActions.length, 2); assert.equal(Object.getPrototypeOf(output), null);
  assert.equal(Object.isFrozen(output), true); assert.equal(Object.isFrozen(output.verifiedActions), true);
  assert.equal(Object.isFrozen(output.verifiedActions[0]!), true);
});

test('accepts only the successful P3a receipt batch produced by the closed synthetic runtime', () => {
  const runtime = createSemanticRuntime(graph().operations.map(operation => ({ ...operation, execute: () => ({ outcome: operation.maximumStage, resultRef: operation.operationId === 'op.synthetic.read' ? 'result.read' : 'result.preview' }) })));
  const produced = runtime.execute({ requestRef: 'request.synthetic', actions: expected().map((action, index) => ({ actionRef: action.actionRef, operationId: action.operationId, capabilityId: action.capabilityId, applicationServiceRef: action.applicationServiceRef, stage: action.stage, idempotencyKey: `key.${index}`, input: { synthetic: true } })) }, { sessionRef: 'session.synthetic', active: true, activeRole: 'clinician', leaseEpoch: 7, revoked: false, authorizedCapabilityIds: graph().operations.map(operation => operation.capabilityId) });
  assert.equal(verifySemanticRuntimeReceiptBatch(graph(), expected(), produced).verifiedActions.length, 2);
});

test('fails closed for reordered, duplicate, missing, extra, and mismatched graph/action/receipt bindings', () => {
  const cases: unknown[] = [
    { receipts: batch().receipts.slice().reverse() }, { receipts: [batch().receipts[0]!, batch().receipts[0]!] },
    { receipts: batch().receipts.slice(0, 1) }, { receipts: [...batch().receipts, batch().receipts[0]!] },
    { ...graph(), operations: graph().operations.slice().reverse() }, { ...graph(), operations: [graph().operations[0]!] },
    expected().slice().reverse(), expected().slice(0, 1), [...expected(), expected()[0]!],
  ];
  for (const value of cases) {
    if (Array.isArray(value)) assert.throws(() => verifySemanticRuntimeReceiptBatch(graph(), value, batch()));
    else if ('operations' in (value as object)) assert.throws(() => verifySemanticRuntimeReceiptBatch(value, expected(), batch()));
    else deny(value);
  }
  for (const key of ['operationId', 'capabilityId', 'applicationServiceRef', 'actionRef'] as const) {
    const changed = batch(); (changed.receipts[0] as Record<string, unknown>)[key] = `forged.${key}`; deny(changed);
  }
  const stage = batch(); (stage.receipts[0] as Record<string, unknown>).outcome = 'preview'; deny(stage);
});

test('denies forged denial/success, policy/revision/result drift, writes, apply, and authority unions', () => {
  const mutations: Array<(value: ReturnType<typeof batch>) => void> = [
    value => { (value.receipts[0] as Record<string, unknown>).outcome = 'denial'; },
    value => { (value.receipts[0] as Record<string, unknown>).policyDecision = 'replay'; },
    value => { (value.receipts[0] as Record<string, unknown>).revisionBinding = 'lease:8'; },
    value => { (value.receipts[0] as Record<string, unknown>).resultRef = 'forged.result'; },
    value => { (value.receipts[0] as Record<string, unknown>).writesPerformed = 1; },
    value => { (value.receipts[0] as Record<string, unknown>).applyPolicy = 'apply'; },
    value => { (value.receipts[0] as Record<string, unknown>).provider = 'forged'; },
  ];
  for (const mutate of mutations) { const value = batch(); mutate(value); deny(value); }
  const widened = graph(); (widened.operations[0] as Record<string, unknown>).authorityPolicy = 'write'; assert.throws(() => verifySemanticRuntimeReceiptBatch(widened, expected(), batch()));
});

test('does not execute proxy/accessor/thenable traps, mutate inputs, or leave unhandled work after return', async () => {
  const originalThen = Promise.prototype.then; let thenReads = 0; let unhandled = 0;
  const onUnhandled = () => { unhandled += 1; }; process.on('unhandledRejection', onUnhandled);
  (Promise.prototype as unknown as { then: unknown }).then = function (this: Promise<unknown>, ...args: Parameters<Promise<unknown>['then']>) { thenReads += 1; return originalThen.apply(this, args); };
  try {
    const hostileGraph = proxy(graph()); assert.throws(() => verifySemanticRuntimeReceiptBatch(hostileGraph.value, expected(), batch())); assert.equal(hostileGraph.traps(), 0);
    const hostileActions = proxy(expected()); assert.throws(() => verifySemanticRuntimeReceiptBatch(graph(), hostileActions.value, batch())); assert.equal(hostileActions.traps(), 0);
    const hostileBatch = proxy(batch()); assert.throws(() => verifySemanticRuntimeReceiptBatch(graph(), expected(), hostileBatch.value)); assert.equal(hostileBatch.traps(), 0);
    const accessor = batch(); Object.defineProperty(accessor.receipts[0]!, 'resultRef', { enumerable: true, get() { throw new Error('no accessor'); } }); deny(accessor);
    const symbol = batch(); Object.defineProperty(symbol.receipts[0]!, Symbol('authority'), { value: true }); deny(symbol);
    const sparse = batch(); sparse.receipts.length = 3; deny(sparse);
    const hidden = batch(); Object.defineProperty(hidden.receipts[0]!, 'resultRef', { value: 'result.read', enumerable: false }); deny(hidden);
    const inherited = batch(); Object.setPrototypeOf(inherited.receipts[0]!, Object.create(Object.prototype)); deny(inherited);
    const deep = batch(); (deep.receipts[0] as Record<string, unknown>).resultRef = { nested: { then() { throw new Error('no deep then'); } } }; deny(deep);
    const thenable = batch(); Object.defineProperty(thenable.receipts[0]!, 'then', { value() { throw new Error('no then'); }, enumerable: true }); deny(thenable);
    const pristine = batch(); verifySemanticRuntimeReceiptBatch(graph(), expected(), pristine); assert.deepEqual(pristine, batch());
    await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(thenReads, 0); assert.equal(unhandled, 0);
  } finally { (Promise.prototype as unknown as { then: unknown }).then = originalThen; process.off('unhandledRejection', onUnhandled); }
});
