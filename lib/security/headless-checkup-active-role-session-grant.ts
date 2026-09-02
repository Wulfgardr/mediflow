/* @Codex */
import 'server-only';

import { types } from 'node:util';

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

type Canonical = Record<string, unknown>;
type Context = Readonly<{ session: Canonical; owner: Canonical }>;
type Snapshot = Readonly<{ session: Canonical; owner: Canonical; actorRef: string; sessionRef: string;
  attestationRef: string; issuerRef: string; activatedAt: number; updatedAt: number; expiresAt: number;
  patientId: string; ambulatoryId: string; selectionEpoch: number }>;
type RecordState = { active: boolean; grant: HeadlessCheckupActiveRoleSessionGrantV1; snapshot: Snapshot;
  unregister: (() => void) | null; cancel: (() => void) | null; onTerminal: () => void };
declare const grantIdentity: unique symbol;
export type HeadlessCheckupActiveRoleSessionGrantV1 = Readonly<{ readonly [grantIdentity]?: never }>;
export type HeadlessCheckupActiveRoleSessionGrantSources = Readonly<{
  now(): unknown;
  readSession(sessionRef: string): unknown;
  readAttestation(actorRef: string): unknown;
  registerSessionResource(sessionRef: string, dispose: () => void): unknown;
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
function attestation(value: unknown, actorRef: string, observedAt: number): Readonly<{
  attestationRef: string; issuerRef: string; activatedAt: number; updatedAt: number; expiresAt: number;
}> {
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
  return Object.freeze({ attestationRef: item.attestationRef, issuerRef: item.issuerRef,
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

/** Process owner for a checkup-only role grant captured in an authenticated Web request. */
export function createHeadlessCheckupActiveRoleSessionGrantOwner(sources: HeadlessCheckupActiveRoleSessionGrantSources) {
  const grants = new WeakMap<object, RecordState>(); let operationActive = false;
  const terminate = (record: RecordState, notify = true): void => {
    if (!record.active) return;
    record.active = false; grants.delete(record.grant);
    const unregister = record.unregister, cancel = record.cancel; record.unregister = null; record.cancel = null;
    try { unregister?.(); } catch { /* terminal */ }
    try { cancel?.(); } catch { /* terminal */ }
    if (notify) { try { record.onTerminal(); } catch { /* terminal */ } }
  };
  const snapshot = (captured: Context): Snapshot => {
    const observedAt = now(sources.now); let sessionValue: unknown, attestationValue: unknown;
    try { sessionValue = sources.readSession(captured.session.id as string); }
    catch { return fail('session_unavailable'); }
    const currentSession = session(sessionValue, observedAt);
    if (currentSession !== captured.session) return fail('session_unavailable');
    try { attestationValue = sources.readAttestation(currentSession.userId as string); }
    catch { return fail('attestation_unavailable'); }
    const role = attestation(attestationValue, currentSession.userId as string, observedAt);
    let selected: unknown;
    try { selected = Reflect.apply(captured.owner.withLeaseCriticalSection as (...args: unknown[]) => unknown,
      captured.owner, [captured.session, (selection: unknown) => {
        const pair = selection && typeof selection === 'object' ? selection as Canonical : null;
        const selectionEpoch = Reflect.apply(captured.owner.snapshotSelectionEpoch as (...args: unknown[]) => unknown,
          captured.owner, [captured.session]);
        if (!pair || typeof pair.patientId !== 'string' || typeof pair.ambulatoryId !== 'string'
          || !Number.isSafeInteger(selectionEpoch) || (selectionEpoch as number) < 0) return fail('session_unavailable');
        return { patientId: pair.patientId, ambulatoryId: pair.ambulatoryId, selectionEpoch };
      }]); } catch (error) { if (error instanceof HeadlessCheckupActiveRoleSessionGrantError) throw error;
      return fail('session_unavailable'); }
    if (!selected || typeof selected !== 'object') return fail('session_unavailable');
    const scope = selected as { patientId: string; ambulatoryId: string; selectionEpoch: number };
    return Object.freeze(Object.assign(Object.create(null), { session: captured.session, owner: captured.owner,
      actorRef: currentSession.userId as string, sessionRef: currentSession.id as string, ...role,
      expiresAt: Math.min(role.expiresAt, currentSession.expiresAt as number), ...scope }));
  };
  const stable = (captured: Context): Snapshot => {
    const before = snapshot(captured), after = snapshot(captured);
    if (!same(before, after)) return fail('projection_stale');
    return after;
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
    let observed: Snapshot;
    try { observed = stable({ session: record.snapshot.session, owner: record.snapshot.owner }); }
    catch (error) { terminate(record); throw error; }
    if (!same(observed, record.snapshot)) { terminate(record); return fail('projection_stale'); }
    return record;
  };
  const invoke = <T>(candidate: unknown, operation: () => T, presented?: unknown): T => {
    if (!callback(operation) || operationActive) return fail('lifecycle_unavailable');
    const requestContext = presented === undefined ? undefined : context(presented), record = current(candidate, requestContext);
    operationActive = true;
    try {
      const result = operation();
      if (types.isPromise(result) || !record.active) { terminate(record); return fail('lifecycle_unavailable'); }
      current(candidate, requestContext);
      return result;
    } catch (error) { terminate(record); throw error; }
    finally { operationActive = false; }
  };
  return Object.freeze({
    issue(value: unknown, onTerminalValue: unknown): HeadlessCheckupActiveRoleSessionGrantV1 {
      const captured = context(value);
      if (!callback(onTerminalValue)) return fail('input_invalid');
      const initial = stable(captured), grant = Object.freeze(Object.create(null)) as HeadlessCheckupActiveRoleSessionGrantV1;
      const record: RecordState = { active: true, grant, snapshot: initial, unregister: null, cancel: null,
        onTerminal: onTerminalValue as () => void };
      let unregister: unknown, cancel: unknown;
      try {
        unregister = sources.registerSessionResource(initial.sessionRef, () => terminate(record, true));
        if (!record.active) return fail('lifecycle_unavailable');
        cancel = sources.schedule(initial.expiresAt - now(sources.now), () => terminate(record, true));
      } catch {
        try { if (typeof unregister === 'function') unregister(); } catch { /* unpublished */ }
        try { if (typeof cancel === 'function') cancel(); } catch { /* unpublished */ }
        record.active = false; return fail('lifecycle_unavailable');
      }
      if (typeof unregister !== 'function' || types.isProxy(unregister) || types.isAsyncFunction(unregister)
        || typeof cancel !== 'function' || types.isProxy(cancel) || types.isAsyncFunction(cancel)) {
        try { if (typeof unregister === 'function') unregister(); } catch { /* unpublished */ }
        try { if (typeof cancel === 'function') cancel(); } catch { /* unpublished */ }
        record.active = false; return fail('lifecycle_unavailable');
      }
      if (!record.active) {
        try { unregister(); } catch { /* unpublished */ }
        try { cancel(); } catch { /* unpublished */ }
        return fail('lifecycle_unavailable');
      }
      record.unregister = unregister as () => void; record.cancel = cancel as () => void;
      const final = stable(captured);
      if (!same(initial, final)) { terminate(record); return fail('projection_stale'); }
      if (!record.active) { terminate(record); return fail('lifecycle_unavailable'); }
      grants.set(grant, record); return grant;
    },
    withCurrent<T>(candidate: unknown, operation: () => T): T { return invoke(candidate, operation); },
    withCurrentRequest<T>(candidate: unknown, presented: unknown, operation: () => T): T {
      return invoke(candidate, operation, presented);
    },
    dispose(candidate: unknown): boolean {
      const record = candidate && typeof candidate === 'object' ? grants.get(candidate) : undefined;
      if (!record?.active) return false; terminate(record, false); return true;
    },
  });
}
