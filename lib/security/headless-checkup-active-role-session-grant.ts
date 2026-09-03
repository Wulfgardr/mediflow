/* @Codex */
import 'server-only';

import { types } from 'node:util';

import { abortResourceUse, beginResourceUse, commitResourceUse, mintResourcePort,
  registerPrivateResource, releaseResourcePort, unregisterPrivateResource, withCurrentResourceBinding,
  type WebResourceBinding, type WebResourcePort, type WebResourceRegistration,
  type WebResourceUse } from './web-auth-lifecycle-owner-adapter';

const ATTESTATION_SCHEMA = 'mediflow.headless-checkup-active-role-attestation.v1';
const OPERATION = 'mediflow.patient.checkup.status.transition.v1';
const POLICY = 'physician_confirmed_single_use.v1';
const TTL_MS = 8 * 60 * 60 * 1_000;
const SESSION_KEYS = ['id', 'userId', 'username', 'role', 'authChannel', 'createdAt', 'expiresAt'] as const;
const ATTESTATION_KEYS = ['attestationRef', 'actorRef', 'schemaVersion', 'role', 'operationId', 'policyVersion',
  'status', 'attestationVersion', 'issuerRef', 'expiresAt', 'activatedAt', 'revocationGeneration',
  'revokedAt', 'createdAt', 'updatedAt'] as const;
const SESSION_REF = /^[0-9a-f]{64}$/u, ATTESTATION_REF = /^hcar_[0-9a-f]{32}$/u;
const ISSUER_REF = /^hcari_[0-9a-f]{32}$/u;
const CALLBACK_FAILED = Object.freeze(Object.create(null));

type Canonical = Record<string, unknown>;
type Context = Readonly<{ session: Canonical; owner: Canonical }>;
type Snapshot = Readonly<{ session: Canonical; owner: Canonical; actorRef: string; sessionRef: string;
  attestationRef: string; issuerRef: string; activatedAt: number; updatedAt: number; expiresAt: number;
  patientId: string; ambulatoryId: string; selectionEpoch: number }>;
type RecordState = { active: boolean; published: boolean; grant: HeadlessCheckupActiveRoleSessionGrantV1;
  snapshot: Snapshot; port: WebResourcePort | null; registration: WebResourceRegistration | null;
  cancel: (() => void) | null; onTerminal: () => void };
declare const grantIdentity: unique symbol;
export type HeadlessCheckupActiveRoleSessionGrantV1 = Readonly<{ readonly [grantIdentity]?: never }>;
export type HeadlessCheckupActiveRoleCurrentBindingV1 = Readonly<{
  actorRef: string; sessionRef: string; role: 'physician'; patientId: string; ambulatoryId: string;
  selectionEpoch: number; revocationGeneration: 0;
}>;
export type HeadlessCheckupActiveRoleSessionGrantSources = Readonly<{
  now(): unknown;
  readAttestation(actorRef: string): unknown;
  schedule(delayMs: number, dispose: () => void): unknown;
}>;
export class HeadlessCheckupActiveRoleSessionGrantError extends Error {
  constructor(readonly code: 'input_invalid' | 'session_unavailable' | 'attestation_unavailable'
    | 'attestation_inactive' | 'attestation_expired' | 'attestation_revoked' | 'projection_stale'
    | 'grant_unavailable' | 'lifecycle_unavailable') {
    super(`Headless checkup active-role grant rejected: ${code}`);
    this.name = 'HeadlessCheckupActiveRoleSessionGrantError';
  }
}
function fail(code: ConstructorParameters<typeof HeadlessCheckupActiveRoleSessionGrantError>[0]): never {
  throw new HeadlessCheckupActiveRoleSessionGrantError(code);
}
function exact(value: unknown, keys: readonly string[]): Canonical | null {
  try {
    if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)
      || Object.getPrototypeOf(value) !== null || !Object.isFrozen(value)
      || Reflect.ownKeys(value).length !== keys.length) return null;
    const output = Object.create(null) as Canonical;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor) || descriptor.configurable || descriptor.writable) return null;
      output[key] = descriptor.value;
    }
    return output;
  } catch { return null; }
}
function now(source: () => unknown): number {
  let value: unknown;
  try { value = source(); } catch { return fail('session_unavailable'); }
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : fail('session_unavailable');
}
function date(value: unknown): number | null {
  try {
    if (!(value instanceof Date) || types.isProxy(value)) return null;
    const result = Date.prototype.getTime.call(value);
    return Number.isSafeInteger(result) && result >= 0 ? result : null;
  } catch { return null; }
}
function session(value: unknown, observedAt: number): Canonical {
  const item = exact(value, SESSION_KEYS);
  if (!item || typeof item.id !== 'string' || !SESSION_REF.test(item.id) || typeof item.userId !== 'string'
    || item.userId.length < 1 || item.userId.length > 256 || item.userId !== item.userId.trim()
    || typeof item.username !== 'string' || item.username.length < 1 || item.username !== item.username.trim()
    || (item.role !== 'admin' && item.role !== 'clinician') || item.authChannel !== 'web'
    || !Number.isSafeInteger(item.createdAt) || (item.createdAt as number) < 0
    || (item.createdAt as number) > observedAt || !Number.isSafeInteger(item.expiresAt)
    || (item.expiresAt as number) <= observedAt) return fail('session_unavailable');
  return value as Canonical;
}
function attestation(value: unknown, actorRef: string, observedAt: number) {
  const item = exact(value, ATTESTATION_KEYS);
  if (!item || item.actorRef !== actorRef || item.schemaVersion !== ATTESTATION_SCHEMA || item.role !== 'physician'
    || item.operationId !== OPERATION || item.policyVersion !== POLICY || item.attestationVersion !== 1
    || typeof item.attestationRef !== 'string' || !ATTESTATION_REF.test(item.attestationRef)) {
    return fail('attestation_unavailable');
  }
  if (item.status === 'inactive') return fail('attestation_inactive');
  if (item.status === 'revoked') return fail('attestation_revoked');
  const activatedAt = date(item.activatedAt), expiresAt = date(item.expiresAt), createdAt = date(item.createdAt);
  const updatedAt = date(item.updatedAt);
  if (item.status !== 'active' || item.revocationGeneration !== 0 || item.revokedAt !== null
    || typeof item.issuerRef !== 'string' || !ISSUER_REF.test(item.issuerRef) || activatedAt === null
    || expiresAt === null || createdAt === null || updatedAt === null || activatedAt < createdAt
    || activatedAt > updatedAt || updatedAt > observedAt || activatedAt > observedAt
    || expiresAt - activatedAt !== TTL_MS) return fail('attestation_unavailable');
  if (expiresAt <= observedAt) return fail('attestation_expired');
  return Object.freeze({ attestationRef: item.attestationRef as string, issuerRef: item.issuerRef,
    activatedAt, updatedAt, expiresAt });
}
function context(value: unknown): Context {
  const item = exact(value, ['session', 'owner']);
  if (!item || !item.owner || typeof item.owner !== 'object' || types.isProxy(item.owner)) return fail('input_invalid');
  for (const method of ['withLeaseCriticalSection', 'snapshotSelectionEpoch']) {
    if (typeof Reflect.get(item.owner, method) !== 'function') return fail('input_invalid');
  }
  return value as Context;
}
function same(left: Snapshot, right: Snapshot): boolean {
  return left.session === right.session && left.owner === right.owner && left.actorRef === right.actorRef
    && left.sessionRef === right.sessionRef && left.attestationRef === right.attestationRef
    && left.issuerRef === right.issuerRef && left.activatedAt === right.activatedAt
    && left.updatedAt === right.updatedAt && left.expiresAt === right.expiresAt
    && left.patientId === right.patientId && left.ambulatoryId === right.ambulatoryId
    && left.selectionEpoch === right.selectionEpoch;
}
function callback(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function' && !types.isProxy(value) && !types.isAsyncFunction(value)
    && !types.isGeneratorFunction(value);
}
function validBinding(value: WebResourceBinding, actorRef: string): boolean {
  const item = exact(value, ['principalRef', 'authenticationGeneration']);
  return !!item && item.principalRef === actorRef && !!item.authenticationGeneration
    && typeof item.authenticationGeneration === 'object' && exact(item.authenticationGeneration, []) !== null;
}

/** Process owner for a checkup-only grant captured from the external P3 Web owner in a request. */
export function createHeadlessCheckupActiveRoleSessionGrantOwner(sources: HeadlessCheckupActiveRoleSessionGrantSources) {
  const grants = new WeakMap<object, RecordState>(); let operationActive = false, operationPoisoned = false;
  const terminate = (record: RecordState, notify = true, ownerCleanup = false): void => {
    if (!record.active) return;
    record.active = false; grants.delete(record.grant);
    const port = record.port, registration = record.registration, cancel = record.cancel;
    record.port = null; record.registration = null; record.cancel = null;
    try { cancel?.(); } catch { /* terminal */ }
    if (!ownerCleanup) {
      try { if (port && registration) unregisterPrivateResource(port, registration); } catch { /* terminal */ }
      try { if (port) releaseResourcePort(port); } catch { /* terminal */ }
    }
    if (notify && record.published) { try { record.onTerminal(); } catch { /* terminal */ } }
  };
  const snapshot = (captured: Context): Snapshot => {
    const observedAt = now(sources.now), currentSession = session(captured.session, observedAt);
    let attestationValue: unknown;
    try { attestationValue = sources.readAttestation(currentSession.userId as string); }
    catch { return fail('attestation_unavailable'); }
    const role = attestation(attestationValue, currentSession.userId as string, observedAt);
    let selected: unknown;
    try { selected = Reflect.apply(captured.owner.withLeaseCriticalSection as (...args: unknown[]) => unknown,
      captured.owner, [captured.session, (selection: unknown) => {
        const pair = selection && typeof selection === 'object' ? selection as Canonical : null;
        const epoch = Reflect.apply(captured.owner.snapshotSelectionEpoch as (...args: unknown[]) => unknown,
          captured.owner, [captured.session]);
        if (!pair || typeof pair.patientId !== 'string' || typeof pair.ambulatoryId !== 'string'
          || !Number.isSafeInteger(epoch) || (epoch as number) < 0) return fail('session_unavailable');
        return { patientId: pair.patientId, ambulatoryId: pair.ambulatoryId, selectionEpoch: epoch as number };
      }]); } catch (error) { if (error instanceof HeadlessCheckupActiveRoleSessionGrantError) throw error;
      return fail('session_unavailable'); }
    if (!selected || typeof selected !== 'object') return fail('session_unavailable');
    return Object.freeze(Object.assign(Object.create(null), { session: captured.session, owner: captured.owner,
      actorRef: currentSession.userId as string, sessionRef: currentSession.id as string, ...role,
      expiresAt: Math.min(role.expiresAt, currentSession.expiresAt as number), ...selected })) as Snapshot;
  };
  const stable = (captured: Context): Snapshot => {
    const before = snapshot(captured), after = snapshot(captured);
    if (!same(before, after)) return fail('projection_stale');
    return after;
  };
  /* @Codex: never execute projection or downstream lifecycle code while the
     external P3 owner holds its resource-binding critical section. */
  const confirmResource = (record: Pick<RecordState, 'active' | 'port' | 'snapshot'>): boolean => {
    const port = record.port; if (!record.active || !port) return fail('grant_unavailable');
    let use: WebResourceUse | null = null, committed = false, invoked = false;
    try {
      use = beginResourceUse(port); if (!use) return fail('grant_unavailable');
      const current = withCurrentResourceBinding(use, (binding) => {
        if (!validBinding(binding, record.snapshot.actorRef)) throw CALLBACK_FAILED;
        invoked = true;
      });
      if (!current || !invoked || !record.active) return fail('grant_unavailable');
      committed = commitResourceUse(use);
      if (!committed || !record.active) return fail('grant_unavailable');
      return true;
    } finally { if (use && !committed) abortResourceUse(use); }
  };
  const current = (candidate: unknown, presented?: Context): RecordState => {
    if (!candidate || typeof candidate !== 'object' || types.isProxy(candidate)) return fail('grant_unavailable');
    const record = grants.get(candidate);
    if (!record?.active || now(sources.now) >= record.snapshot.expiresAt) {
      if (record) terminate(record); return fail('grant_unavailable');
    }
    if (presented && (presented.session !== record.snapshot.session || presented.owner !== record.snapshot.owner)) {
      terminate(record); return fail('projection_stale');
    }
    return record;
  };
  const invoke = <T>(candidate: unknown,
    operation: (binding: HeadlessCheckupActiveRoleCurrentBindingV1) => T, presented?: unknown): T => {
    if (!callback(operation as unknown)) return fail('lifecycle_unavailable');
    if (operationActive) { operationPoisoned = true; return fail('lifecycle_unavailable'); }
    const request = presented === undefined ? undefined : context(presented), record = current(candidate, request);
    operationPoisoned = false; operationActive = true;
    try {
      const before = stable({ session: record.snapshot.session, owner: record.snapshot.owner });
      if (operationPoisoned || !record.active) return fail('lifecycle_unavailable');
      if (!same(before, record.snapshot)) return fail('projection_stale');
      confirmResource(record);
      if (operationPoisoned || !record.active) return fail('lifecycle_unavailable');
      const binding = Object.freeze(Object.assign(Object.create(null), { actorRef: before.actorRef,
        sessionRef: before.sessionRef, role: 'physician' as const, patientId: before.patientId,
        ambulatoryId: before.ambulatoryId, selectionEpoch: before.selectionEpoch,
        revocationGeneration: 0 as const }));
      const result = operation(binding);
      if (operationPoisoned || types.isPromise(result) || !record.active) return fail('lifecycle_unavailable');
      const after = stable({ session: record.snapshot.session, owner: record.snapshot.owner });
      if (operationPoisoned || !record.active) return fail('lifecycle_unavailable');
      if (!same(after, record.snapshot)) return fail('projection_stale');
      confirmResource(record);
      if (operationPoisoned || !record.active) return fail('lifecycle_unavailable');
      return result;
    } catch (error) { terminate(record); throw error === CALLBACK_FAILED ? fail('grant_unavailable') : error; }
    finally { operationActive = false; }
  };
  return Object.freeze({
    issue(value: unknown, onTerminalValue: unknown): HeadlessCheckupActiveRoleSessionGrantV1 {
      const captured = context(value); if (!callback(onTerminalValue)) return fail('input_invalid');
      const initial = stable(captured), grant = Object.freeze(Object.create(null)) as HeadlessCheckupActiveRoleSessionGrantV1;
      const port = mintResourcePort(initial.session); if (!port) return fail('lifecycle_unavailable');
      const record: RecordState = { active: true, published: false, grant, snapshot: initial, port,
        registration: null, cancel: null, onTerminal: onTerminalValue as () => void };
      try {
        confirmResource(record);
        const registration = registerPrivateResource(port, () => terminate(record, true, true));
        if (!registration || !record.active) return fail('lifecycle_unavailable');
        record.registration = registration;
        const cancel = sources.schedule(initial.expiresAt - now(sources.now), () => terminate(record));
        if (!callback(cancel) || !record.active) return fail('lifecycle_unavailable');
        record.cancel = cancel as () => void;
        const final = stable(captured);
        confirmResource(record);
        if (!same(initial, final) || !record.active) return fail('projection_stale');
        grants.set(grant, record); record.published = true; return grant;
      } catch (error) {
        terminate(record, false); if (error instanceof HeadlessCheckupActiveRoleSessionGrantError) throw error;
        return fail('lifecycle_unavailable');
      }
    },
    withCurrent<T>(candidate: unknown, operation: (binding: HeadlessCheckupActiveRoleCurrentBindingV1) => T): T {
      return invoke(candidate, operation);
    },
    withCurrentRequest<T>(candidate: unknown, presented: unknown,
      operation: (binding: HeadlessCheckupActiveRoleCurrentBindingV1) => T): T {
      return invoke(candidate, operation, presented);
    },
    dispose(candidate: unknown): boolean {
      const record = candidate && typeof candidate === 'object' ? grants.get(candidate) : undefined;
      if (!record?.active) return false; terminate(record, false); return true;
    },
  });
}
