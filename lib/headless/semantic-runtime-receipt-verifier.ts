import { types } from 'node:util';
import type { SemanticOutcome, SemanticReceipt } from './semantic-runtime';

/* @Codex */
export type SemanticCoverageReceipt = Readonly<{
  schema: 'mediflow.headless.semantic-coverage-receipt.v1';
  applyPolicy: 'none'; writesPerformed: 0;
  verifiedActions: readonly Readonly<{
    actionRef: string; operationId: string; capabilityId: string;
    applicationServiceRef: string; stage: SemanticOutcome; outcome: SemanticOutcome;
    revisionBinding: string; resultRef: string;
  }>[];
}>;

type GraphOperation = Readonly<{
  operationId: string; capabilityId: string; applicationServiceRef: string;
  maximumStage: SemanticOutcome; authorityPolicy: 'read_only';
}>;
type ExpectedAction = Readonly<{
  requestRef: string; actionRef: string; operationId: string; capabilityId: string;
  applicationServiceRef: string; stage: SemanticOutcome; outcome: SemanticOutcome;
  revisionBinding: string; resultRef: string;
}>;
const TOKEN = /^[a-zA-Z0-9._:-]{1,160}$/;
const STAGES: readonly SemanticOutcome[] = ['discovery', 'read', 'query', 'orchestration', 'preview', 'proposal'];
const stageIndex = new Map(STAGES.map((stage, index) => [stage, index]));
const invalid = (): never => { throw new TypeError('invalid synthetic semantic receipt batch'); };
const token = (value: unknown): value is string => typeof value === 'string' && TOKEN.test(value);
const stage = (value: unknown): value is SemanticOutcome => typeof value === 'string' && stageIndex.has(value as SemanticOutcome);
function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value); if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length) return null;
    const names = Object.getOwnPropertyNames(value); if (names.length !== keys.length || names.some(name => !keys.includes(name))) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (names.some(name => !('value' in descriptors[name]!) || descriptors[name]!.enumerable !== true)) return null;
    return value as Record<string, unknown>;
  } catch { return null; }
}
function list(value: unknown): readonly unknown[] | null {
  if (value === null || typeof value !== 'object' || !Array.isArray(value) || types.isProxy(value)) return null;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length) return null;
    const length = Object.getOwnPropertyDescriptor(value, 'length'); if (!length || !('value' in length) || !Number.isSafeInteger(length.value)) return null;
    const names = Object.getOwnPropertyNames(value); if (names.length !== length.value + 1 || !names.includes('length')) return null;
    for (let index = 0; index < length.value; index += 1) { const item = Object.getOwnPropertyDescriptor(value, String(index)); if (!item || !('value' in item) || item.enumerable !== true) return null; }
    return value;
  } catch { return null; }
}
function graph(value: unknown): readonly GraphOperation[] | null {
  const outer = record(value, ['operations']); const operations = outer ? list(outer.operations) : null;
  if (!operations || operations.length < 1 || operations.length > 32) return null;
  const output: GraphOperation[] = [];
  for (let index = 0; index < operations.length; index += 1) {
    const item = record(operations[index], ['operationId', 'capabilityId', 'applicationServiceRef', 'maximumStage', 'authorityPolicy']);
    if (!item || !token(item.operationId) || !token(item.capabilityId) || !token(item.applicationServiceRef) || !stage(item.maximumStage) || item.authorityPolicy !== 'read_only' || output.some(entry => entry.operationId === item.operationId)) return null;
    output.push(Object.freeze({ operationId: item.operationId, capabilityId: item.capabilityId, applicationServiceRef: item.applicationServiceRef, maximumStage: item.maximumStage, authorityPolicy: 'read_only' }));
  }
  return Object.freeze(output);
}
function actions(value: unknown): readonly ExpectedAction[] | null {
  const values = list(value); if (!values || values.length < 1 || values.length > 32) return null;
  const output: ExpectedAction[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const item = record(values[index], ['requestRef', 'actionRef', 'operationId', 'capabilityId', 'applicationServiceRef', 'stage', 'outcome', 'revisionBinding', 'resultRef']);
    if (!item || !token(item.requestRef) || !token(item.actionRef) || !token(item.operationId) || !token(item.capabilityId) || !token(item.applicationServiceRef) || !stage(item.stage) || !stage(item.outcome) || !token(item.revisionBinding) || !token(item.resultRef) || output.some(entry => entry.actionRef === item.actionRef)) return null;
    output.push(Object.freeze({ requestRef: item.requestRef, actionRef: item.actionRef, operationId: item.operationId, capabilityId: item.capabilityId, applicationServiceRef: item.applicationServiceRef, stage: item.stage, outcome: item.outcome, revisionBinding: item.revisionBinding, resultRef: item.resultRef }));
  }
  return Object.freeze(output);
}
function receipts(value: unknown): readonly SemanticReceipt[] | null {
  const outer = record(value, ['receipts']); const values = outer ? list(outer.receipts) : null;
  if (!values || values.length < 1 || values.length > 32) return null;
  const output: SemanticReceipt[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const item = record(values[index], ['schema', 'requestRef', 'actionRef', 'operationId', 'capabilityId', 'outcome', 'policyDecision', 'revisionBinding', 'createdAt', 'applyPolicy', 'writesPerformed', 'resultRef']);
    if (!item || item.schema !== 'mediflow.headless.receipt.v1' || !token(item.requestRef) || !token(item.actionRef) || !token(item.operationId) || !token(item.capabilityId) || !stage(item.outcome) || item.policyDecision !== 'executed' || !token(item.revisionBinding) || !token(item.createdAt) || item.applyPolicy !== 'none' || item.writesPerformed !== 0 || !token(item.resultRef)) return null;
    output.push(item as SemanticReceipt);
  }
  return Object.freeze(output);
}
function coverage(action: ExpectedAction): SemanticCoverageReceipt['verifiedActions'][number] {
  return Object.freeze(Object.assign(Object.create(null), { actionRef: action.actionRef, operationId: action.operationId, capabilityId: action.capabilityId, applicationServiceRef: action.applicationServiceRef, stage: action.stage, outcome: action.outcome, revisionBinding: action.revisionBinding, resultRef: action.resultRef }));
}
export function verifySemanticRuntimeReceiptBatch(rawGraph: unknown, rawActions: unknown, rawBatch: unknown): SemanticCoverageReceipt {
  const operations = graph(rawGraph); const expected = actions(rawActions); const batch = receipts(rawBatch);
  if (!operations || !expected || !batch || operations.length !== expected.length || expected.length !== batch.length) return invalid();
  const verified: SemanticCoverageReceipt['verifiedActions'][number][] = [];
  for (let index = 0; index < expected.length; index += 1) {
    const operation = operations[index]!; const action = expected[index]!; const receipt = batch[index]!;
    if (operation.operationId !== action.operationId || operation.capabilityId !== action.capabilityId || operation.applicationServiceRef !== action.applicationServiceRef || (stageIndex.get(action.stage)! > stageIndex.get(operation.maximumStage)!) || receipt.requestRef !== action.requestRef || receipt.actionRef !== action.actionRef || receipt.operationId !== action.operationId || receipt.capabilityId !== action.capabilityId || receipt.outcome !== action.outcome || receipt.revisionBinding !== action.revisionBinding || receipt.resultRef !== action.resultRef) return invalid();
    verified.push(coverage(action));
  }
  return Object.freeze(Object.assign(Object.create(null), { schema: 'mediflow.headless.semantic-coverage-receipt.v1' as const, applyPolicy: 'none' as const, writesPerformed: 0 as const, verifiedActions: Object.freeze(verified) }));
}
