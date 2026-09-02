/* @Codex */
import 'server-only';

import { types } from 'node:util';

const ENROLLMENT_SCHEMA = 'mediflow.headless-checkup-active-role-enrollment.v1' as const;
const ATTESTATION_SCHEMA = 'mediflow.headless-checkup-active-role-attestation.v1' as const;
const OPERATION = 'mediflow.patient.checkup.status.transition.v1' as const;
const POLICY = 'physician_confirmed_single_use.v1' as const;
const TTL_MS = 8 * 60 * 60 * 1_000;
const SESSION = ['id', 'userId', 'username', 'role', 'authChannel', 'createdAt', 'expiresAt'] as const;
const ATTESTATION = ['attestationRef', 'actorRef', 'schemaVersion', 'role', 'operationId', 'policyVersion',
  'status', 'attestationVersion', 'issuerRef', 'expiresAt', 'activatedAt', 'revocationGeneration',
  'revokedAt', 'createdAt', 'updatedAt'] as const;
const SESSION_REF = /^[0-9a-f]{64}$/u, ATTESTATION_REF = /^hcar_[0-9a-f]{32}$/u;
const ISSUER_REF = /^hcari_[0-9a-f]{32}$/u;

type Canonical = Record<string, unknown>;
export type HeadlessCheckupActiveRoleEnrollmentLifecycleResult = Readonly<{
  kind: 'ok'; value: unknown;
}> | Readonly<{ kind: 'missing' | 'conflict' | 'unavailable' }>;
export type HeadlessCheckupActiveRoleEnrollmentSources = Readonly<{
  now(): unknown;
  resolveCurrentWebAdmin(): Promise<unknown>;
  verifyAdminPin(input: unknown): Promise<unknown>;
  readAttestation(actorRef: string): HeadlessCheckupActiveRoleEnrollmentLifecycleResult;
  createInactive(actorRef: string): HeadlessCheckupActiveRoleEnrollmentLifecycleResult;
  activate(actorRef: string): HeadlessCheckupActiveRoleEnrollmentLifecycleResult;
}>;
export type HeadlessCheckupActiveRoleEnrollmentProjectionV1 = Readonly<{
  schemaVersion: typeof ENROLLMENT_SCHEMA; status: 'active'; attestationVersion: 1;
}>;
export class HeadlessCheckupActiveRoleEnrollmentError extends Error {
  constructor(readonly code: 'enrollment_denied' | 'enrollment_conflict' | 'storage_unavailable') {
    super(`Headless checkup active-role enrollment rejected: ${code}`);
    this.name = 'HeadlessCheckupActiveRoleEnrollmentError';
  }
}
function fail(code: ConstructorParameters<typeof HeadlessCheckupActiveRoleEnrollmentError>[0]): never {
  throw new HeadlessCheckupActiveRoleEnrollmentError(code);
}
function exact(value: unknown, keys: readonly string[], prototype: object | null): Canonical | null {
  try {
    if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)
      || Object.getPrototypeOf(value) !== prototype || Reflect.ownKeys(value).length !== keys.length) return null;
    const output = Object.create(null) as Canonical;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) return null;
      output[key] = descriptor.value;
    }
    return output;
  } catch { return null; }
}
function observedNow(source: () => unknown): number {
  let value: unknown;
  try { value = source(); } catch { return fail('storage_unavailable'); }
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : fail('storage_unavailable');
}
function session(value: unknown, now: number): Canonical | null {
  const item = exact(value, SESSION, null);
  return item && Object.isFrozen(value) && typeof item.id === 'string' && SESSION_REF.test(item.id)
    && typeof item.userId === 'string' && item.userId.length > 0 && item.userId.length <= 256
    && item.userId === item.userId.trim() && typeof item.username === 'string' && item.username.length > 0
    && item.username === item.username.trim() && item.role === 'admin' && item.authChannel === 'web'
    && Number.isSafeInteger(item.createdAt) && (item.createdAt as number) >= 0 && (item.createdAt as number) <= now
    && Number.isSafeInteger(item.expiresAt) && (item.expiresAt as number) > now ? item : null;
}
function sameSession(left: Canonical, right: Canonical): boolean {
  return SESSION.every((key) => left[key] === right[key]);
}
function verified(value: unknown, current: Canonical): boolean {
  const result = exact(value, ['kind', 'account'], Object.prototype);
  if (result?.kind !== 'verified' || !result.account || typeof result.account !== 'object'
    || types.isProxy(result.account) || Object.getPrototypeOf(result.account) !== Object.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(result.account);
  return descriptors.id?.enumerable === true && 'value' in descriptors.id
    && descriptors.username?.enumerable === true && 'value' in descriptors.username
    && descriptors.role?.enumerable === true && 'value' in descriptors.role
    && descriptors.id.value === current.userId && descriptors.username.value === current.username
    && descriptors.role.value === 'admin';
}
function lifecycle(action: () => unknown): HeadlessCheckupActiveRoleEnrollmentLifecycleResult {
  let value: unknown;
  try { value = action(); } catch { return fail('storage_unavailable'); }
  const item = exact(value, (value as { kind?: unknown } | null)?.kind === 'ok' ? ['kind', 'value'] : ['kind'],
    Object.prototype);
  if (!item || !['ok', 'missing', 'conflict', 'unavailable'].includes(item.kind as string)) {
    return fail('storage_unavailable');
  }
  return item.kind === 'ok' ? { kind: 'ok', value: item.value }
    : { kind: item.kind } as HeadlessCheckupActiveRoleEnrollmentLifecycleResult;
}
function requireOk(value: HeadlessCheckupActiveRoleEnrollmentLifecycleResult): unknown {
  if (value.kind === 'ok') return value.value;
  if (value.kind === 'conflict') return fail('enrollment_conflict');
  return fail('storage_unavailable');
}
function millis(value: unknown): number | null {
  try {
    if (!(value instanceof Date) || types.isProxy(value)) return null;
    const result = Date.prototype.getTime.call(value);
    return Number.isSafeInteger(result) && result >= 0 ? result : null;
  } catch { return null; }
}
function active(value: unknown, actorRef: string, now: number): boolean {
  const item = exact(value, ATTESTATION, null);
  if (!item || !Object.isFrozen(value) || item.actorRef !== actorRef || item.schemaVersion !== ATTESTATION_SCHEMA
    || item.role !== 'physician' || item.operationId !== OPERATION || item.policyVersion !== POLICY
    || item.status !== 'active' || item.attestationVersion !== 1 || item.revocationGeneration !== 0
    || item.revokedAt !== null || typeof item.attestationRef !== 'string' || !ATTESTATION_REF.test(item.attestationRef)
    || typeof item.issuerRef !== 'string' || !ISSUER_REF.test(item.issuerRef)) return false;
  const created = millis(item.createdAt), updated = millis(item.updatedAt), activated = millis(item.activatedAt);
  const expires = millis(item.expiresAt);
  return created !== null && updated !== null && activated !== null && expires !== null && created <= activated
    && activated <= updated && updated <= now && activated <= now && now < expires && expires - activated === TTL_MS;
}

/** Explicit admin + PIN enrollment. The returned projection is not a grant or write authority. */
export function createHeadlessCheckupActiveRoleEnrollmentService(sources: HeadlessCheckupActiveRoleEnrollmentSources) {
  return Object.freeze({
    async enroll(candidatePin: unknown): Promise<HeadlessCheckupActiveRoleEnrollmentProjectionV1> {
      if (typeof candidatePin !== 'string' || candidatePin.length < 4 || candidatePin.length > 8) {
        return fail('enrollment_denied');
      }
      let beforeValue: unknown;
      try { beforeValue = await sources.resolveCurrentWebAdmin(); } catch { return fail('storage_unavailable'); }
      const before = session(beforeValue, observedNow(sources.now));
      if (!before) return fail('enrollment_denied');
      let proof: unknown;
      try { proof = await sources.verifyAdminPin({ username: before.username, pin: candidatePin }); }
      catch { return fail('storage_unavailable'); }
      if (!verified(proof, before)) return fail('enrollment_denied');
      let afterValue: unknown;
      try { afterValue = await sources.resolveCurrentWebAdmin(); } catch { return fail('storage_unavailable'); }
      const after = session(afterValue, observedNow(sources.now));
      if (!after || !sameSession(before, after)) return fail('enrollment_denied');
      const actorRef = before.userId as string, current = lifecycle(() => sources.readAttestation(actorRef));
      if (current.kind === 'missing') requireOk(lifecycle(() => sources.createInactive(actorRef)));
      else requireOk(current);
      const attestation = requireOk(lifecycle(() => sources.activate(actorRef)));
      if (!active(attestation, actorRef, observedNow(sources.now))) return fail('storage_unavailable');
      return Object.freeze(Object.assign(Object.create(null), { schemaVersion: ENROLLMENT_SCHEMA,
        status: 'active' as const, attestationVersion: 1 as const }));
    },
  });
}
