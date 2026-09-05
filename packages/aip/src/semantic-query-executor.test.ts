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
  now?: () => unknown; serviceStage?: unknown;
  canonicalizeOutput?: (operationId: unknown, value: unknown) => unknown;
  beforeCommit?: () => unknown;
  writeAudit?: (audit: unknown, decide: (current: unknown, committedAt: unknown) => unknown) => unknown;
} = {}, maxDurationMs = 80) {
  const candidate = plan(maxDurationMs); let now = 1_000; let ref = 0; const events: string[] = [], audits: unknown[] = [];
  const current = overrides.current ?? policy, clock = overrides.now ?? (() => now++);
    const sources = { inspectPlan: candidate.validator.inspect,
    current, now: clock, nextRef: (kind: unknown) => {
      ref += 1; return `${kind === 'request' ? 'sqrq' : 'sqra'}_${String(ref).padStart(64, 'a')}`;
    }, resolveApplicationService: (serviceRef: unknown) => {
      const index = refs.indexOf(serviceRef as never); if (index < 0) return null;
      return record({ operationId: operations[index]!, applicationServiceRef: refs[index]!,
        maximumStage: overrides.serviceStage ?? 'read_only',
        execute: (_input: unknown, signal: AbortSignal) => {
          events.push(operations[index]!); return overrides.execute?.(index, signal) ?? output(operations[index]!, `item-${index}`);
        } });
    }, canonicalizeOutput: overrides.canonicalizeOutput ?? ((_operationId: unknown, value: unknown) => value),
    beforeCommit: overrides.beforeCommit ?? (() => true),
    writeAudit: record({ mode: 'synchronous_terminal.v1', commit: (audit: unknown,
      decide: (current: unknown, committedAt: unknown) => unknown) => {
      const overridden = overrides.writeAudit?.(audit, decide);
      const terminal = overridden ?? decide((audit as { outcome: unknown }).outcome === 'allowed' ? current() : null, clock());
      audits.push(terminal); events.push('audit'); return terminal;
    } }) };
  const createExecutor = () => createSemanticQueryExecutorV1(sources);
  return { ...candidate, executor: createExecutor(), createExecutor, events, audits, sources };
}

test('executes validated read steps in order and publishes only a PHI-safe orchestration receipt', async () => {
  const { executor, handle, events, audits } = setup();
  const result = await executor.execute(handle);
  const audit = audits[0];
  assert.deepEqual(events, [...operations, 'audit']);
  assert.deepEqual(Array.from(result.steps, (step) => step.operationId), [...operations]);
  assert.notEqual(result.receipt, audit);
  assert.doesNotMatch(JSON.stringify(result.receipt), /synthetic sources|item-|sourceRefs|explanation|input|patient/iu);
  assert.doesNotMatch(JSON.stringify(audit), /synthetic sources|item-|sourceRefs|explanation|input|patient/iu);
  assert.deepEqual([result.receipt.outcome, result.receipt.policyDecision, result.receipt.writesPerformed],
    ['orchestration', 'allowed', 0]);
  assert.equal((audit as { outcome: unknown }).outcome, 'allowed');
});

test('denies forged handles, write services and currentness drift before later execution', async () => {
  const forged = setup();
  await assert.rejects(forged.executor.execute(record({})), (error) => error instanceof SemanticQueryExecutionV1Error
    && error.code === 'plan_denied');
  const write = setup({ serviceStage: 'write' });
  await assert.rejects(write.executor.execute(write.handle), /service_denied/);
  assert.deepEqual(write.events, ['audit']);
  assert.equal((write.audits[0] as { denialCode: unknown }).denialCode, 'service_denied');
  let calls = 0;
  const drift = setup({ current: () => { calls += 1; return record({ ...policy(), selectionEpoch: calls > 2 ? 12 : 11 }); } });
  await assert.rejects(drift.executor.execute(drift.handle), /currentness_denied/);
  assert.deepEqual(drift.events, [operations[0], 'audit']);
  assert.equal((drift.audits[0] as { outcome: unknown }).outcome, 'denied');
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
  assert.equal((timed.audits[0] as { outcome: unknown }).outcome, 'denied');
  const cancelled = setup({ execute: () => new Promise(() => undefined) });
  const execution = cancelled.executor.execute(cancelled.handle); assert.equal(cancelled.executor.cancel(), true);
  await assert.rejects(execution, /cancelled/); assert.equal(cancelled.executor.cancel(), false);
});

test('revalidates currentness after the final host callback before publication', async () => {
  let snapshot = policy(); let clockCalls = 0;
  const currentness = setup({ current: () => snapshot, now: () => {
    clockCalls += 1;
    if (clockCalls === 4) snapshot = record({ ...policy(), selectionEpoch: 12 });
    return 1_000 + clockCalls;
  } });
  await assert.rejects(currentness.executor.execute(currentness.handle), /currentness_denied/);
  assert.equal((currentness.audits[0] as { outcome: unknown }).outcome, 'denied');

  snapshot = policy();
  const duringAudit = setup({ current: () => snapshot, writeAudit: (audit) => {
    if ((audit as { outcome: unknown }).outcome === 'allowed') {
      snapshot = record({ ...policy(), selectionEpoch: 12 });
    }
    return undefined;
  } });
  await assert.rejects(duringAudit.executor.execute(duringAudit.handle), /currentness_denied/);
  assert.deepEqual(duringAudit.audits.map((value) => (value as { outcome: unknown }).outcome), ['denied']);
});

test('post-fences currentness before canonicalizing a raw service output', async () => {
  let snapshot = policy();
  let canonicalCalls = 0;
  let traps = 0;
  const raw = new Proxy({}, { ownKeys: () => { traps += 1; return []; },
    getPrototypeOf: () => { traps += 1; return Object.prototype; } });
  const candidate = setup({ current: () => snapshot, execute: () => {
    snapshot = record({ ...policy(), selectionEpoch: 12 });
    return raw;
  }, canonicalizeOutput: (_operationId, value) => {
    canonicalCalls += 1;
    Reflect.ownKeys(value as object);
    return value;
  } });

  await assert.rejects(candidate.executor.execute(candidate.handle),
    (error) => error instanceof SemanticQueryExecutionV1Error && error.code === 'currentness_denied');
  assert.equal(canonicalCalls, 0);
  assert.equal(traps, 0);
  assert.deepEqual(candidate.audits.map((audit) => (audit as { outcome: unknown }).outcome), ['denied']);
});

test('consumes each genuine plan handle globally and terminalizes every executor attempt', async () => {
  const replay = setup();
  await replay.executor.execute(replay.handle);
  await assert.rejects(replay.createExecutor().execute(replay.handle), /restart_forbidden/);
  assert.deepEqual(replay.events, [...operations, 'audit', 'audit']);
  assert.deepEqual(replay.audits.map((value) => (value as { outcome: unknown }).outcome), ['allowed', 'denied']);

  const denied = setup();
  await assert.rejects(denied.executor.execute(record({})), /plan_denied/);
  await assert.rejects(denied.executor.execute(denied.handle), /restart_forbidden/);
  assert.deepEqual(denied.events, ['audit', 'audit']);
  assert.deepEqual(denied.audits.map((value) => (value as { denialCode: unknown }).denialCode),
    ['plan_denied', 'restart_forbidden']);
});

test('records one terminal denial and never materializes a late allowed audit', async () => {
  let release!: (value: unknown) => void;
  const pending = new Promise<unknown>((resolve) => { release = resolve; });
  const late = setup({ execute: () => pending }, 15);
  await assert.rejects(late.executor.execute(late.handle), /timeout/);
  release(output(operations[0], 'late'));
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(late.audits.map((value) => (value as { outcome: unknown }).outcome), ['denied']);
  assert.equal((late.audits[0] as { denialCode: unknown }).denialCode, 'timeout');

  let asyncAuditCalls = 0;
  assert.throws(() => createSemanticQueryExecutorV1({ ...late.sources,
    writeAudit: record({ mode: 'synchronous_terminal.v1', commit: async () => { asyncAuditCalls += 1; } }) }),
  /policy_unavailable/);
  assert.equal(asyncAuditCalls, 0);

  let retainedDecision!: (current: unknown, committedAt: unknown) => unknown;
  const oneShot = setup({ writeAudit: (_audit, decide) => { retainedDecision = decide; return undefined; } });
  await oneShot.executor.execute(oneShot.handle);
  assert.throws(() => retainedDecision(policy(), 1_010), /audit_failed/);
  assert.deepEqual(oneShot.audits.map((value) => (value as { outcome: unknown }).outcome), ['allowed']);

  let promiseAuditCalls = 0;
  const promisePort = setup();
  const promiseExecutor = createSemanticQueryExecutorV1({ ...promisePort.sources,
    writeAudit: record({ mode: 'synchronous_terminal.v1', commit: () => {
      promiseAuditCalls += 1; return Promise.resolve(null);
    } }) });
  await assert.rejects(promiseExecutor.execute(promisePort.handle), /audit_failed/);
  assert.equal(promiseAuditCalls, 2);
});

test('lets the terminal audit enforce the deadline at the actual commit point', async () => {
  const slow = setup({ now: () => Date.now(), writeAudit: (audit) => {
    if ((audit as { outcome: unknown }).outcome === 'allowed') {
      const startedAt = performance.now();
      while (performance.now() - startedAt < 40) { /* bounded synthetic synchronous stall */ }
    }
    return undefined;
  } }, 15);

  await assert.rejects(slow.executor.execute(slow.handle),
    (error) => error instanceof SemanticQueryExecutionV1Error && error.code === 'timeout');
  assert.deepEqual(slow.audits.map((value) => [
    (value as { outcome: unknown }).outcome, (value as { denialCode: unknown }).denialCode,
  ]), [['denied', 'timeout']]);
});

test('linearizes cancellation on either side of the terminal audit decision', async () => {
  let cancelBefore = () => false, acceptedBefore = false;
  const before = setup({ writeAudit: (audit) => {
    if ((audit as { outcome: unknown }).outcome === 'allowed') acceptedBefore = cancelBefore();
    return undefined;
  } });
  cancelBefore = before.executor.cancel;

  await assert.rejects(before.executor.execute(before.handle),
    (error) => error instanceof SemanticQueryExecutionV1Error && error.code === 'cancelled');
  assert.equal(acceptedBefore, true);
  assert.deepEqual(before.audits.map((value) => [
    (value as { outcome: unknown }).outcome, (value as { denialCode: unknown }).denialCode,
  ]), [['denied', 'cancelled']]);

  let cancelAfter = () => true, acceptedAfter = true;
  const after = setup({ writeAudit: (audit, decide) => {
    if ((audit as { outcome: unknown }).outcome !== 'allowed') return undefined;
    const terminal = decide(policy(), 1_010);
    acceptedAfter = cancelAfter();
    return terminal;
  } });
  cancelAfter = after.executor.cancel;

  assert.equal((await after.executor.execute(after.handle)).outcome, 'read_completed');
  assert.equal(acceptedAfter, false);
  assert.deepEqual(after.audits.map((value) => (value as { outcome: unknown }).outcome), ['allowed']);
});
