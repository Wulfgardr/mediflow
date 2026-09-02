import { types } from 'node:util';

/* @Codex */
export type SemanticQueryPlanV1ErrorCode = 'invalid_plan' | 'policy_unavailable' | 'purpose_denied'
  | 'scope_denied' | 'budget_denied' | 'currentness_denied' | 'operation_denied'
  | 'input_denied' | 'invalid_handle';
export class SemanticQueryPlanV1Error extends Error {
  constructor(public readonly code: SemanticQueryPlanV1ErrorCode) {
    super(`Semantic query plan rejected: ${code}`); this.name = 'SemanticQueryPlanV1Error';
  }
}
export type ValidatedSemanticQueryPlanV1 = Readonly<{
  schemaVersion: 'mediflow.semantic-query-plan.validated.v1'; purposeCode: string; scope: string;
  budget: Readonly<{ maxSteps: number; maxDurationMs: number; maxOutputBytes: number }>;
  currentness: Readonly<{ generation: number; revocationGeneration: number; selectionEpoch: number }>;
  sourceRefs: readonly string[]; explanation: string;
  steps: readonly Readonly<{ stepRef: string; operationId: string; capabilityId: string;
    applicationServiceRef: string; maximumStage: 'read_only'; input: unknown }>[];
}>;

const SOURCE_KEYS = ['current', 'resolveOperation', 'canonicalizeInput'] as const;
const PLAN_KEYS = ['schemaVersion', 'purposeCode', 'scope', 'budget', 'currentness', 'sourceRefs', 'explanation', 'steps'] as const;
const BUDGET_KEYS = ['maxSteps', 'maxDurationMs', 'maxOutputBytes'] as const;
const CURRENT_KEYS = ['generation', 'revocationGeneration', 'selectionEpoch'] as const;
const SNAPSHOT_KEYS = ['purposeCode', 'scope', ...CURRENT_KEYS, ...BUDGET_KEYS] as const;
const STEP_KEYS = ['stepRef', 'operationId', 'input'] as const;
const DESCRIPTOR_KEYS = ['operationId', 'capabilityId', 'applicationServiceRef', 'maximumStage', 'purposeCode', 'scope', 'inputMaxBytes'] as const;
const SOURCE_REF = /^src_[0-9a-f]{64}$/u, STEP_REF = /^step_[a-z0-9_]{1,48}$/u;
const { isProxy, isPromise } = types;
const encoder = new TextEncoder();
const regexpTest = RegExp.prototype.test, stringTrim = String.prototype.trim, promiseThen = Promise.prototype.then;
const reflectApply = Reflect.apply;
const MAX_COPY_NODES = 512, MAX_COPY_KEYS = 1_024;
type CopyBudget = { bytes: number; keys: number; nodes: number; maxBytes: number; seen: WeakSet<object> };

function fail(code: SemanticQueryPlanV1ErrorCode): never { throw new SemanticQueryPlanV1Error(code); }
function record<T extends object>(value: T): Readonly<T> { return Object.freeze(Object.assign(Object.create(null), value)); }
function list<T>(values: T[]): readonly T[] { Object.setPrototypeOf(values, null); return Object.freeze(values); }
function exact(value: unknown, keys: readonly string[], canonical = false): Record<string, unknown> | null {
  try {
    if (typeof value !== 'object' || value === null || isProxy(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if ((canonical && (prototype !== null || !Object.isFrozen(value)))
      || (!canonical && prototype !== null && prototype !== Object.prototype)) return null;
    const actual = Reflect.ownKeys(value);
    if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) return null;
      if (canonical && (descriptor.writable || descriptor.configurable)) return null;
      output[key] = descriptor.value;
    }
    return output;
  } catch { return null; }
}
function array(value: unknown, max: number): unknown[] | null {
  try {
    if (!Array.isArray(value) || isProxy(value) || value.length > max
      || ![Array.prototype, null].includes(Object.getPrototypeOf(value))) return null;
    if (Reflect.ownKeys(value).length !== value.length + 1) return null;
    const output: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !('value' in descriptor)) return null;
      output.push(descriptor.value);
    }
    return output;
  } catch { return null; }
}
function integer(value: unknown, minimum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}
function matches(pattern: RegExp, value: unknown): value is string {
  return typeof value === 'string' && reflectApply(regexpTest, pattern, [value]);
}
function discardPromise(value: unknown): boolean {
  if (!isPromise(value)) return false;
  try { reflectApply(promiseThen, value, [() => undefined, () => undefined]); } catch { /* native promise is still denied */ }
  return true;
}
function spend(budget: CopyBudget, bytes: number, keys = 0): void {
  budget.bytes += bytes; budget.keys += keys;
  if (budget.bytes > budget.maxBytes || budget.keys > MAX_COPY_KEYS) return fail('input_denied');
}
function canonicalCopy(value: unknown, maxBytes: number, budget: CopyBudget = {
  bytes: 0, keys: 0, nodes: 0, maxBytes, seen: new WeakSet<object>(),
}, depth = 0): unknown {
  if (value === null) { spend(budget, 4); return value; }
  if (typeof value === 'string') {
    if (value.length > budget.maxBytes) return fail('input_denied');
    spend(budget, encoder.encode(value).byteLength + 2); return value;
  }
  if (typeof value === 'boolean') { spend(budget, value ? 4 : 5); return value; }
  if (typeof value === 'number' && Number.isFinite(value)) { spend(budget, String(value).length); return value; }
  if (depth >= 8) return fail('input_denied');
  if (typeof value !== 'object' || value === null || isProxy(value)) return fail('input_denied');
  if (budget.seen.has(value)) return fail('input_denied');
  budget.seen.add(value); budget.nodes += 1;
  if (budget.nodes > MAX_COPY_NODES) return fail('input_denied');
  const items = array(value, 64);
  if (items) {
    spend(budget, 2 + Math.max(0, items.length - 1));
    return list(items.map((item) => canonicalCopy(item, maxBytes, budget, depth + 1)));
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) return fail('input_denied');
    const keys = Reflect.ownKeys(value);
    if (keys.length > 64 || keys.some((key) => typeof key !== 'string')) return fail('input_denied');
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail('input_denied');
      if (key.length > budget.maxBytes) return fail('input_denied');
      spend(budget, encoder.encode(key).byteLength + 3, 1);
      output[key] = canonicalCopy(descriptor.value, maxBytes, budget, depth + 1);
    }
    spend(budget, 2 + Math.max(0, keys.length - 1));
    return Object.freeze(output);
  } catch { return fail('input_denied'); }
}

/** Validates an untrusted proposal against host-owned policy and operation resolvers. */
export function createSemanticQueryPlanValidatorV1(sourcesValue: unknown) {
  const sources = exact(sourcesValue, SOURCE_KEYS);
  if (!sources || SOURCE_KEYS.some((key) => typeof sources[key] !== 'function')) return fail('policy_unavailable');
  const currentSource = sources.current as () => unknown;
  const resolveSource = sources.resolveOperation as (operationId: unknown) => unknown;
  const inputSource = sources.canonicalizeInput as (operationId: unknown, input: unknown) => unknown;
  const plans = new WeakMap<object, ValidatedSemanticQueryPlanV1>();
  const readCurrent = (): Record<string, unknown> => {
    let snapshotValue: unknown;
    try { snapshotValue = currentSource(); } catch { return fail('policy_unavailable'); }
    if (discardPromise(snapshotValue)) return fail('policy_unavailable');
    const snapshot = exact(snapshotValue, SNAPSHOT_KEYS, true);
    if (!snapshot || typeof snapshot.purposeCode !== 'string' || !snapshot.purposeCode
      || typeof snapshot.scope !== 'string' || !snapshot.scope
      || !integer(snapshot.generation, 1) || !integer(snapshot.revocationGeneration, 0) || !integer(snapshot.selectionEpoch, 0)
      || !integer(snapshot.maxSteps, 1) || (snapshot.maxSteps as number) > 8
      || !integer(snapshot.maxDurationMs, 1) || (snapshot.maxDurationMs as number) > 30_000
      || !integer(snapshot.maxOutputBytes, 1) || (snapshot.maxOutputBytes as number) > 1_048_576) return fail('policy_unavailable');
    return snapshot;
  };
  const validate = (candidate: unknown): object => {
    const snapshot = readCurrent(), plan = exact(candidate, PLAN_KEYS);
    if (!plan || plan.schemaVersion !== 'mediflow.semantic-query-plan.proposal.v1') return fail('invalid_plan');
    if (plan.purposeCode !== snapshot.purposeCode) return fail('purpose_denied');
    if (plan.scope !== snapshot.scope) return fail('scope_denied');
    const budget = exact(plan.budget, BUDGET_KEYS), currentness = exact(plan.currentness, CURRENT_KEYS);
    if (!budget || !integer(budget.maxSteps, 1) || !integer(budget.maxDurationMs, 1) || !integer(budget.maxOutputBytes, 1)
      || (budget.maxSteps as number) > (snapshot.maxSteps as number)
      || (budget.maxDurationMs as number) > (snapshot.maxDurationMs as number)
      || (budget.maxOutputBytes as number) > (snapshot.maxOutputBytes as number)) return fail('budget_denied');
    if (!currentness || CURRENT_KEYS.some((key) => currentness[key] !== snapshot[key])) return fail('currentness_denied');
    if (typeof plan.explanation !== 'string' || plan.explanation.length < 8 || plan.explanation.length > 512
      || reflectApply(stringTrim, plan.explanation, []) !== plan.explanation) return fail('invalid_plan');
    const refs = array(plan.sourceRefs, 8), rawSteps = array(plan.steps, snapshot.maxSteps as number);
    if (!refs?.length || refs.some((ref) => !matches(SOURCE_REF, ref)) || new Set(refs).size !== refs.length
      || !rawSteps?.length || rawSteps.length !== budget.maxSteps) return fail('invalid_plan');
    const seen = new Set<string>(), steps: Readonly<Record<string, unknown>>[] = [];
    for (const rawStep of rawSteps) {
      const step = exact(rawStep, STEP_KEYS);
      if (!step || !matches(STEP_REF, step.stepRef) || seen.has(step.stepRef)
        || typeof step.operationId !== 'string') return fail('invalid_plan');
      seen.add(step.stepRef);
      let descriptorValue: unknown;
      try { descriptorValue = resolveSource(step.operationId); } catch { return fail('operation_denied'); }
      if (discardPromise(descriptorValue)) return fail('operation_denied');
      const descriptor = exact(descriptorValue, DESCRIPTOR_KEYS, true);
      if (!descriptor || descriptor.operationId !== step.operationId || descriptor.maximumStage !== 'read_only'
        || descriptor.purposeCode !== snapshot.purposeCode || descriptor.scope !== snapshot.scope
        || typeof descriptor.capabilityId !== 'string' || !descriptor.capabilityId || descriptor.capabilityId.length > 128
        || typeof descriptor.applicationServiceRef !== 'string' || !descriptor.applicationServiceRef
        || descriptor.applicationServiceRef.length > 128
        || !integer(descriptor.inputMaxBytes, 2) || (descriptor.inputMaxBytes as number) > 65_536) return fail('operation_denied');
      let canonical: unknown;
      const inputMaxBytes = descriptor.inputMaxBytes as number;
      const safeInput = canonicalCopy(step.input, inputMaxBytes);
      try { canonical = inputSource(step.operationId, safeInput); } catch { return fail('input_denied'); }
      if (canonical === null || discardPromise(canonical)) return fail('input_denied');
      canonical = canonicalCopy(canonical, inputMaxBytes);
      if (encoder.encode(JSON.stringify(canonical)).byteLength > inputMaxBytes) return fail('input_denied');
      steps.push(record({ stepRef: step.stepRef, operationId: step.operationId, capabilityId: descriptor.capabilityId,
        applicationServiceRef: descriptor.applicationServiceRef, maximumStage: 'read_only' as const, input: canonical }));
    }
    const finalSnapshot = readCurrent();
    if (SNAPSHOT_KEYS.some((key) => finalSnapshot[key] !== snapshot[key])) return fail('currentness_denied');
    const materialized = record({ schemaVersion: 'mediflow.semantic-query-plan.validated.v1' as const, purposeCode: plan.purposeCode,
      scope: plan.scope, budget: record(budget), currentness: record(currentness), sourceRefs: list(refs as string[]),
      explanation: plan.explanation, steps: list(steps) }) as ValidatedSemanticQueryPlanV1;
    const handle = Object.freeze(Object.create(null)); plans.set(handle, materialized); return handle;
  };
  const inspect = (handle: unknown) => {
    const plan = typeof handle === 'object' && handle !== null ? plans.get(handle) : undefined;
    return plan ?? fail('invalid_handle');
  };
  return record({ validate, inspect });
}
