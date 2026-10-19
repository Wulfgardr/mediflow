import { types } from 'node:util';
import { parseProfileQuery, isProfileResult, assertProfileResultBudget, PROFILE_FIELD_NAMES, PROFILE_QUERY_OPERATION_ID,
  type ProfileQuery, type ProfileResult, type ProfileQueryErrorCode } from '../../patient-profile-contracts/src/query.ts';

export const PATIENT_PROFILE_QUERY_IPC_SCHEMA_V1 = 'mediflow.patient-profile.ipc.v1' as const;
export const PATIENT_PROFILE_QUERY_IPC_MAX_FRAME_BYTES_V1 = 48 * 1024;
export type PatientProfileQueryIpcFrameV1 =
  | Readonly<{ schemaVersion: typeof PATIENT_PROFILE_QUERY_IPC_SCHEMA_V1; type: 'query'; requestRef: string;
    operationId: typeof PROFILE_QUERY_OPERATION_ID; input: ProfileQuery }>
  | Readonly<{ schemaVersion: typeof PATIENT_PROFILE_QUERY_IPC_SCHEMA_V1; type: 'query_result'; requestRef: string;
    operationId: typeof PROFILE_QUERY_OPERATION_ID; outcome: 'completed'; result: ProfileResult }>
  | Readonly<{ schemaVersion: typeof PATIENT_PROFILE_QUERY_IPC_SCHEMA_V1; type: 'query_result'; requestRef: string;
    operationId: typeof PROFILE_QUERY_OPERATION_ID; outcome: 'denied'; denialCode: ProfileQueryErrorCode }>;
const DENIALS = new Set(['input_invalid', 'session_unavailable', 'scope_denied', 'selection_conflict',
  'handle_unavailable', 'handle_expired', 'revision_conflict', 'query_unavailable', 'cancelled', 'output_too_large']);
const REQUEST_REF = /^ppqr_[0-9a-f]{32}$/u;
function fail(): never { throw new Error('patient_profile_ipc_invalid'); }
function record<T extends object>(value: T): Readonly<T> { return Object.freeze(Object.assign(Object.create(null), value)); }
function field(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value) || types.isPromise(value)) return fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor?.enumerable && 'value' in descriptor ? descriptor.value : fail();
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  field(value, keys[0]!);
  const prototype = Object.getPrototypeOf(value), own = Reflect.ownKeys(value as object);
  if ((prototype !== null && prototype !== Object.prototype) || own.length !== keys.length
    || own.some(key => typeof key !== 'string' || !keys.includes(key))) return fail();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) result[key] = field(value, key);
  return record(result);
}
function query(value: unknown): ProfileQuery {
  const kind = field(value, 'kind');
  const parsed = exact(value, kind === 'open' ? ['kind', 'contractVersion', 'projection', 'expectedSelectionEpoch']
    : ['kind', 'contractVersion', 'projection', 'handle', 'expectedRevision']);
  return parseProfileQuery(parsed) ?? fail();
}
function result(value: unknown): ProfileResult {
  const parsed = exact(value, ['schemaVersion', 'operationId', 'contractVersion', 'handle', 'projection', 'currentness', 'profile']);
  const currentness = exact(parsed.currentness, ['revision', 'selectionEpoch', 'observedAt', 'expiresAt']);
  const profile = exact(parsed.profile, parsed.projection === 'profile' ? PROFILE_FIELD_NAMES : ['notes']);
  const output = record({ ...parsed, currentness, profile });
  if (!isProfileResult(output)) return fail();
  assertProfileResultBudget(output); return output;
}
function canonical(value: unknown): PatientProfileQueryIpcFrameV1 {
  const type = field(value, 'type');
  if (type === 'query') {
    const v = exact(value, ['schemaVersion', 'type', 'requestRef', 'operationId', 'input']);
    if (v.schemaVersion !== PATIENT_PROFILE_QUERY_IPC_SCHEMA_V1 || v.operationId !== PROFILE_QUERY_OPERATION_ID
      || typeof v.requestRef !== 'string' || !REQUEST_REF.test(v.requestRef)) return fail();
    return record({ schemaVersion: PATIENT_PROFILE_QUERY_IPC_SCHEMA_V1, type, requestRef: v.requestRef,
      operationId: PROFILE_QUERY_OPERATION_ID, input: query(v.input) });
  }
  if (type !== 'query_result') return fail();
  const outcome = field(value, 'outcome');
  const v = exact(value, ['schemaVersion', 'type', 'requestRef', 'operationId', 'outcome',
    outcome === 'completed' ? 'result' : 'denialCode']);
  if (v.schemaVersion !== PATIENT_PROFILE_QUERY_IPC_SCHEMA_V1 || v.operationId !== PROFILE_QUERY_OPERATION_ID
    || typeof v.requestRef !== 'string' || !REQUEST_REF.test(v.requestRef)) return fail();
  if (outcome === 'completed') return record({ schemaVersion: PATIENT_PROFILE_QUERY_IPC_SCHEMA_V1, type,
    requestRef: v.requestRef, operationId: PROFILE_QUERY_OPERATION_ID, outcome: 'completed' as const, result: result(v.result) });
  if (outcome !== 'denied' || typeof v.denialCode !== 'string' || !DENIALS.has(v.denialCode)) return fail();
  return record({ schemaVersion: PATIENT_PROFILE_QUERY_IPC_SCHEMA_V1, type, requestRef: v.requestRef,
    operationId: PROFILE_QUERY_OPERATION_ID, outcome: 'denied' as const, denialCode: v.denialCode as ProfileQueryErrorCode });
}
export function encodePatientProfileQueryIpcFrameV1(value: unknown): string {
  const encoded = JSON.stringify(canonical(value));
  if (Buffer.byteLength(encoded, 'utf8') > PATIENT_PROFILE_QUERY_IPC_MAX_FRAME_BYTES_V1) return fail();
  return encoded;
}
export function decodePatientProfileQueryIpcFrameV1(value: unknown): PatientProfileQueryIpcFrameV1 {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > PATIENT_PROFILE_QUERY_IPC_MAX_FRAME_BYTES_V1) return fail();
  let parsed: unknown; try { parsed = JSON.parse(value); } catch { return fail(); }
  const output = canonical(parsed);
  return JSON.stringify(output) === value ? output : fail();
}
