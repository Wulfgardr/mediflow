import { createHash } from 'node:crypto';
import { types } from 'node:util';

/* @Codex */
export type SemanticOutcome = 'discovery' | 'read' | 'query' | 'orchestration' | 'preview' | 'proposal';
type DenialCode = 'reentry' | 'registry_invalid' | 'invalid_plan' | 'invalid_session' | 'session_inactive' | 'session_revoked' | 'lease_stale' | 'operation_limit' | 'operation_unbound' | 'operation_unauthorized' | 'stage_exceeded' | 'forbidden_input' | 'idempotency_conflict' | 'host_threw' | 'host_result_invalid';

export type SemanticOperation = Readonly<{
  operationId: string;
  capabilityId: string;
  applicationServiceRef: string;
  maximumStage: SemanticOutcome;
  authorityPolicy: 'read_only';
  execute: (input: Readonly<Record<string, unknown>>) => Readonly<{ outcome: SemanticOutcome; resultRef: string }>;
}>;

export type SemanticReceipt = Readonly<{
  schema: 'mediflow.headless.receipt.v1'; requestRef: string; actionRef: string; operationId: string; capabilityId: string;
  outcome: SemanticOutcome | 'denial'; policyDecision: 'executed' | 'replay' | 'denied'; revisionBinding: string; createdAt: string;
  applyPolicy: 'none'; writesPerformed: 0; resultRef?: string; denialCode?: DenialCode;
}>;

export type SemanticRuntime = Readonly<{ execute(plan: unknown, session: unknown): Readonly<{ receipts: readonly SemanticReceipt[] }> }>;

const STAGES: readonly SemanticOutcome[] = ['discovery', 'read', 'query', 'orchestration', 'preview', 'proposal'];
const STAGE_INDEX = new Map(STAGES.map((stage, index) => [stage, index]));
const TOKEN = /^[a-zA-Z0-9._:-]{1,160}$/;
const FORBIDDEN_KEYS = new Set(['provider', 'venue', 'egress', 'prompt', 'sql', 'sqlite', 'pin', 'credential', 'credentials', 'cookie', 'token', 'patientid', 'clinicalpayload', 'modeloutput', 'name', 'codicefiscale']);
const nativePromiseThen = Promise.prototype.then;
const FORBIDDEN_INPUT = Symbol('forbidden_input');

type Action = Readonly<{ actionRef: string; operationId: string; capabilityId: string; applicationServiceRef: string; stage: SemanticOutcome; idempotencyKey: string; input: Readonly<Record<string, unknown>> }>;
type Plan = Readonly<{ requestRef: string; actions: readonly Action[] }>;
type Session = Readonly<{ sessionRef: string; active: boolean; activeRole: string; leaseEpoch: number; revoked: boolean; authorizedCapabilityIds: readonly string[] }>;
type Stored = Readonly<{ digest: string; receipt: SemanticReceipt }>;

function own(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  if (types.isProxy(value)) return null;
  if (Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const names = Object.getOwnPropertyNames(value);
    if (names.length !== keys.length || names.some((name) => !keys.includes(name)) || Object.getOwnPropertySymbols(value).length) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (names.some((name) => !('value' in descriptors[name]!) || descriptors[name]!.enumerable !== true)) return null;
    return value as Record<string, unknown>;
  } catch { return null; }
}

function array(value: unknown): readonly unknown[] | null {
  if (value === null || typeof value !== 'object' || types.isProxy(value) || !Array.isArray(value)) return null;
  return value;
}

function text(value: unknown): string | null { return typeof value === 'string' && TOKEN.test(value) ? value : null; }
function stage(value: unknown): SemanticOutcome | null { return typeof value === 'string' && STAGE_INDEX.has(value as SemanticOutcome) ? value as SemanticOutcome : null; }
function frozen<T extends object>(value: T): Readonly<T> { return Object.freeze(value); }
function nullRecord<T extends object>(value: T): Readonly<T> { return Object.freeze(Object.assign(Object.create(null) as T, value)); }

function safeValue(value: unknown, depth = 0): unknown | null | typeof FORBIDDEN_INPUT {
  if (depth > 8 || value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'object' && types.isProxy(value)) return null;
  const itemsValue = array(value);
  if (itemsValue) {
    if (itemsValue.length > 64) return null;
    const items = itemsValue.map(item => safeValue(item, depth + 1));
    return items.includes(FORBIDDEN_INPUT) ? FORBIDDEN_INPUT : items.some(item => item === null) ? null : frozen(items);
  }
  if (typeof value !== 'object') return null;
  try {
    const record = own(value, Object.getOwnPropertyNames(value));
    if (!record) return null;
    const copy: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(record)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) return FORBIDDEN_INPUT;
      const item = safeValue(record[key], depth + 1);
      if (item === FORBIDDEN_INPUT) return FORBIDDEN_INPUT;
      if (item === null) return null;
      copy[key] = item;
    }
    return nullRecord(copy);
  } catch { return null; }
}

function normalizePlan(value: unknown): Plan | null | typeof FORBIDDEN_INPUT {
  const record = own(value, ['requestRef', 'actions']); const rawActions = record ? array(record.actions) : null; if (!record || !text(record.requestRef) || !rawActions || rawActions.length < 1 || rawActions.length > 32) return null;
  const actions: Action[] = [];
  for (const item of rawActions) {
    const action = own(item, ['actionRef', 'operationId', 'capabilityId', 'applicationServiceRef', 'stage', 'idempotencyKey', 'input']);
    if (!action) return null;
    const input = safeValue(action.input);
    if (input === FORBIDDEN_INPUT) return FORBIDDEN_INPUT;
    if (!text(action.actionRef) || !text(action.operationId) || !text(action.capabilityId) || !text(action.applicationServiceRef) || !stage(action.stage) || !text(action.idempotencyKey) || !input || Array.isArray(input)) return null;
    actions.push(frozen({ actionRef: action.actionRef as string, operationId: action.operationId as string, capabilityId: action.capabilityId as string, applicationServiceRef: action.applicationServiceRef as string, stage: action.stage as SemanticOutcome, idempotencyKey: action.idempotencyKey as string, input: input as Readonly<Record<string, unknown>> }));
  }
  return frozen({ requestRef: record.requestRef as string, actions: frozen(actions) });
}

function normalizeSession(value: unknown): Session | null {
  const record = own(value, ['sessionRef', 'active', 'activeRole', 'leaseEpoch', 'revoked', 'authorizedCapabilityIds']);
  const rawCapabilities = record ? array(record.authorizedCapabilityIds) : null;
  if (!record || !text(record.sessionRef) || !text(record.activeRole) || typeof record.active !== 'boolean' || typeof record.revoked !== 'boolean' || !Number.isSafeInteger(record.leaseEpoch) || (record.leaseEpoch as number) < 1 || !rawCapabilities) return null;
  const capabilities = rawCapabilities.map(text); if (capabilities.some(item => !item)) return null;
  return frozen({ sessionRef: record.sessionRef as string, active: record.active as boolean, activeRole: record.activeRole as string, leaseEpoch: record.leaseEpoch as number, revoked: record.revoked as boolean, authorizedCapabilityIds: frozen(capabilities as string[]) });
}

function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest('hex'); }
function promiseLike(value: object): boolean {
  try { let cursor: object | null = value; for (let depth = 0; cursor && depth < 8; depth += 1, cursor = Object.getPrototypeOf(cursor)) if (cursor === Promise.prototype) { void nativePromiseThen.call(value as Promise<unknown>, undefined, () => undefined); return true; } } catch { return true; }
  return false;
}

export function createSemanticRuntime(registry: unknown, options: Readonly<{ maxOperations?: number }> = {}): SemanticRuntime {
  const rawEntries = array(registry);
  const entries = rawEntries ?? [];
  const operations = new Map<string, SemanticOperation>(); let registryInvalid = !rawEntries || !Number.isSafeInteger(options.maxOperations ?? 32) || (options.maxOperations ?? 32) < 1 || (options.maxOperations ?? 32) > 32;
  if (!registryInvalid) for (const entry of entries) {
    const record = own(entry, ['operationId', 'capabilityId', 'applicationServiceRef', 'maximumStage', 'authorityPolicy', 'execute']);
    if (!record || !text(record.operationId) || !text(record.capabilityId) || !text(record.applicationServiceRef) || !stage(record.maximumStage) || record.authorityPolicy !== 'read_only' || typeof record.execute !== 'function' || operations.has(record.operationId as string)) { registryInvalid = true; break; }
    operations.set(record.operationId as string, frozen({ operationId: record.operationId as string, capabilityId: record.capabilityId as string, applicationServiceRef: record.applicationServiceRef as string, maximumStage: record.maximumStage as SemanticOutcome, authorityPolicy: 'read_only', execute: record.execute as SemanticOperation['execute'] }));
  }
  let executing = false; let tick = 0; const leases = new Map<string, number>(); const ledger = new Map<string, Stored>(); const limit = options.maxOperations ?? 32;
  const deny = (code: DenialCode, requestRef = 'invalid', action: Partial<Action> = {}): SemanticReceipt => nullRecord({ schema: 'mediflow.headless.receipt.v1', requestRef, actionRef: action.actionRef ?? 'invalid', operationId: action.operationId ?? 'invalid', capabilityId: action.capabilityId ?? 'invalid', outcome: 'denial', policyDecision: 'denied', revisionBinding: 'unbound', createdAt: `runtime:${++tick}`, applyPolicy: 'none', writesPerformed: 0, denialCode: code });
  const execute = (rawPlan: unknown, rawSession: unknown): Readonly<{ receipts: readonly SemanticReceipt[] }> => {
    if (executing) return frozen({ receipts: frozen([deny('reentry')]) });
    try {
      if (registryInvalid) return frozen({ receipts: frozen([deny('registry_invalid')]) });
      const plan = normalizePlan(rawPlan); if (plan === FORBIDDEN_INPUT) return frozen({ receipts: frozen([deny('forbidden_input')]) }); if (!plan) return frozen({ receipts: frozen([deny('invalid_plan')]) });
      const session = normalizeSession(rawSession); if (!session) return frozen({ receipts: frozen([deny('invalid_session', plan.requestRef)]) });
      const first = plan.actions[0]!;
      if (session.revoked) return frozen({ receipts: frozen([deny('session_revoked', plan.requestRef, first)]) });
      if (!session.active || !session.activeRole) return frozen({ receipts: frozen([deny('session_inactive', plan.requestRef, first)]) });
      if ((leases.get(session.sessionRef) ?? 0) > session.leaseEpoch) return frozen({ receipts: frozen([deny('lease_stale', plan.requestRef, first)]) });
      leases.set(session.sessionRef, session.leaseEpoch);
      if (plan.actions.length > limit) return frozen({ receipts: frozen([deny('operation_limit', plan.requestRef, first)]) });
      for (const action of plan.actions) { const operation = operations.get(action.operationId); if (!operation || operation.capabilityId !== action.capabilityId || operation.applicationServiceRef !== action.applicationServiceRef) return frozen({ receipts: frozen([deny('operation_unbound', plan.requestRef, action)]) }); if (!session.authorizedCapabilityIds.includes(operation.capabilityId)) return frozen({ receipts: frozen([deny('operation_unauthorized', plan.requestRef, action)]) }); if ((STAGE_INDEX.get(action.stage) ?? 99) > (STAGE_INDEX.get(operation.maximumStage) ?? -1)) return frozen({ receipts: frozen([deny('stage_exceeded', plan.requestRef, action)]) }); }
      executing = true; const receipts: SemanticReceipt[] = [];
      for (const action of plan.actions) {
        const operation = operations.get(action.operationId)!; const scope = `${session.sessionRef}\0${operation.operationId}\0${action.idempotencyKey}`; const operationDigest = digest({ operationId: action.operationId, capabilityId: action.capabilityId, applicationServiceRef: action.applicationServiceRef, stage: action.stage, input: action.input }); const previous = ledger.get(scope);
        if (previous) { receipts.push(previous.digest === operationDigest ? nullRecord({ ...previous.receipt, policyDecision: 'replay' as const }) : deny('idempotency_conflict', plan.requestRef, action)); continue; }
        let host: unknown; try { host = operation.execute(action.input); } catch { const receipt = deny('host_threw', plan.requestRef, action); ledger.set(scope, frozen({ digest: operationDigest, receipt })); receipts.push(receipt); continue; }
        const output = host && typeof host === 'object' && !types.isProxy(host) && !promiseLike(host) ? own(host, ['outcome', 'resultRef']) : null;
        if (!output || !stage(output.outcome) || !text(output.resultRef) || (STAGE_INDEX.get(output.outcome as SemanticOutcome) ?? 99) > (STAGE_INDEX.get(operation.maximumStage) ?? -1)) { const receipt = deny('host_result_invalid', plan.requestRef, action); ledger.set(scope, frozen({ digest: operationDigest, receipt })); receipts.push(receipt); continue; }
        const receipt: SemanticReceipt = nullRecord({ schema: 'mediflow.headless.receipt.v1' as const, requestRef: plan.requestRef, actionRef: action.actionRef, operationId: operation.operationId, capabilityId: operation.capabilityId, outcome: output.outcome as SemanticOutcome, policyDecision: 'executed' as const, revisionBinding: `lease:${session.leaseEpoch}`, createdAt: `runtime:${++tick}`, applyPolicy: 'none' as const, writesPerformed: 0 as const, resultRef: output.resultRef as string }); ledger.set(scope, frozen({ digest: operationDigest, receipt })); receipts.push(receipt);
      }
      return frozen({ receipts: frozen(receipts) });
    } catch { return frozen({ receipts: frozen([deny('invalid_plan')]) }); } finally { executing = false; }
  };
  return frozen({ execute });
}
