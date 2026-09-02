/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SEMANTIC_QUERY_OPERATION_CONTRACT_V1,
  createSemanticQueryOperationServiceV1,
} from './semantic-query-operation.ts';

const record = <T extends object>(value: T): Readonly<T> =>
  Object.freeze(Object.assign(Object.create(null) as T, value));

const policy = () => record({
  purposeCode: 'care_coordination',
  scope: 'selected_patient',
  generation: 7,
  revocationGeneration: 2,
  selectionEpoch: 11,
  maxSteps: 2,
  maxDurationMs: 250,
  maxOutputBytes: 32 * 1024,
});

const input = () => ({
  schemaVersion: 'mediflow.semantic-query-operation.input.v1',
  operationId: 'mediflow.semantic_query_plan.execute.v1',
  budget: { maxSteps: 2, maxDurationMs: 200, maxOutputBytes: 24 * 1024 },
  explanation: 'Read the selected patient open loops and resolve one local terminology term.',
  steps: [{
    stepRef: 'step_open_loops',
    operationId: 'mediflow.patient.open_loops.read.v1',
    input: {
      schemaVersion: 'mediflow.patient.open_loops.read.input.v1',
      operationId: 'mediflow.patient.open_loops.read.v1',
    },
  }, {
    stepRef: 'step_terminology',
    operationId: 'mediflow.terminology.search.v1',
    input: {
      schemaVersion: 'mediflow.terminology.search.input.v1',
      operationId: 'mediflow.terminology.search.v1',
      system: 'LOINC',
      query: 'pressione arteriosa',
      limit: 2,
    },
  }],
});

type SetupOverrides = Readonly<{
  now?: () => number;
  currentPolicy?: () => unknown;
  currentSourceRefs?: () => unknown;
  executeTerminology?: (value: unknown, signal: AbortSignal) => unknown;
  executeOpenLoops?: (value: unknown, signal: AbortSignal) => unknown;
  commitTerminalAudit?: (value: unknown) => unknown;
}>;

function setup(overrides: SetupOverrides = {}) {
  let clock = 1_000;
  let began = 0;
  let finalized = 0;
  const calls: string[] = [];
  const audits: unknown[] = [];
  const permit = record({});
  const service = createSemanticQueryOperationServiceV1({
    now: overrides.now ?? (() => clock++),
    nextRef: (kind: 'request' | 'action') =>
      `${kind === 'request' ? 'sqrq' : 'sqra'}_${(kind === 'request' ? 'a' : 'b').repeat(64)}`,
    currentPolicy: overrides.currentPolicy ?? policy,
    currentSourceRefs: overrides.currentSourceRefs ?? (() => record({
      generation: 7,
      revocationGeneration: 2,
      selectionEpoch: 11,
      sourceRefs: Object.freeze([`src_${'c'.repeat(64)}`]),
    })),
    currentOwner: () => record({ generation: 7, revocationGeneration: 2, selectionEpoch: 11 }),
    beginPermit: (candidate: unknown) => {
      assert.equal(candidate, permit);
      began += 1;
      return record({});
    },
    finalizePermit: () => {
      finalized += 1;
      return true;
    },
    denyPermit: () => true,
    executeTerminology: overrides.executeTerminology ?? (async (_value: unknown, signal: AbortSignal) => {
      assert.equal(signal.aborted, false);
      calls.push('mediflow.terminology.search.v1');
      return {
        schemaVersion: 'mediflow.terminology.search.output.v1',
        operationId: 'mediflow.terminology.search.v1',
        capabilityId: 'mediflow.terminology.search.v1',
        outcome: 'read',
        items: [{ system: 'LOINC', code: '85354-9', display: 'Blood pressure panel' }],
      };
    }),
    executeOpenLoops: overrides.executeOpenLoops ?? (async (_value: unknown, signal: AbortSignal) => {
      assert.equal(signal.aborted, false);
      calls.push('mediflow.patient.open_loops.read.v1');
      return {
        schemaVersion: 'mediflow.patient.open_loops.read.result.v1',
        operationId: 'mediflow.patient.open_loops.read.v1',
        capabilityId: 'mediflow.patient.open_loops.read.v1',
        outcome: 'read',
        items: [{ loopRef: `aipl_${'1'.repeat(64)}`, temporalState: 'overdue' }],
      };
    }),
    commitTerminalAudit: overrides.commitTerminalAudit ?? ((value: unknown) => {
      audits.push(value);
    }),
  });
  return { service, permit, calls, audits, counters: () => ({ began, finalized }) };
}

test('executes only the two named reads and returns a bounded PHI-safe orchestration receipt', async () => {
  const { service, permit, calls, audits, counters } = setup();
  const result = await service.execute(permit, input());

  assert.deepEqual(calls, [
    'mediflow.patient.open_loops.read.v1',
    'mediflow.terminology.search.v1',
  ]);
  assert.deepEqual(counters(), { began: 1, finalized: 1 });
  assert.equal(result.receipt.capabilityId, SEMANTIC_QUERY_OPERATION_CONTRACT_V1.capabilityId);
  assert.equal(result.receipt.outcome, 'orchestration');
  assert.equal(result.receipt.writesPerformed, 0);
  assert.equal(result.receipt.applyPolicy, 'none');
  assert.equal(audits.length, 1);
  assert.doesNotMatch(JSON.stringify(audits), /pressione|aipl_|src_c|patientId|ambulatoryId/iu);
});

test('denies caller-supplied provenance and authority fields before invoking a read', async () => {
  for (const authority of [{ sourceRefs: [`src_${'d'.repeat(64)}`] },
    { purposeCode: 'care_coordination' }, { scope: 'selected_patient' },
    { currentness: { generation: 7, revocationGeneration: 2, selectionEpoch: 11 } }]) {
    const { service, permit, calls, audits } = setup();
    await assert.rejects(service.execute(permit, Object.assign(input(), authority)),
      (error: unknown) => (error as { code?: string }).code === 'invalid_input');
    assert.deepEqual(calls, []);
    assert.equal(audits.length, 1);
    assert.doesNotMatch(JSON.stringify(audits), /src_c|src_d|patientId|ambulatoryId/iu);
  }
});

test('denies SQL, generic invoke, write operations and caller-selected provider or venue', async () => {
  for (const operationId of ['sql.query', 'generic.invoke', 'mediflow.patient.update.v1']) {
    const { service, permit, calls, audits } = setup();
    const candidate = input();
    candidate.steps[0]!.operationId = operationId;
    await assert.rejects(service.execute(permit, candidate),
      (error: unknown) => (error as { code?: string }).code === 'operation_denied');
    assert.deepEqual(calls, []);
    assert.equal(audits.length, 1);
  }
  for (const field of [{ sql: 'select * from patients' }, { invoke: 'generic' },
    { provider: 'openai' }, { venue: 'cloud' }]) {
    const { service, permit, calls, audits } = setup();
    await assert.rejects(service.execute(permit, Object.assign(input(), field)),
      (error: unknown) => (error as { code?: string }).code === 'invalid_input');
    assert.deepEqual(calls, []);
    assert.equal(audits.length, 1);
    assert.doesNotMatch(JSON.stringify(audits), /select \*|openai|cloud|patientId|ambulatoryId/iu);
  }
});

test('denies trusted provenance drift before executing the first read', async () => {
  let reads = 0;
  const { service, permit, calls, audits } = setup({ currentSourceRefs: () => {
    reads += 1;
    return record({ generation: 7, revocationGeneration: 2, selectionEpoch: 11,
      sourceRefs: Object.freeze([`src_${(reads === 1 ? 'c' : 'd').repeat(64)}`]) });
  } });
  await assert.rejects(service.execute(permit, input()),
    (error: unknown) => (error as { code?: string }).code === 'currentness_denied');
  assert.equal(reads, 2);
  assert.deepEqual(calls, []);
  assert.equal(audits.length, 1);
  assert.doesNotMatch(JSON.stringify(audits), /src_c|src_d|patientId|ambulatoryId/iu);
});

test('revalidates host currentness after a read and withholds later results', async () => {
  let selectionEpoch = 11;
  let readCalls = 0;
  const { service, permit, calls, audits } = setup({
    currentPolicy: () => record({ ...policy(), selectionEpoch }),
    executeOpenLoops: async () => {
      readCalls += 1;
      selectionEpoch = 12;
      return {
        schemaVersion: 'mediflow.patient.open_loops.read.result.v1',
        operationId: 'mediflow.patient.open_loops.read.v1',
        capabilityId: 'mediflow.patient.open_loops.read.v1',
        outcome: 'read',
        items: [],
      };
    },
  });

  await assert.rejects(service.execute(permit, input()),
    (error: unknown) => (error as { code?: string }).code === 'currentness_denied');
  assert.equal(readCalls, 1);
  assert.deepEqual(calls, []);
  assert.equal(audits.length, 1);
  assert.equal((audits[0] as { outcome: unknown }).outcome, 'denied');
});

test('cancels an active read and discards its late completion', async () => {
  let release!: (value: unknown) => void;
  const observedSignals: AbortSignal[] = [];
  const pending = new Promise<unknown>((resolve) => { release = resolve; });
  const { service, permit, audits } = setup({
    executeOpenLoops: (_value, signal) => {
      observedSignals.push(signal);
      return pending;
    },
  });

  const execution = service.execute(permit, input());
  assert.equal(service.cancel(), true);
  await assert.rejects(execution,
    (error: unknown) => (error as { code?: string }).code === 'cancelled');
  assert.equal(observedSignals[0]?.aborted, true);
  assert.equal(service.cancel(), false);
  release({ schemaVersion: 'synthetic.late.v1', operationId: 'late', capabilityId: 'late', outcome: 'read' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(audits.length, 1);
  assert.deepEqual([(audits[0] as { outcome: unknown }).outcome,
    (audits[0] as { denialCode: unknown }).denialCode], ['denied', 'cancelled']);
});

test('enforces the caller budget deadline and emits one terminal denial', async () => {
  let release!: (value: unknown) => void;
  const pending = new Promise<unknown>((resolve) => { release = resolve; });
  const { service, permit, audits } = setup({ executeOpenLoops: () => pending });
  const candidate = input();
  candidate.budget.maxDurationMs = 15;

  await assert.rejects(service.execute(permit, candidate),
    (error: unknown) => (error as { code?: string }).code === 'timeout');
  release({ schemaVersion: 'synthetic.late.v1', operationId: 'late', capabilityId: 'late', outcome: 'read' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(audits.length, 1);
  assert.deepEqual([(audits[0] as { outcome: unknown }).outcome,
    (audits[0] as { denialCode: unknown }).denialCode], ['denied', 'timeout']);
});

test('requires an exact synchronous terminal audit commit port', async () => {
  assert.throws(() => setup({ commitTerminalAudit: async () => undefined }),
    (error: unknown) => (error as { code?: string }).code === 'operation_unavailable');

  let commits = 0;
  const { service, permit } = setup({ commitTerminalAudit: () => {
    commits += 1;
    return Promise.resolve(undefined);
  } });
  await assert.rejects(service.execute(permit, input()),
    (error: unknown) => (error as { code?: string }).code === 'audit_failed');
  assert.ok(commits >= 1);
});
