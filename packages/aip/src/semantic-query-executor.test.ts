import assert from 'node:assert/strict';
import test from 'node:test';
import { createSemanticQueryPlanValidatorV1 } from './semantic-query-plan';
import { SemanticQueryExecutionV1Error, createSemanticQueryExecutorV1 } from './semantic-query-executor';

/* @Codex */
const record = <T extends object>(value: T): Readonly<T> => Object.freeze(Object.assign(Object.create(null), value));
const policy = () => record({ purposeCode: 'care_coordination', scope: 'selected_patient', generation: 7,
  revocationGeneration: 2, selectionEpoch: 11, maxSteps: 2, maxDurationMs: 100, maxOutputBytes: 4096 });
const operations = ['mediflow.patient.open_loops.read.v1', 'mediflow.terminology.search.v1'] as const;
const refs = ['PatientOpenLoopsApplicationServiceV1', 'TerminologySearchApplicationServiceV1'] as const;
const descriptor = (index: number) => record({ operationId: operations[index]!, capabilityId: operations[index]!,
  applicationServiceRef: refs[index]!, maximumStage: 'read_only', purposeCode: 'care_coordination',
  scope: 'selected_patient', inputMaxBytes: 128 });
function plan(maxDurationMs = 80) {
  const validator = createSemanticQueryPlanValidatorV1({ current: policy,
    resolveOperation: (operationId: unknown) => operations.includes(operationId as never)
      ? descriptor(operations.indexOf(operationId as never)) : null,
    canonicalizeInput: (operationId: unknown) => operations.includes(operationId as never)
      ? record({ schemaVersion: 'synthetic.input.v1' }) : null });
  return { validator, handle: validator.validate({ schemaVersion: 'mediflow.semantic-query-plan.proposal.v1',
    purposeCode: 'care_coordination', scope: 'selected_patient',
    budget: { maxSteps: 2, maxDurationMs, maxOutputBytes: 2048 },
    currentness: { generation: 7, revocationGeneration: 2, selectionEpoch: 11 },
    sourceRefs: [`src_${'a'.repeat(64)}`], explanation: 'Read two allowlisted synthetic sources.',
    steps: operations.map((operationId, index) => ({ stepRef: `step_${index}`, operationId, input: {} })) }) };
}
const output = (operationId: string, marker: string) => record({ schemaVersion: 'synthetic.read.result.v1',
  operationId, capabilityId: operationId, outcome: 'read', items: Object.freeze(Object.setPrototypeOf([marker], null)) });
function setup(overrides: { current?: () => unknown; execute?: (index: number, signal: AbortSignal) => unknown;
  serviceStage?: unknown; writeAudit?: (receipt: unknown) => unknown } = {}, maxDurationMs = 80) {
  const candidate = plan(maxDurationMs); let now = 1_000; let ref = 0; const events: string[] = [];
  const executor = createSemanticQueryExecutorV1({ inspectPlan: candidate.validator.inspect,
    current: overrides.current ?? policy, now: () => now++, nextRef: (kind: unknown) => {
      ref += 1; return `${kind === 'request' ? 'sqrq' : 'sqra'}_${String(ref).padStart(64, 'a')}`;
    }, resolveApplicationService: (serviceRef: unknown) => {
      const index = refs.indexOf(serviceRef as never); if (index < 0) return null;
      return record({ operationId: operations[index]!, applicationServiceRef: refs[index]!,
        maximumStage: overrides.serviceStage ?? 'read_only',
        execute: (_input: unknown, signal: AbortSignal) => {
          events.push(operations[index]!); return overrides.execute?.(index, signal) ?? output(operations[index]!, `item-${index}`);
        } });
    }, writeAudit: overrides.writeAudit ?? (() => { events.push('audit'); }) });
  return { ...candidate, executor, events };
}

test('executes validated read steps in order and publishes only a PHI-safe orchestration receipt', async () => {
  let receipt: unknown; const { executor, handle, events } = setup({ writeAudit: (value) => { receipt = value; events.push('audit'); } });
  const result = await executor.execute(handle);
  assert.deepEqual(events, [...operations, 'audit']);
  assert.deepEqual(Array.from(result.steps, (step) => step.operationId), [...operations]);
  assert.equal(result.receipt, receipt);
  assert.doesNotMatch(JSON.stringify(result.receipt), /synthetic sources|item-|sourceRefs|explanation|input|patient/iu);
  assert.deepEqual([result.receipt.outcome, result.receipt.policyDecision, result.receipt.writesPerformed],
    ['orchestration', 'allowed', 0]);
});

test('denies forged handles, write services and currentness drift before later execution', async () => {
  const forged = setup();
  await assert.rejects(forged.executor.execute(record({})), (error) => error instanceof SemanticQueryExecutionV1Error
    && error.code === 'plan_denied');
  const write = setup({ serviceStage: 'write' });
  await assert.rejects(write.executor.execute(write.handle), /service_denied/); assert.deepEqual(write.events, []);
  let calls = 0;
  const drift = setup({ current: () => { calls += 1; return record({ ...policy(), selectionEpoch: calls > 2 ? 12 : 11 }); } });
  await assert.rejects(drift.executor.execute(drift.handle), /currentness_denied/);
  assert.equal(drift.events.length, 1);
});

test('enforces output budget, timeout and cancellation while discarding late completion', async () => {
  const oversized = setup({ execute: (index) => output(operations[index]!, 'x'.repeat(4096)) });
  await assert.rejects(oversized.executor.execute(oversized.handle), /output_denied/);
  let release!: (value: unknown) => void;
  const pending = new Promise<unknown>((resolve) => { release = resolve; });
  const timed = setup({ execute: () => pending }, 15);
  await assert.rejects(timed.executor.execute(timed.handle), /timeout/);
  release(output(operations[0], 'late'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(timed.events.includes('audit'), false);
  const cancelled = setup({ execute: () => new Promise(() => undefined) });
  const execution = cancelled.executor.execute(cancelled.handle); assert.equal(cancelled.executor.cancel(), true);
  await assert.rejects(execution, /cancelled/); assert.equal(cancelled.executor.cancel(), false);
});
