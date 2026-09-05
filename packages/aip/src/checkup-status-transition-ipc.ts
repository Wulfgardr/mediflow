/* @Codex */
import { types } from 'node:util';

export const CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1 = 'mediflow.checkup-status.ipc.v1' as const;
export const CHECKUP_STATUS_TRANSITION_IPC_MAX_FRAME_BYTES_V1 = 4 * 1024;

const OPERATION = 'mediflow.patient.checkup.status.transition.v1';
const INPUT_SCHEMA = 'mediflow.patient.checkup.status.transition.input.v1';
const REQUEST_REF = /^hcqr_[0-9a-f]{32}$/u;
const CHECKUP_REF = /^hcsr_[0-9a-f]{64}$/u;
const PROPOSAL_REF = /^hcsp_[0-9a-f]{64}$/u;
const DENIALS = new Set(['invalid_input', 'operation_unavailable', 'resource_unavailable', 'scope_changed',
  'session_unavailable', 'role_unavailable', 'preview_expired', 'confirmation_required', 'proof_unavailable',
  'proof_replayed', 'revision_conflict', 'transition_unavailable', 'idempotency_conflict', 'audit_unavailable',
  'commit_unavailable', 'restart_changed']);

type CanonicalRecord = Record<string, unknown>;
export type CheckupStatusTransitionIpcFrameV1 = Readonly<CanonicalRecord>;

export class CheckupStatusTransitionIpcV1Error extends Error {
  constructor(public readonly code: 'frame_invalid' | 'frame_too_large') {
    super(`Checkup status transition IPC rejected: ${code}`);
    this.name = 'CheckupStatusTransitionIpcV1Error';
  }
}

function fail(code: 'frame_invalid' | 'frame_too_large' = 'frame_invalid'): never {
  throw new CheckupStatusTransitionIpcV1Error(code);
}
function record<T extends CanonicalRecord>(value: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, value));
}
function integer(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}
function exact(value: unknown, keys: readonly string[]): CanonicalRecord {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)
      || types.isPromise(value)) return fail();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) return fail();
    const own = Reflect.ownKeys(value);
    if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) return fail();
    const output = Object.create(null) as CanonicalRecord;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
      output[key] = descriptor.value;
    }
    return output;
  } catch (error) {
    if (error instanceof CheckupStatusTransitionIpcV1Error) throw error;
    return fail();
  }
}
function tag(value: unknown, key: string): unknown {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)
      || types.isPromise(value)) return fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && 'value' in descriptor ? descriptor.value : fail();
  } catch (error) {
    if (error instanceof CheckupStatusTransitionIpcV1Error) throw error;
    return fail();
  }
}
function requestRef(value: unknown): string {
  return typeof value === 'string' && REQUEST_REF.test(value) ? value : fail();
}
function input(value: unknown): Readonly<CanonicalRecord> {
  const parsed = exact(value, ['schemaVersion', 'operationId', 'checkupRef', 'targetStatus', 'expectedRevision']);
  if (parsed.schemaVersion !== INPUT_SCHEMA || parsed.operationId !== OPERATION
    || typeof parsed.checkupRef !== 'string' || !CHECKUP_REF.test(parsed.checkupRef)
    || (parsed.targetStatus !== 'completed' && parsed.targetStatus !== 'cancelled')
    || !integer(parsed.expectedRevision, 1) || parsed.expectedRevision === Number.MAX_SAFE_INTEGER) return fail();
  return record({ schemaVersion: INPUT_SCHEMA, operationId: OPERATION, checkupRef: parsed.checkupRef,
    targetStatus: parsed.targetStatus, expectedRevision: parsed.expectedRevision });
}
function canonical(value: unknown): CheckupStatusTransitionIpcFrameV1 {
  const type = tag(value, 'type');
  if (type === 'preview') {
    const parsed = exact(value, ['schemaVersion', 'type', 'requestRef', 'operationId', 'input']);
    if (parsed.schemaVersion !== CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1 || parsed.operationId !== OPERATION) return fail();
    return record({ schemaVersion: CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1, type, requestRef: requestRef(parsed.requestRef),
      operationId: OPERATION, input: input(parsed.input) });
  }
  if (type !== 'preview_result') return fail();
  const outcome = tag(value, 'outcome');
  if (outcome === 'proposed') {
    const parsed = exact(value, ['schemaVersion', 'type', 'requestRef', 'operationId', 'outcome', 'proposalRef', 'expiresAt']);
    if (parsed.schemaVersion !== CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1 || parsed.operationId !== OPERATION
      || typeof parsed.proposalRef !== 'string' || !PROPOSAL_REF.test(parsed.proposalRef)
      || !integer(parsed.expiresAt, 1)) return fail();
    return record({ schemaVersion: CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1, type, requestRef: requestRef(parsed.requestRef),
      operationId: OPERATION, outcome, proposalRef: parsed.proposalRef, expiresAt: parsed.expiresAt });
  }
  const parsed = exact(value, ['schemaVersion', 'type', 'requestRef', 'operationId', 'outcome', 'denialCode']);
  if (parsed.schemaVersion !== CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1 || parsed.operationId !== OPERATION
    || outcome !== 'denied' || typeof parsed.denialCode !== 'string' || !DENIALS.has(parsed.denialCode)) return fail();
  return record({ schemaVersion: CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1, type, requestRef: requestRef(parsed.requestRef),
    operationId: OPERATION, outcome, denialCode: parsed.denialCode });
}

export function encodeCheckupStatusTransitionIpcFrameV1(value: unknown): string {
  const encoded = JSON.stringify(canonical(value));
  return Buffer.byteLength(encoded, 'utf8') <= CHECKUP_STATUS_TRANSITION_IPC_MAX_FRAME_BYTES_V1
    ? encoded : fail('frame_too_large');
}

export function decodeCheckupStatusTransitionIpcFrameV1(value: unknown): CheckupStatusTransitionIpcFrameV1 {
  if (typeof value !== 'string') return fail();
  if (Buffer.byteLength(value, 'utf8') > CHECKUP_STATUS_TRANSITION_IPC_MAX_FRAME_BYTES_V1) return fail('frame_too_large');
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return fail(); }
  const output = canonical(parsed);
  return JSON.stringify(output) === value ? output : fail();
}
