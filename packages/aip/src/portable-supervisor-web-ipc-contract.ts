/* @Codex */
import { types } from 'node:util';

export const PORTABLE_SUPERVISOR_WEB_IPC_MAX_FRAME_BYTES_V1 = 4 * 1024;
export const PORTABLE_SUPERVISOR_WEB_IPC_SCHEMA_V1 = 'mediflow.portable-supervisor.web-ipc.v1' as const;
export const PORTABLE_SUPERVISOR_WEB_CAPTURE_SCHEMA_V1 = 'mediflow.portable-supervisor.web-capture.v1' as const;

const REQUEST_REF = /^pswr_[0-9a-f]{32}$/u;
const CHALLENGE = /^pswc_[0-9a-f]{64}$/u;
const USER_REF = /^user\.[0-9a-f]{64}$/u;
const PARENT_REF = /^parent\.[0-9a-f]{64}$/u;
const HOST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CAPTURE_KEYS = ['schemaVersion', 'userRef', 'parentRef', 'patientId', 'ambulatoryId',
  'selectionEpoch', 'expectedPatientVersion', 'expiresAt'] as const;
const REVOKE_REASONS = new Set(['logout', 'application_lock', 'reselection', 'expiry', 'web_disconnect',
  'mcp_disconnect', 'restart', 'explicit']);
const DENIAL_CODES = new Set(['protocol_invalid', 'frame_too_large', 'replayed', 'challenge_invalid',
  'challenge_expired', 'context_invalid', 'context_stale', 'already_bound', 'host_unavailable',
  'activation_failed', 'revoke_failed', 'timeout']);

type CanonicalRecord = Record<string, unknown>;
export type PortableSupervisorWebCaptureV1 = Readonly<{
  schemaVersion: typeof PORTABLE_SUPERVISOR_WEB_CAPTURE_SCHEMA_V1;
  userRef: string; parentRef: string; patientId: string; ambulatoryId: string;
  selectionEpoch: number; expectedPatientVersion: number; expiresAt: number;
}>;
export type PortableSupervisorWebIpcFrameV1 = Readonly<CanonicalRecord>;

export class PortableSupervisorWebIpcV1Error extends Error {
  constructor(public readonly code: 'frame_invalid' | 'frame_too_large') {
    super(`Portable supervisor Web IPC rejected: ${code}`);
    this.name = 'PortableSupervisorWebIpcV1Error';
  }
}

function fail(code: 'frame_invalid' | 'frame_too_large' = 'frame_invalid'): never {
  throw new PortableSupervisorWebIpcV1Error(code);
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
    if (error instanceof PortableSupervisorWebIpcV1Error) throw error;
    return fail();
  }
}

function tag(value: unknown, key: string): unknown {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)
      || types.isPromise(value)) return fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
    return descriptor.value;
  } catch (error) {
    if (error instanceof PortableSupervisorWebIpcV1Error) throw error;
    return fail();
  }
}

function request(value: unknown): string {
  if (typeof value !== 'string' || !REQUEST_REF.test(value)) return fail();
  return value;
}

function challenge(value: unknown): string {
  if (typeof value !== 'string' || !CHALLENGE.test(value)) return fail();
  return value;
}

function capture(value: unknown): PortableSupervisorWebCaptureV1 {
  const parsed = exact(value, CAPTURE_KEYS);
  if (parsed.schemaVersion !== PORTABLE_SUPERVISOR_WEB_CAPTURE_SCHEMA_V1
    || typeof parsed.userRef !== 'string' || !USER_REF.test(parsed.userRef)
    || typeof parsed.parentRef !== 'string' || !PARENT_REF.test(parsed.parentRef)
    || typeof parsed.patientId !== 'string' || !HOST_ID.test(parsed.patientId)
    || typeof parsed.ambulatoryId !== 'string' || !HOST_ID.test(parsed.ambulatoryId)
    || !integer(parsed.selectionEpoch) || !integer(parsed.expectedPatientVersion, 1)
    || !integer(parsed.expiresAt, 1)) return fail();
  return record({ schemaVersion: PORTABLE_SUPERVISOR_WEB_CAPTURE_SCHEMA_V1,
    userRef: parsed.userRef, parentRef: parsed.parentRef, patientId: parsed.patientId,
    ambulatoryId: parsed.ambulatoryId, selectionEpoch: parsed.selectionEpoch,
    expectedPatientVersion: parsed.expectedPatientVersion, expiresAt: parsed.expiresAt });
}

function canonical(value: unknown): PortableSupervisorWebIpcFrameV1 {
  const method = tag(value, 'method');
  if (method === 'prepare') {
    const parsed = exact(value, ['schemaVersion', 'method', 'requestRef']);
    if (parsed.schemaVersion !== PORTABLE_SUPERVISOR_WEB_IPC_SCHEMA_V1) return fail();
    return record({ schemaVersion: PORTABLE_SUPERVISOR_WEB_IPC_SCHEMA_V1,
      method: 'prepare', requestRef: request(parsed.requestRef) });
  }
  if (method === 'activate') {
    const parsed = exact(value, ['schemaVersion', 'method', 'requestRef', 'challenge', 'capture']);
    if (parsed.schemaVersion !== PORTABLE_SUPERVISOR_WEB_IPC_SCHEMA_V1) return fail();
    return record({ schemaVersion: PORTABLE_SUPERVISOR_WEB_IPC_SCHEMA_V1, method: 'activate',
      requestRef: request(parsed.requestRef), challenge: challenge(parsed.challenge), capture: capture(parsed.capture) });
  }
  if (method === 'revoke_all') {
    const parsed = exact(value, ['schemaVersion', 'method', 'requestRef', 'reason']);
    if (parsed.schemaVersion !== PORTABLE_SUPERVISOR_WEB_IPC_SCHEMA_V1
      || typeof parsed.reason !== 'string' || !REVOKE_REASONS.has(parsed.reason)) return fail();
    return record({ schemaVersion: PORTABLE_SUPERVISOR_WEB_IPC_SCHEMA_V1, method: 'revoke_all',
      requestRef: request(parsed.requestRef), reason: parsed.reason });
  }
  if (method !== 'ack') return fail();
  const outcome = tag(value, 'outcome');
  if (outcome === 'prepared') {
    const parsed = exact(value, ['schemaVersion', 'method', 'requestRef', 'outcome', 'challenge', 'expiresAt']);
    if (parsed.schemaVersion !== PORTABLE_SUPERVISOR_WEB_IPC_SCHEMA_V1 || !integer(parsed.expiresAt, 1)) return fail();
    return record({ schemaVersion: PORTABLE_SUPERVISOR_WEB_IPC_SCHEMA_V1, method: 'ack',
      requestRef: request(parsed.requestRef), outcome: 'prepared', challenge: challenge(parsed.challenge),
      expiresAt: parsed.expiresAt });
  }
  if (outcome === 'activated') {
    const parsed = exact(value, ['schemaVersion', 'method', 'requestRef', 'outcome', 'expiresAt']);
    if (parsed.schemaVersion !== PORTABLE_SUPERVISOR_WEB_IPC_SCHEMA_V1 || !integer(parsed.expiresAt, 1)) return fail();
    return record({ schemaVersion: PORTABLE_SUPERVISOR_WEB_IPC_SCHEMA_V1, method: 'ack',
      requestRef: request(parsed.requestRef), outcome: 'activated', expiresAt: parsed.expiresAt });
  }
  if (outcome === 'revoked') {
    const parsed = exact(value, ['schemaVersion', 'method', 'requestRef', 'outcome']);
    if (parsed.schemaVersion !== PORTABLE_SUPERVISOR_WEB_IPC_SCHEMA_V1) return fail();
    return record({ schemaVersion: PORTABLE_SUPERVISOR_WEB_IPC_SCHEMA_V1,
      method: 'ack', requestRef: request(parsed.requestRef), outcome: 'revoked' });
  }
  if (outcome === 'denied') {
    const parsed = exact(value, ['schemaVersion', 'method', 'requestRef', 'outcome', 'denialCode']);
    if (parsed.schemaVersion !== PORTABLE_SUPERVISOR_WEB_IPC_SCHEMA_V1
      || typeof parsed.denialCode !== 'string' || !DENIAL_CODES.has(parsed.denialCode)) return fail();
    return record({ schemaVersion: PORTABLE_SUPERVISOR_WEB_IPC_SCHEMA_V1, method: 'ack',
      requestRef: request(parsed.requestRef), outcome: 'denied', denialCode: parsed.denialCode });
  }
  return fail();
}

export function encodePortableSupervisorWebIpcFrameV1(value: unknown): string {
  const encoded = JSON.stringify(canonical(value));
  if (Buffer.byteLength(encoded, 'utf8') > PORTABLE_SUPERVISOR_WEB_IPC_MAX_FRAME_BYTES_V1) {
    return fail('frame_too_large');
  }
  return encoded;
}

export function decodePortableSupervisorWebIpcFrameV1(value: unknown): PortableSupervisorWebIpcFrameV1 {
  if (typeof value !== 'string') return fail();
  if (Buffer.byteLength(value, 'utf8') > PORTABLE_SUPERVISOR_WEB_IPC_MAX_FRAME_BYTES_V1) {
    return fail('frame_too_large');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return fail(); }
  const output = canonical(parsed);
  if (JSON.stringify(output) !== value) return fail();
  return output;
}
