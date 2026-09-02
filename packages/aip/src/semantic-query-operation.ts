/* @Codex */
import { types } from 'node:util';

import {
  PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
} from './patient-open-loops.ts';
import { AIP_TERMINOLOGY_SEARCH_CONTRACT_V1 } from './terminology-search.ts';
import { parseInput as parseTerminologyInput } from './terminology-search-contract.ts';
import {
  SemanticQueryExecutionV1Error,
  createSemanticQueryExecutorV1,
  type SemanticQueryExecutionResultV1,
} from './semantic-query-executor.ts';
import {
  SemanticQueryPlanV1Error,
  createSemanticQueryPlanValidatorV1,
} from './semantic-query-plan.ts';
import {
  SEMANTIC_QUERY_OPERATION_ID_V1,
  SEMANTIC_QUERY_OPERATION_INPUT_KEYS_V1,
  SEMANTIC_QUERY_OPERATION_INPUT_SCHEMA_V1,
  SEMANTIC_QUERY_OPERATION_MAX_DURATION_MS_V1,
  SEMANTIC_QUERY_OPERATION_MAX_OUTPUT_BYTES_V1,
  SEMANTIC_QUERY_OPERATION_MAX_STEPS_V1,
  SEMANTIC_QUERY_OPERATION_OPEN_LOOPS_INPUT_KEYS_V1,
  SEMANTIC_QUERY_OPERATION_POLICY_KEYS_V1,
  SEMANTIC_QUERY_OPERATION_SOURCE_KEYS_V1,
  SEMANTIC_QUERY_OPERATION_SOURCE_REF_KEYS_V1,
  SEMANTIC_QUERY_OPERATION_SOURCE_REF_V1,
  SemanticQueryOperationV1Error,
  canonicalSemanticQueryOperationJson,
  findSemanticQueryAllowedOperation,
  semanticQueryOperationDiscardPromise,
  semanticQueryOperationExact,
  semanticQueryOperationFail,
  semanticQueryOperationInteger,
  semanticQueryOperationList,
  semanticQueryOperationRecord,
  type SemanticQueryOperationPolicyV1,
} from './semantic-query-operation-contract.ts';

export {
  SEMANTIC_QUERY_ALLOWED_READS_V1,
  SEMANTIC_QUERY_OPERATION_APPLICATION_SERVICE_V1,
  SEMANTIC_QUERY_OPERATION_CONTRACT_V1,
  SEMANTIC_QUERY_OPERATION_ID_V1,
  SEMANTIC_QUERY_OPERATION_INPUT_SCHEMA_V1,
  SEMANTIC_QUERY_OPERATION_OUTPUT_SCHEMA_V1,
  SemanticQueryOperationV1Error,
} from './semantic-query-operation-contract.ts';
export type { SemanticQueryOperationV1ErrorCode } from './semantic-query-operation-contract.ts';

const { isProxy, isPromise } = types, encoder = new TextEncoder();

const record = semanticQueryOperationRecord, list = semanticQueryOperationList;
const exact = semanticQueryOperationExact, integer = semanticQueryOperationInteger;
const discardPromise = semanticQueryOperationDiscardPromise, fail = semanticQueryOperationFail;
type Policy = SemanticQueryOperationPolicyV1;

function mapError(error: unknown): SemanticQueryOperationV1Error {
  if (error instanceof SemanticQueryOperationV1Error) return error;
  if (error instanceof SemanticQueryPlanV1Error) {
    if (error.code === 'operation_denied') return new SemanticQueryOperationV1Error('operation_denied');
    if (error.code === 'currentness_denied' || error.code === 'policy_unavailable') {
      return new SemanticQueryOperationV1Error('currentness_denied');
    }
    if (error.code === 'input_denied' || error.code === 'invalid_plan') {
      return new SemanticQueryOperationV1Error('invalid_input');
    }
    return new SemanticQueryOperationV1Error('plan_denied');
  }
  if (error instanceof SemanticQueryExecutionV1Error) {
    if (error.code === 'timeout') return new SemanticQueryOperationV1Error('timeout');
    if (error.code === 'cancelled') return new SemanticQueryOperationV1Error('cancelled');
    if (error.code === 'currentness_denied') return new SemanticQueryOperationV1Error('currentness_denied');
    if (error.code === 'authorization_denied') return new SemanticQueryOperationV1Error('authorization_denied');
    if (error.code === 'audit_failed') return new SemanticQueryOperationV1Error('audit_failed');
    if (error.code === 'plan_denied') return new SemanticQueryOperationV1Error('plan_denied');
    return new SemanticQueryOperationV1Error('operation_unavailable');
  }
  return new SemanticQueryOperationV1Error('operation_unavailable');
}

/** Composes a process-local semantic plan over the only two host-allowlisted read services. */
export function createSemanticQueryOperationServiceV1(sourcesValue: unknown) {
  const sources = exact(sourcesValue, SEMANTIC_QUERY_OPERATION_SOURCE_KEYS_V1);
  if (!sources || SEMANTIC_QUERY_OPERATION_SOURCE_KEYS_V1.some((key) =>
    typeof sources[key] !== 'function' || isProxy(sources[key]))
    || types.isAsyncFunction(sources.commitTerminalAudit)) {
    return fail('operation_unavailable');
  }
  const nowSource = sources.now as () => unknown;
  const nextRefSource = sources.nextRef as (kind: 'request' | 'action') => unknown;
  const currentPolicySource = sources.currentPolicy as () => unknown;
  const currentSourceRefsSource = sources.currentSourceRefs as () => unknown;
  const currentOwnerSource = sources.currentOwner as () => unknown;
  const beginSource = sources.beginPermit as (permit: unknown, current: unknown, claim: unknown) => unknown;
  const finalizeSource = sources.finalizePermit as (execution: unknown, current: unknown, claim: unknown) => unknown;
  const denySource = sources.denyPermit as (execution: unknown) => unknown;
  const terminologySource = sources.executeTerminology as (input: unknown, signal: AbortSignal) => unknown;
  const openLoopsSource = sources.executeOpenLoops as (input: unknown, signal: AbortSignal) => unknown;
  const auditSource = sources.commitTerminalAudit as (audit: unknown) => unknown;
  const claim = record({ operation: SEMANTIC_QUERY_OPERATION_ID_V1,
    capabilityId: SEMANTIC_QUERY_OPERATION_ID_V1 });
  let state: 'available' | 'pending' | 'terminal' = 'available';
  let activeExecutor: ReturnType<typeof createSemanticQueryExecutorV1> | null = null;
  let auditWritten = false;

  const currentPolicy = (): Policy => {
    let candidate: unknown;
    try { candidate = currentPolicySource(); } catch { return fail('currentness_denied'); }
    if (discardPromise(candidate)) return fail('currentness_denied');
    const value = exact(candidate, SEMANTIC_QUERY_OPERATION_POLICY_KEYS_V1, true);
    if (!value || typeof value.purposeCode !== 'string' || value.purposeCode.length < 1
      || typeof value.scope !== 'string' || value.scope.length < 1
      || !integer(value.generation, 1) || !integer(value.revocationGeneration)
      || !integer(value.selectionEpoch) || !integer(value.maxSteps, 1)
      || value.maxSteps > SEMANTIC_QUERY_OPERATION_MAX_STEPS_V1
      || !integer(value.maxDurationMs, 1)
      || value.maxDurationMs > SEMANTIC_QUERY_OPERATION_MAX_DURATION_MS_V1
      || !integer(value.maxOutputBytes, 1)
      || value.maxOutputBytes > SEMANTIC_QUERY_OPERATION_MAX_OUTPUT_BYTES_V1) {
      return fail('currentness_denied');
    }
    return record(value) as Policy;
  };
  const currentOwner = (): unknown => {
    let candidate: unknown;
    try { candidate = currentOwnerSource(); } catch { return fail('authorization_denied'); }
    if (discardPromise(candidate)) return fail('authorization_denied');
    return candidate;
  };
  const currentSourceRefs = (policy: Policy): readonly string[] => {
    let candidate: unknown;
    try { candidate = currentSourceRefsSource(); } catch { return fail('currentness_denied'); }
    if (discardPromise(candidate)) return fail('currentness_denied');
    const snapshot = exact(candidate, SEMANTIC_QUERY_OPERATION_SOURCE_REF_KEYS_V1, true);
    if (!snapshot || snapshot.generation !== policy.generation
      || snapshot.revocationGeneration !== policy.revocationGeneration
      || snapshot.selectionEpoch !== policy.selectionEpoch) return fail('currentness_denied');
    let refs: unknown[];
    try {
      if (!Array.isArray(snapshot.sourceRefs) || isProxy(snapshot.sourceRefs)
        || ![Array.prototype, null].includes(Object.getPrototypeOf(snapshot.sourceRefs))
        || !Object.isFrozen(snapshot.sourceRefs) || snapshot.sourceRefs.length < 1
        || snapshot.sourceRefs.length > 8
        || Reflect.ownKeys(snapshot.sourceRefs).length !== snapshot.sourceRefs.length + 1) {
        return fail('currentness_denied');
      }
      refs = Array.from(snapshot.sourceRefs as unknown[]);
    } catch { return fail('currentness_denied'); }
    if (refs.some((ref) => typeof ref !== 'string' || !SEMANTIC_QUERY_OPERATION_SOURCE_REF_V1.test(ref))
      || new Set(refs).size !== refs.length) return fail('currentness_denied');
    return list(refs as string[]);
  };
  const writeAudit = (audit: unknown): void => {
    let result: unknown;
    try { result = auditSource(audit); } catch { return fail('audit_failed'); }
    if (result !== undefined) {
      discardPromise(result);
      return fail('audit_failed');
    }
    auditWritten = true;
  };
  const denialAudit = (policy: Policy | null, code: 'plan_denied' | 'currentness_denied'): void => {
    let timestamp: unknown;
    try { timestamp = nowSource(); } catch { return fail('audit_failed'); }
    if (!integer(timestamp)) return fail('audit_failed');
    writeAudit(record({ schemaVersion: 'mediflow.aip.audit.v1' as const,
      eventType: 'semantic_query_plan_execution' as const, outcome: 'denied' as const,
      operation: SEMANTIC_QUERY_OPERATION_ID_V1, capabilityId: SEMANTIC_QUERY_OPERATION_ID_V1,
      policyDecision: 'denied' as const,
      revisionBinding: policy ? record({ generation: policy.generation,
        revocationGeneration: policy.revocationGeneration, selectionEpoch: policy.selectionEpoch }) : null,
      operationCount: 0 as const, durationMs: 0 as const, timestamp, writesPerformed: 0 as const,
      applyPolicy: 'none' as const, denialCode: code }));
  };
  const canonicalInput = (operationId: unknown, inputValue: unknown): unknown => {
    if (operationId === AIP_TERMINOLOGY_SEARCH_CONTRACT_V1.operationId) {
      const parsed = parseTerminologyInput(inputValue);
      return record({ schemaVersion: 'mediflow.terminology.search.input.v1' as const,
        operationId: AIP_TERMINOLOGY_SEARCH_CONTRACT_V1.operationId,
        system: parsed.system, query: parsed.query, limit: parsed.limit });
    }
    if (operationId === PATIENT_OPEN_LOOPS_READ_OPERATION_V1) {
      const input = exact(inputValue, SEMANTIC_QUERY_OPERATION_OPEN_LOOPS_INPUT_KEYS_V1);
      if (!input || input.schemaVersion !== 'mediflow.patient.open_loops.read.input.v1'
        || input.operationId !== PATIENT_OPEN_LOOPS_READ_OPERATION_V1) return null;
      return record({ schemaVersion: 'mediflow.patient.open_loops.read.input.v1' as const,
        operationId: PATIENT_OPEN_LOOPS_READ_OPERATION_V1 });
    }
    return null;
  };

  const execute = async (permit: unknown, inputValue: unknown): Promise<SemanticQueryExecutionResultV1> => {
    if (state === 'terminal') return fail('disposed');
    if (state !== 'available') return fail('operation_unavailable');
    state = 'pending';
    let permitExecution: unknown;
    let began = false;
    let policy: Policy | null = null;
    auditWritten = false;
    try {
      permitExecution = beginSource(permit, currentOwner(), claim);
      if (!permitExecution || typeof permitExecution !== 'object' || isProxy(permitExecution) || isPromise(permitExecution)) {
        return fail('authorization_denied');
      }
      began = true;
      policy = currentPolicy();
      const sourceRefs = currentSourceRefs(policy);
      const input = exact(inputValue, SEMANTIC_QUERY_OPERATION_INPUT_KEYS_V1);
      if (!input || input.schemaVersion !== SEMANTIC_QUERY_OPERATION_INPUT_SCHEMA_V1
        || input.operationId !== SEMANTIC_QUERY_OPERATION_ID_V1) return fail('invalid_input');
      const validator = createSemanticQueryPlanValidatorV1({ current: currentPolicy,
        resolveOperation: (operationId: unknown) => {
          const allowed = findSemanticQueryAllowedOperation(operationId);
          return allowed ? record({ operationId: allowed.operationId, capabilityId: allowed.capabilityId,
            applicationServiceRef: allowed.applicationServiceRef, maximumStage: 'read_only' as const,
            purposeCode: policy!.purposeCode, scope: policy!.scope,
            inputMaxBytes: allowed.operationId === PATIENT_OPEN_LOOPS_READ_OPERATION_V1 ? 128 : 512 }) : null;
        }, canonicalizeInput: canonicalInput });
      const handle = validator.validate({ schemaVersion: 'mediflow.semantic-query-plan.proposal.v1',
        purposeCode: policy.purposeCode, scope: policy.scope, budget: input.budget,
        currentness: { generation: policy.generation, revocationGeneration: policy.revocationGeneration,
          selectionEpoch: policy.selectionEpoch }, sourceRefs,
        explanation: input.explanation, steps: input.steps });
      const finalSourceRefs = currentSourceRefs(policy);
      if (finalSourceRefs.length !== sourceRefs.length) return fail('currentness_denied');
      for (let index = 0; index < sourceRefs.length; index += 1) {
        if (finalSourceRefs[index] !== sourceRefs[index]) return fail('currentness_denied');
      }
      const executionCurrent = (): Policy | null => {
        try {
          const snapshot = currentPolicy(), refs = currentSourceRefs(snapshot);
          if (refs.length !== sourceRefs.length) return null;
          for (let index = 0; index < sourceRefs.length; index += 1)
            if (refs[index] !== sourceRefs[index]) return null;
          return snapshot;
        } catch { return null; }
      };
      const executor = createSemanticQueryExecutorV1({ inspectPlan: validator.inspect,
        current: executionCurrent, now: nowSource, nextRef: nextRefSource,
        resolveApplicationService: (serviceRef: unknown) => {
          const allowed = findSemanticQueryAllowedOperation(serviceRef, true);
          if (!allowed) return null;
          const executeRead = allowed.operationId === PATIENT_OPEN_LOOPS_READ_OPERATION_V1
            ? openLoopsSource : terminologySource;
          return record({ operationId: allowed.operationId,
            applicationServiceRef: allowed.applicationServiceRef, maximumStage: 'read_only' as const,
            execute: (readInput: unknown, signal: AbortSignal) => executeRead(readInput, signal) });
        }, canonicalizeOutput: (_operationId: unknown, output: unknown) => {
          const canonical = canonicalSemanticQueryOperationJson(output);
          let bytes: number; try { bytes = encoder.encode(JSON.stringify(canonical)).byteLength; }
          catch { return fail('operation_unavailable'); }
          if (bytes > SEMANTIC_QUERY_OPERATION_MAX_OUTPUT_BYTES_V1) return fail('operation_unavailable');
          return canonical;
        }, beforeCommit: () => {
          if (!executionCurrent()) return 'currentness_denied' as const;
          let finalized: unknown; try { finalized = finalizeSource(permitExecution, currentOwner(), claim); }
          catch { return 'authorization_denied' as const; }
          if (discardPromise(finalized) || finalized !== true) return 'authorization_denied' as const;
          return true;
        }, writeAudit: record({ mode: 'synchronous_terminal.v1' as const,
          commit: (intent: unknown, decide: (current: unknown, committedAt: unknown) => unknown) => {
            const allowed = (intent as { outcome?: unknown }).outcome === 'allowed';
            const terminal = decide(allowed ? executionCurrent() : null, nowSource());
            writeAudit(terminal);
            return terminal;
          } }) });
      activeExecutor = executor;
      const result = await executor.execute(handle);
      state = 'terminal';
      return result;
    } catch (error) {
      const mapped = mapError(error);
      if (began) { try { denySource(permitExecution); } catch { /* permit remains terminal */ } }
      if (!auditWritten) {
        try { denialAudit(policy, mapped.code === 'currentness_denied' ? 'currentness_denied' : 'plan_denied'); }
        catch { state = 'terminal'; throw new SemanticQueryOperationV1Error('audit_failed'); }
      }
      state = 'terminal';
      throw mapped;
    } finally {
      activeExecutor = null;
      if (state === 'pending') state = 'terminal';
    }
  };
  const cancel = (): boolean => {
    if (state !== 'pending' || !activeExecutor) return false;
    return activeExecutor.cancel();
  };
  const dispose = (): boolean => {
    if (state === 'terminal') return false;
    if (state === 'pending') activeExecutor?.cancel();
    state = 'terminal';
    return true;
  };
  return record({ execute, cancel, dispose });
}
