import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SemanticQueryPlanV1Error,
  createSemanticQueryPlanValidatorV1,
} from './semantic-query-plan';

/* @Codex */
const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(Object.assign(Object.create(null), value));
const current = () => freeze({ purposeCode: 'care_coordination', scope: 'selected_patient', generation: 7,
  revocationGeneration: 2, selectionEpoch: 11, maxSteps: 2, maxDurationMs: 500, maxOutputBytes: 4096 });
const descriptor = freeze({ operationId: 'mediflow.patient.open_loops.read.v1',
  capabilityId: 'mediflow.patient.open_loops.read.v1', applicationServiceRef: 'PatientOpenLoopsApplicationServiceV1',
  maximumStage: 'read_only', purposeCode: 'care_coordination', scope: 'selected_patient', inputMaxBytes: 128 });
const candidate = () => ({ schemaVersion: 'mediflow.semantic-query-plan.proposal.v1', purposeCode: 'care_coordination',
  scope: 'selected_patient', budget: { maxSteps: 1, maxDurationMs: 250, maxOutputBytes: 2048 },
  currentness: { generation: 7, revocationGeneration: 2, selectionEpoch: 11 },
  sourceRefs: [`src_${'a'.repeat(64)}`], explanation: 'Review the selected patient open loops.',
  steps: [{ stepRef: 'step_open_loops', operationId: descriptor.operationId, input: { includeCompleted: false } }] });

function setup() {
  return createSemanticQueryPlanValidatorV1({ current, resolveOperation(operationId: unknown) {
    return operationId === descriptor.operationId ? descriptor : null;
  }, canonicalizeInput(operationId: unknown, input: unknown) {
    const value = input as { includeCompleted?: unknown };
    return operationId === descriptor.operationId && value?.includeCompleted === false
      ? freeze({ includeCompleted: false }) : null;
  } });
}

test('materializes an immutable process-local plan from an allowlisted read operation', () => {
  const validator = setup();
  const handle = validator.validate(candidate());
  const plan = validator.inspect(handle);
  assert.equal(Object.getPrototypeOf(handle), null);
  assert.equal(Reflect.ownKeys(handle).length, 0);
  assert.equal(plan.steps[0]?.applicationServiceRef, descriptor.applicationServiceRef);
  assert.equal(plan.steps[0]?.maximumStage, 'read_only');
  assert.equal((plan.steps[0]?.input as { includeCompleted: boolean }).includeCompleted, false);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.getPrototypeOf(plan.steps), null);
  assert.throws(() => validator.inspect(freeze({})), /invalid_handle/);
});

test('denies unknown, write, SQL and caller-selected provider or venue', () => {
  const validator = setup();
  for (const operationId of ['sql.query', 'mediflow.patient.update.v1', 'generic.query']) {
    const value = candidate(); value.steps[0]!.operationId = operationId;
    assert.throws(() => validator.validate(value), (error) => error instanceof SemanticQueryPlanV1Error && error.code === 'operation_denied');
  }
  for (const extra of [{ sql: 'select 1' }, { provider: 'openai' }, { venue: 'cloud' }]) {
    assert.throws(() => validator.validate(Object.assign(candidate(), extra)), /invalid_plan/);
  }
});

test('denies ambiguity, scope expansion, excessive budget and stale currentness', () => {
  const validator = setup();
  const cases = [
    Object.assign(candidate(), { explanation: '' }),
    Object.assign(candidate(), { scope: 'all_patients' }),
    Object.assign(candidate(), { budget: { maxSteps: 1, maxDurationMs: 501, maxOutputBytes: 2048 } }),
    Object.assign(candidate(), { currentness: { generation: 8, revocationGeneration: 2, selectionEpoch: 11 } }),
    Object.assign(candidate(), { steps: [] }),
  ];
  for (const value of cases) assert.throws(() => validator.validate(value), SemanticQueryPlanV1Error);
});

test('rejects hostile records, accessors and invalid canonical inputs without reading inherited authority', () => {
  const validator = setup(); let reads = 0;
  const accessor = candidate(); Object.defineProperty(accessor, 'provider', { enumerable: true, get() { reads += 1; return 'openai'; } });
  const proxy = new Proxy(candidate(), { ownKeys() { reads += 1; return []; } });
  for (const value of [accessor, proxy, Object.assign(Object.create({ venue: 'cloud' }), candidate())]) {
    assert.throws(() => validator.validate(value), /invalid_plan/);
  }
  const invalidInput = candidate(); invalidInput.steps[0]!.input = { includeCompleted: true };
  assert.throws(() => validator.validate(invalidInput), /input_denied/);
  const decorated = candidate(); Object.assign(decorated.steps, { provider: 'openai' });
  assert.throws(() => validator.validate(decorated), /invalid_plan/);
  assert.equal(reads, 0);
});

test('revalidates policy currentness for every validation and caps serialized inputs', () => {
  let snapshot = current();
  const validator = createSemanticQueryPlanValidatorV1({ current: () => snapshot,
    resolveOperation: () => descriptor, canonicalizeInput: () => freeze({ payload: 'x'.repeat(256) }) });
  assert.throws(() => validator.validate(candidate()), /input_denied/);
  snapshot = freeze({ ...current(), selectionEpoch: 12 });
  assert.throws(() => setup().validate(Object.assign(candidate(), {
    currentness: { generation: 7, revocationGeneration: 2, selectionEpoch: 12 },
  })), /currentness_denied/);
  snapshot = current();
  let calls = 0;
  const reentrant = createSemanticQueryPlanValidatorV1({ current: () => snapshot,
    resolveOperation: () => descriptor, canonicalizeInput: () => {
      calls += 1; snapshot = freeze({ ...current(), selectionEpoch: 12 }); return freeze({ includeCompleted: false });
    } });
  assert.throws(() => reentrant.validate(candidate()), /currentness_denied/);
  assert.equal(calls, 1);
});

test('rejects malformed host policy and empty provenance without returning a grant', () => {
  const malformed = createSemanticQueryPlanValidatorV1({ current: () => freeze({ ...current(), maxSteps: '2' }),
    resolveOperation: () => descriptor, canonicalizeInput: () => freeze({ includeCompleted: false }) });
  assert.throws(() => malformed.validate(candidate()), /policy_unavailable/);
  const noSources = candidate(); noSources.sourceRefs = [];
  assert.throws(() => setup().validate(noSources), /invalid_plan/);
  assert.equal(Object.getPrototypeOf(setup()), null);
});
