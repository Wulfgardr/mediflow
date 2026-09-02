/* @Codex */
import { types } from 'node:util';

import {
  PATIENT_OPEN_LOOPS_READ_APPLICATION_SERVICE_V1,
  PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
} from './patient-open-loops.ts';
import { AIP_TERMINOLOGY_SEARCH_CONTRACT_V1 } from './terminology-search.ts';

export const SEMANTIC_QUERY_OPERATION_ID_V1 = 'mediflow.semantic_query_plan.execute.v1' as const;
export const SEMANTIC_QUERY_OPERATION_APPLICATION_SERVICE_V1 = 'SemanticQueryOperationServiceV1' as const;
export const SEMANTIC_QUERY_OPERATION_INPUT_SCHEMA_V1 = 'mediflow.semantic-query-operation.input.v1' as const;
export const SEMANTIC_QUERY_OPERATION_OUTPUT_SCHEMA_V1 = 'mediflow.semantic-query-execution.result.v1' as const;
export const SEMANTIC_QUERY_OPERATION_MAX_STEPS_V1 = 2 as const;
export const SEMANTIC_QUERY_OPERATION_MAX_DURATION_MS_V1 = 250 as const;
export const SEMANTIC_QUERY_OPERATION_MAX_OUTPUT_BYTES_V1 = 32 * 1024;

export const SEMANTIC_QUERY_OPERATION_SOURCE_KEYS_V1 = ['now', 'nextRef', 'currentPolicy', 'currentSourceRefs',
  'currentOwner', 'beginPermit', 'finalizePermit', 'denyPermit', 'executeTerminology', 'executeOpenLoops',
  'commitTerminalAudit'] as const;
export const SEMANTIC_QUERY_OPERATION_INPUT_KEYS_V1 = ['schemaVersion', 'operationId', 'budget',
  'explanation', 'steps'] as const;
export const SEMANTIC_QUERY_OPERATION_POLICY_KEYS_V1 = ['purposeCode', 'scope', 'generation',
  'revocationGeneration', 'selectionEpoch', 'maxSteps', 'maxDurationMs', 'maxOutputBytes'] as const;
export const SEMANTIC_QUERY_OPERATION_SOURCE_REF_KEYS_V1 = ['generation', 'revocationGeneration',
  'selectionEpoch', 'sourceRefs'] as const;
export const SEMANTIC_QUERY_OPERATION_OPEN_LOOPS_INPUT_KEYS_V1 = ['schemaVersion', 'operationId'] as const;
export const SEMANTIC_QUERY_OPERATION_SOURCE_REF_V1 = /^src_[0-9a-f]{64}$/u;

export function semanticQueryOperationRecord<T extends object>(value: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, value));
}
export function semanticQueryOperationList<T>(values: readonly T[]): readonly T[] {
  const output = Array.from(values);
  Object.setPrototypeOf(output, null);
  return Object.freeze(output);
}

export const SEMANTIC_QUERY_ALLOWED_READS_V1 = semanticQueryOperationList([
  semanticQueryOperationRecord({
    operationId: AIP_TERMINOLOGY_SEARCH_CONTRACT_V1.operationId,
    capabilityId: AIP_TERMINOLOGY_SEARCH_CONTRACT_V1.capabilityId,
    applicationServiceRef: AIP_TERMINOLOGY_SEARCH_CONTRACT_V1.applicationServiceRef,
    inputSchema: 'mediflow.terminology.search.input.v1' as const,
    outputSchema: 'mediflow.terminology.search.output.v1' as const,
    maximumStage: 'read_only' as const,
  }),
  semanticQueryOperationRecord({
    operationId: PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
    capabilityId: PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
    applicationServiceRef: PATIENT_OPEN_LOOPS_READ_APPLICATION_SERVICE_V1,
    inputSchema: 'mediflow.patient.open_loops.read.input.v1' as const,
    outputSchema: 'mediflow.patient.open_loops.read.result.v1' as const,
    maximumStage: 'read_only' as const,
  }),
]);

export const SEMANTIC_QUERY_OPERATION_CONTRACT_V1 = semanticQueryOperationRecord({
  operationId: SEMANTIC_QUERY_OPERATION_ID_V1,
  capabilityId: SEMANTIC_QUERY_OPERATION_ID_V1,
  applicationServiceRef: SEMANTIC_QUERY_OPERATION_APPLICATION_SERVICE_V1,
  inputSchema: SEMANTIC_QUERY_OPERATION_INPUT_SCHEMA_V1,
  outputSchema: SEMANTIC_QUERY_OPERATION_OUTPUT_SCHEMA_V1,
  maximumStage: 'read_only' as const,
  authorityPolicy: 'aip_owner_lease_permit.v1' as const,
  sessionPolicy: 'aip_child_owner_process_bound.v1' as const,
  casPolicy: 'currentness_generation_revocation_selection_epoch.v1' as const,
  idempotencyPolicy: 'process_local_single_use_plan_handle.v1' as const,
  limitPolicy: semanticQueryOperationRecord({ maxSteps: SEMANTIC_QUERY_OPERATION_MAX_STEPS_V1,
    maxDurationMs: SEMANTIC_QUERY_OPERATION_MAX_DURATION_MS_V1,
    maxOutputBytes: SEMANTIC_QUERY_OPERATION_MAX_OUTPUT_BYTES_V1,
    timeoutMode: 'deadline_and_cooperative_cancel.v1' as const }),
  receiptPolicy: 'mediflow.headless.receipt.v1' as const,
  auditPolicy: 'synchronous_terminal.v1' as const,
  applyPolicy: 'none' as const,
  writesPerformed: 0 as const,
  fabricDependency: 'none' as const,
  allowedOperations: SEMANTIC_QUERY_ALLOWED_READS_V1,
});

export type SemanticQueryOperationV1ErrorCode = 'invalid_input' | 'authorization_denied' | 'plan_denied'
  | 'currentness_denied' | 'operation_denied' | 'operation_unavailable' | 'audit_failed'
  | 'timeout' | 'cancelled' | 'disposed';

export class SemanticQueryOperationV1Error extends Error {
  constructor(public readonly code: SemanticQueryOperationV1ErrorCode) {
    super(`Semantic query operation rejected: ${code}`);
    this.name = 'SemanticQueryOperationV1Error';
  }
}

export type SemanticQueryOperationPolicyV1 = Readonly<{
  purposeCode: string;
  scope: string;
  generation: number;
  revocationGeneration: number;
  selectionEpoch: number;
  maxSteps: number;
  maxDurationMs: number;
  maxOutputBytes: number;
}>;

export function semanticQueryOperationFail(code: SemanticQueryOperationV1ErrorCode): never {
  throw new SemanticQueryOperationV1Error(code);
}
export function semanticQueryOperationInteger(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}
export function semanticQueryOperationExact(value: unknown, keys: readonly string[], canonical = false):
Record<string, unknown> | null {
  try {
    if (typeof value !== 'object' || value === null || types.isProxy(value)
      || Array.isArray(value) || types.isPromise(value)) return null;
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
export function semanticQueryOperationDiscardPromise(value: unknown): boolean {
  if (!types.isPromise(value)) return false;
  try { void Promise.prototype.then.call(value, undefined, () => undefined); } catch { /* denied */ }
  return true;
}
type SemanticQueryOperationJsonBudget = { nodes: number; bytes: number; maxBytes: number };
function spendSemanticQueryOperationJsonBytes(budget: SemanticQueryOperationJsonBudget, bytes: number): void {
  if (bytes > budget.maxBytes - budget.bytes) return semanticQueryOperationFail('operation_unavailable');
  budget.bytes += bytes;
}
function spendSemanticQueryOperationJsonString(value: string, budget: SemanticQueryOperationJsonBudget): void {
  if (value.length > budget.maxBytes - budget.bytes) return semanticQueryOperationFail('operation_unavailable');
  spendSemanticQueryOperationJsonBytes(budget, 2);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x09 || code === 0x0a
      || code === 0x0c || code === 0x0d) spendSemanticQueryOperationJsonBytes(budget, 2);
    else if (code <= 0x1f) spendSemanticQueryOperationJsonBytes(budget, 6);
    else if (code <= 0x7f) spendSemanticQueryOperationJsonBytes(budget, 1);
    else if (code <= 0x7ff) spendSemanticQueryOperationJsonBytes(budget, 2);
    else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00
      && value.charCodeAt(index + 1) <= 0xdfff) {
      spendSemanticQueryOperationJsonBytes(budget, 4); index += 1;
    } else if (code >= 0xd800 && code <= 0xdfff) spendSemanticQueryOperationJsonBytes(budget, 6);
    else spendSemanticQueryOperationJsonBytes(budget, 3);
  }
}
export function canonicalSemanticQueryOperationJson(value: unknown,
  budget: SemanticQueryOperationJsonBudget = { nodes: 0, bytes: 0,
    maxBytes: SEMANTIC_QUERY_OPERATION_MAX_OUTPUT_BYTES_V1 }, depth = 0): unknown {
  budget.nodes += 1;
  if (budget.nodes > 2_048 || depth > 16) return semanticQueryOperationFail('operation_unavailable');
  if (value === null) { spendSemanticQueryOperationJsonBytes(budget, 4); return value; }
  if (typeof value === 'boolean') {
    spendSemanticQueryOperationJsonBytes(budget, value ? 4 : 5); return value;
  }
  if (typeof value === 'string') { spendSemanticQueryOperationJsonString(value, budget); return value; }
  if (typeof value === 'number' && Number.isFinite(value)) {
    spendSemanticQueryOperationJsonBytes(budget, String(value).length); return value;
  }
  if (typeof value !== 'object' || types.isProxy(value) || types.isPromise(value)) {
    return semanticQueryOperationFail('operation_unavailable');
  }
  try {
    if (Array.isArray(value)) {
      if (![Array.prototype, null].includes(Object.getPrototypeOf(value)) || value.length > 128) {
        return semanticQueryOperationFail('operation_unavailable');
      }
      spendSemanticQueryOperationJsonBytes(budget, 2 + Math.max(0, value.length - 1));
      const keys = Reflect.ownKeys(value);
      if (keys.length !== value.length + 1) return semanticQueryOperationFail('operation_unavailable');
      const output: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !('value' in descriptor)) {
          return semanticQueryOperationFail('operation_unavailable');
        }
        output.push(canonicalSemanticQueryOperationJson(descriptor.value, budget, depth + 1));
      }
      return semanticQueryOperationList(output);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) return semanticQueryOperationFail('operation_unavailable');
    const keys = Reflect.ownKeys(value);
    if (keys.length > 256 || keys.some((key) => typeof key !== 'string')) {
      return semanticQueryOperationFail('operation_unavailable');
    }
    spendSemanticQueryOperationJsonBytes(budget, 2 + Math.max(0, keys.length - 1));
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        return semanticQueryOperationFail('operation_unavailable');
      }
      spendSemanticQueryOperationJsonString(key, budget);
      spendSemanticQueryOperationJsonBytes(budget, 1);
      output[key] = canonicalSemanticQueryOperationJson(descriptor.value, budget, depth + 1);
    }
    return Object.freeze(output);
  } catch (error) {
    if (error instanceof SemanticQueryOperationV1Error) throw error;
    return semanticQueryOperationFail('operation_unavailable');
  }
}
export function findSemanticQueryAllowedOperation(value: unknown, byService = false) {
  for (let index = 0; index < SEMANTIC_QUERY_ALLOWED_READS_V1.length; index += 1) {
    const item = SEMANTIC_QUERY_ALLOWED_READS_V1[index]!;
    if ((byService ? item.applicationServiceRef : item.operationId) === value) return item;
  }
  return null;
}
