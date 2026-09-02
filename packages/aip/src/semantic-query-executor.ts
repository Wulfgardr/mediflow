import { types } from 'node:util';
import type { ValidatedSemanticQueryPlanV1 } from './semantic-query-plan';

/* @Codex */
export type SemanticQueryExecutionV1ErrorCode = 'plan_denied' | 'policy_unavailable' | 'currentness_denied'
  | 'service_denied' | 'output_denied' | 'audit_failed' | 'timeout' | 'cancelled' | 'restart_forbidden';
export class SemanticQueryExecutionV1Error extends Error {
  constructor(public readonly code: SemanticQueryExecutionV1ErrorCode) {
    super(`Semantic query execution rejected: ${code}`); this.name = 'SemanticQueryExecutionV1Error';
  }
}
export type SemanticQueryExecutionReceiptV1 = Readonly<{
  schemaVersion: 'mediflow.headless.receipt.v1'; requestRef: string; actionRef: string;
  capabilityId: 'mediflow.semantic_query_plan.execute.v1'; outcome: 'orchestration'; policyDecision: 'allowed';
  revisionBinding: Readonly<{ generation: number; revocationGeneration: number; selectionEpoch: number }>;
  operationCount: number; durationMs: number; createdAt: number; writesPerformed: 0; applyPolicy: 'none';
}>;
export type SemanticQueryExecutionResultV1 = Readonly<{
  schemaVersion: 'mediflow.semantic-query-execution.result.v1'; outcome: 'read_completed';
  steps: readonly Readonly<{ stepRef: string; operationId: string; output: unknown }>[];
  receipt: SemanticQueryExecutionReceiptV1;
}>;

const SOURCE_KEYS = ['inspectPlan', 'current', 'now', 'nextRef', 'resolveApplicationService', 'writeAudit'] as const;
const SNAPSHOT_KEYS = ['purposeCode', 'scope', 'generation', 'revocationGeneration', 'selectionEpoch',
  'maxSteps', 'maxDurationMs', 'maxOutputBytes'] as const;
const SERVICE_KEYS = ['operationId', 'applicationServiceRef', 'maximumStage', 'execute'] as const;
const RESULT_KEYS = ['schemaVersion', 'operationId', 'capabilityId', 'outcome'] as const;
const REQUEST_REF = /^sqrq_[0-9a-f]{64}$/u, ACTION_REF = /^sqra_[0-9a-f]{64}$/u;
const { isProxy, isPromise } = types;
const promiseThen = Promise.prototype.then, reflectApply = Reflect.apply;
const encoder = new TextEncoder();

function fail(code: SemanticQueryExecutionV1ErrorCode): never { throw new SemanticQueryExecutionV1Error(code); }
function record<T extends object>(value: T): Readonly<T> { return Object.freeze(Object.assign(Object.create(null), value)); }
function list<T>(values: T[]): readonly T[] { Object.setPrototypeOf(values, null); return Object.freeze(values); }
function exact(value: unknown, keys: readonly string[], canonical = false): Record<string, unknown> | null {
  try {
    if (typeof value !== 'object' || value === null || isProxy(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if ((canonical && (prototype !== null || !Object.isFrozen(value)))
      || (!canonical && prototype !== null && prototype !== Object.prototype)) return null;
    const own = Reflect.ownKeys(value);
    if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)
        || (canonical && (descriptor.writable || descriptor.configurable))) return null;
      output[key] = descriptor.value;
    }
    return output;
  } catch { return null; }
}
function integer(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}
function canonical(value: unknown, depth = 0): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (depth >= 10 || typeof value !== 'object' || isProxy(value) || !Object.isFrozen(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value), own = Reflect.ownKeys(value);
    if (Array.isArray(value)) {
      if (prototype !== null || own.length !== value.length + 1) return false;
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !('value' in descriptor) || descriptor.writable || descriptor.configurable
          || !canonical(descriptor.value, depth + 1)) return false;
      }
      return true;
    }
    if (prototype !== null || own.length > 128 || own.some((key) => typeof key !== 'string')) return false;
    for (const key of own as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor) || descriptor.writable || descriptor.configurable
        || !canonical(descriptor.value, depth + 1)) return false;
    }
    return true;
  } catch { return false; }
}
function requiredFields(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!canonical(value) || Array.isArray(value)) return null;
  try {
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) return null;
      output[key] = descriptor.value;
    }
    return output;
  } catch { return null; }
}
function discardPromise(value: unknown): boolean {
  if (!isPromise(value)) return false;
  try { reflectApply(promiseThen, value, [() => undefined, () => undefined]); } catch { /* denied */ }
  return true;
}

/** Executes one process-local validated plan through host-owned read Application Services. */
export function createSemanticQueryExecutorV1(sourcesValue: unknown) {
  const sources = exact(sourcesValue, SOURCE_KEYS);
  if (!sources || SOURCE_KEYS.some((key) => typeof sources[key] !== 'function')) return fail('policy_unavailable');
  const inspectSource = sources.inspectPlan as (handle: unknown) => unknown;
  const currentSource = sources.current as () => unknown, nowSource = sources.now as () => unknown;
  const nextRefSource = sources.nextRef as (kind: 'request' | 'action') => unknown;
  const resolveSource = sources.resolveApplicationService as (ref: unknown) => unknown;
  const auditSource = sources.writeAudit as (receipt: unknown) => unknown;
  let state: 'idle' | 'running' | 'terminal' = 'idle', terminalCode: 'timeout' | 'cancelled' | null = null;
  let controller: AbortController | null = null, terminalResolve: ((value: 'timeout' | 'cancelled') => void) | null = null;
  let lastNow = -1;

  const now = (): number => {
    let value: unknown; try { value = nowSource(); } catch { return fail('policy_unavailable'); }
    if (state !== 'running') return terminalError();
    if (discardPromise(value) || !integer(value) || value < lastNow) return fail('policy_unavailable');
    lastNow = value; return value;
  };
  const readCurrent = (plan: ValidatedSemanticQueryPlanV1): void => {
    let value: unknown; try { value = currentSource(); } catch { return fail('policy_unavailable'); }
    if (state !== 'running') return terminalError();
    if (discardPromise(value)) return fail('policy_unavailable');
    const current = exact(value, SNAPSHOT_KEYS, true);
    if (!current || current.purposeCode !== plan.purposeCode || current.scope !== plan.scope
      || current.generation !== plan.currentness.generation
      || current.revocationGeneration !== plan.currentness.revocationGeneration
      || current.selectionEpoch !== plan.currentness.selectionEpoch
      || !integer(current.maxSteps, plan.steps.length) || !integer(current.maxDurationMs, plan.budget.maxDurationMs)
      || !integer(current.maxOutputBytes, plan.budget.maxOutputBytes)) return fail('currentness_denied');
  };
  const terminalize = (code: 'timeout' | 'cancelled'): boolean => {
    if (state !== 'running') return false;
    state = 'terminal'; terminalCode = code; controller?.abort(code); terminalResolve?.(code); return true;
  };
  const terminalError = (): never => fail(terminalCode ?? 'service_denied');
  const bounded = async (value: unknown, failure: 'service_denied' | 'audit_failed', terminal: Promise<'timeout' | 'cancelled'>) => {
    if (!isPromise(value)) { if (state !== 'running') return terminalError(); return value; }
    let promise: Promise<unknown> | null = null;
    try { if (!isProxy(value) && Object.getPrototypeOf(value) === Promise.prototype) promise = value as Promise<unknown>; }
    catch { /* denied below */ }
    if (!promise) { discardPromise(value); return fail(failure); }
    const observed = new Promise<Readonly<{ ok: boolean; value?: unknown }>>((resolve) => {
      reflectApply(promiseThen, promise, [(result: unknown) => resolve(record({ ok: true, value: result })),
        () => resolve(record({ ok: false }))]);
    });
    const settled = await Promise.race([observed, terminal]);
    if (typeof settled === 'string') return fail(settled);
    if (!settled.ok) return fail(failure);
    if (state !== 'running') return terminalError();
    return settled.value;
  };
  const nextRef = (kind: 'request' | 'action'): string => {
    let value: unknown; try { value = nextRefSource(kind); } catch { return fail('audit_failed'); }
    if (state !== 'running') return terminalError();
    if (discardPromise(value) || typeof value !== 'string'
      || !(kind === 'request' ? REQUEST_REF : ACTION_REF).test(value)) return fail('audit_failed');
    return value;
  };

  const execute = async (handle: unknown): Promise<SemanticQueryExecutionResultV1> => {
    if (state !== 'idle') return fail('restart_forbidden');
    let inspected: unknown;
    try { inspected = inspectSource(handle); } catch { return fail('plan_denied'); }
    if (discardPromise(inspected) || !canonical(inspected)) return fail('plan_denied');
    const plan = inspected as ValidatedSemanticQueryPlanV1;
    if (plan.schemaVersion !== 'mediflow.semantic-query-plan.validated.v1' || !plan.steps.length) return fail('plan_denied');
    if (state !== 'idle') return fail('restart_forbidden');
    state = 'running'; controller = new AbortController();
    const terminal = new Promise<'timeout' | 'cancelled'>((resolve) => { terminalResolve = resolve; });
    const outputs: Readonly<{ stepRef: string; operationId: string; output: unknown }>[] = [];
    let outputBytes = 0, timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const startedAt = now(); timer = setTimeout(() => terminalize('timeout'), plan.budget.maxDurationMs);
      for (let index = 0; index < plan.steps.length; index += 1) {
        const step = plan.steps[index]!;
        readCurrent(plan);
        let serviceValue: unknown; try { serviceValue = resolveSource(step.applicationServiceRef); }
        catch { return fail('service_denied'); }
        if (state !== 'running') return terminalError();
        if (discardPromise(serviceValue)) return fail('service_denied');
        const service = exact(serviceValue, SERVICE_KEYS, true);
        if (!service || service.operationId !== step.operationId
          || service.applicationServiceRef !== step.applicationServiceRef || service.maximumStage !== 'read_only'
          || typeof service.execute !== 'function') return fail('service_denied');
        readCurrent(plan); if (state !== 'running') return terminalError();
        let returned: unknown;
        try { returned = reflectApply(service.execute as (...args: unknown[]) => unknown, undefined,
          [step.input, controller.signal]); }
        catch { if (state !== 'running') return terminalError(); return fail('service_denied'); }
        const output = await bounded(returned, 'service_denied', terminal);
        if (now() - startedAt >= plan.budget.maxDurationMs) { terminalize('timeout'); return fail('timeout'); }
        const envelope = requiredFields(output, RESULT_KEYS);
        if (!envelope || typeof envelope.schemaVersion !== 'string' || !envelope.schemaVersion
          || envelope.schemaVersion.length > 128 || envelope.operationId !== step.operationId
          || envelope.capabilityId !== step.capabilityId || envelope.outcome !== 'read') return fail('output_denied');
        let bytes = 0; try { bytes = encoder.encode(JSON.stringify(output)).byteLength; } catch { return fail('output_denied'); }
        outputBytes += bytes; if (outputBytes > plan.budget.maxOutputBytes) return fail('output_denied');
        readCurrent(plan); outputs.push(record({ stepRef: step.stepRef, operationId: step.operationId, output }));
      }
      const requestRef = nextRef('request'), actionRef = nextRef('action'), createdAt = now();
      if (createdAt - startedAt >= plan.budget.maxDurationMs) { terminalize('timeout'); return fail('timeout'); }
      const receipt = record({ schemaVersion: 'mediflow.headless.receipt.v1' as const, requestRef, actionRef,
        capabilityId: 'mediflow.semantic_query_plan.execute.v1' as const, outcome: 'orchestration' as const,
        policyDecision: 'allowed' as const, revisionBinding: record(plan.currentness), operationCount: outputs.length,
        durationMs: createdAt - startedAt, createdAt, writesPerformed: 0 as const, applyPolicy: 'none' as const });
      readCurrent(plan);
      let audited: unknown; try { audited = auditSource(receipt); } catch { return fail('audit_failed'); }
      await bounded(audited, 'audit_failed', terminal); readCurrent(plan);
      if (now() - startedAt >= plan.budget.maxDurationMs) { terminalize('timeout'); return fail('timeout'); }
      state = 'terminal'; return record({ schemaVersion: 'mediflow.semantic-query-execution.result.v1' as const,
        outcome: 'read_completed' as const, steps: list(outputs), receipt });
    } finally {
      if (timer) clearTimeout(timer); if (state === 'running') state = 'terminal'; controller = null; terminalResolve = null;
    }
  };
  return record({ execute, cancel: () => terminalize('cancelled') });
}
