/* @Codex */
import { types } from 'node:util';

const SOURCE_KEYS = ['now', 'hashRef', 'readPatientVersion', 'schedule', 'onTerminal'] as const;
const CAPTURE_KEYS = ['schemaVersion', 'userRef', 'parentRef', 'patientId', 'ambulatoryId',
  'selectionEpoch', 'expectedPatientVersion', 'expiresAt'] as const;
const CAPTURE_SCHEMA = 'mediflow.portable-supervisor.web-capture.v1';
const USER_REF = /^user\.[0-9a-f]{64}$/u;
const PARENT_REF = /^parent\.[0-9a-f]{64}$/u;
const HOST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const CONTEXT_TTL_MS = 15 * 60_000;
const BOOTSTRAP_TTL_MS = 5_000;

type CanonicalRecord = Record<string, unknown>;
type TerminalReason = 'revoked' | 'restarted' | 'disposed' | 'expired' | 'currentness_denied';
type Sources = Readonly<{
  now(): unknown;
  hashRef(value: string): unknown;
  readPatientVersion(patientId: string, ambulatoryId: string): unknown;
  schedule(delayMs: number, callback: () => void): unknown;
  onTerminal(reason: TerminalReason): unknown;
}>;
type Active = {
  active: boolean; patientId: string; ambulatoryId: string; expectedPatientVersion: number;
  userRef: string; parentRef: string; generation: number; selectionEpoch: number;
  revocationGeneration: number; restartGeneration: number; parentGeneration: number;
  policyGeneration: number; expiresAt: number; cancel: (() => void) | null;
};

export class PortableSupervisorContextMirrorV1Error extends Error {
  constructor(public readonly code: 'input_invalid' | 'context_unavailable' | 'already_bound') {
    super(`Portable supervisor context mirror rejected: ${code}`);
    this.name = 'PortableSupervisorContextMirrorV1Error';
  }
}

function fail(code: 'input_invalid' | 'context_unavailable' | 'already_bound'): never {
  throw new PortableSupervisorContextMirrorV1Error(code);
}

function record<T extends CanonicalRecord>(value: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, value));
}

function integer(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function exact(value: unknown, keys: readonly string[], canonical = false): CanonicalRecord {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)
      || types.isPromise(value)) return fail('input_invalid');
    const prototype = Object.getPrototypeOf(value);
    if ((canonical && (prototype !== null || !Object.isFrozen(value)))
      || (!canonical && prototype !== null && prototype !== Object.prototype)) return fail('input_invalid');
    const own = Reflect.ownKeys(value);
    if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) {
      return fail('input_invalid');
    }
    const output = Object.create(null) as CanonicalRecord;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)
        || (canonical && (descriptor.writable || descriptor.configurable))) return fail('input_invalid');
      output[key] = descriptor.value;
    }
    return output;
  } catch (error) {
    if (error instanceof PortableSupervisorContextMirrorV1Error) throw error;
    return fail('input_invalid');
  }
}

function canonicalCapture(value: unknown): CanonicalRecord {
  const capture = exact(value, CAPTURE_KEYS, true);
  if (capture.schemaVersion !== CAPTURE_SCHEMA
    || typeof capture.userRef !== 'string' || !USER_REF.test(capture.userRef)
    || typeof capture.parentRef !== 'string' || !PARENT_REF.test(capture.parentRef)
    || typeof capture.patientId !== 'string' || !HOST_ID.test(capture.patientId)
    || typeof capture.ambulatoryId !== 'string' || !HOST_ID.test(capture.ambulatoryId)
    || !integer(capture.selectionEpoch) || !integer(capture.expectedPatientVersion, 1)
    || !integer(capture.expiresAt, 1)) return fail('input_invalid');
  return capture;
}

function discardPromise(value: unknown): boolean {
  if (!types.isPromise(value)) return false;
  try { void Promise.prototype.then.call(value, undefined, () => undefined); } catch { /* terminal */ }
  return true;
}

export function createPortableSupervisorContextMirrorV1(sourcesValue: unknown) {
  const source = exact(sourcesValue, SOURCE_KEYS);
  if (SOURCE_KEYS.some((key) => typeof source[key] !== 'function' || types.isProxy(source[key])
    || types.isAsyncFunction(source[key]))) return fail('input_invalid');
  const sources = source as unknown as Sources;
  let active: Active | null = null, bound = false, binding = false, bindingCancelled = false;
  let reading = false, lastNow = -1;
  let generation = 0, revocationGeneration = 0, restartGeneration = 1, parentGeneration = 0;
  const policyGeneration = 1;
  const increment = (value: number) => value < Number.MAX_SAFE_INTEGER
    ? value + 1 : fail('context_unavailable');
  const now = (): number => {
    let value: unknown;
    try { value = sources.now(); } catch { return fail('context_unavailable'); }
    if (discardPromise(value) || !integer(value) || value < lastNow) return fail('context_unavailable');
    lastNow = value;
    return value;
  };
  const hash = (domain: 'user' | 'parent', value: string): string => {
    let digest: unknown;
    try { digest = sources.hashRef(`mediflow.portable-supervisor.mirror.${domain}.v1\0${value}`); }
    catch { return fail('context_unavailable'); }
    if (discardPromise(digest) || typeof digest !== 'string' || !DIGEST.test(digest)) {
      return fail('context_unavailable');
    }
    return `${domain}.${digest.slice(7)}`;
  };
  const version = (state: Active): number => {
    let value: unknown;
    try { value = sources.readPatientVersion(state.patientId, state.ambulatoryId); }
    catch { return fail('context_unavailable'); }
    if (discardPromise(value) || !integer(value, 1) || value !== state.expectedPatientVersion) {
      return fail('context_unavailable');
    }
    return value;
  };
  const notify = (reason: TerminalReason): void => {
    let result: unknown;
    try { result = sources.onTerminal(reason); } catch { return; }
    discardPromise(result);
  };
  const terminal = (reason: TerminalReason): boolean => {
    const state = active;
    if (!state?.active) return false;
    state.active = false; active = null;
    const cancel = state.cancel; state.cancel = null;
    try { cancel?.(); } catch { /* logical authority is already terminal */ }
    revocationGeneration = increment(revocationGeneration);
    if (reason === 'restarted') restartGeneration = increment(restartGeneration);
    notify(reason);
    return true;
  };
  const alive = (state: Active): boolean => active === state && state.active;
  const bindingFence = (state?: Active): void => {
    if (bindingCancelled || (state && !alive(state))) return fail('context_unavailable');
  };
  const readHostContext = () => {
    if (binding) { bindingCancelled = true; return fail('context_unavailable'); }
    if (reading) { terminal('currentness_denied'); return fail('context_unavailable'); }
    const state = active;
    if (!state?.active) return fail('context_unavailable');
    reading = true;
    try {
      version(state);
      if (!alive(state)) return fail('context_unavailable');
      const timestamp = now();
      if (!alive(state)) return fail('context_unavailable');
      if (timestamp >= state.expiresAt - 1) { terminal('expired'); return fail('context_unavailable'); }
      version(state);
      if (!alive(state)) return fail('context_unavailable');
      return record({ status: 'available' as const, userRef: state.userRef, parentRef: state.parentRef,
        purposeCode: 'care_coordination', patientId: state.patientId, ambulatoryId: state.ambulatoryId,
        generation: state.generation, revocationGeneration: state.revocationGeneration,
        selectionEpoch: state.selectionEpoch, restartGeneration: state.restartGeneration,
        parentGeneration: state.parentGeneration, policyGeneration: state.policyGeneration,
        expiresAt: state.expiresAt,
        bootstrapExpiresAt: Math.min(timestamp + BOOTSTRAP_TTL_MS, state.expiresAt - 1) });
    } catch (error) {
      if (active === state) terminal('currentness_denied');
      throw error;
    } finally { reading = false; }
  };
  const activate = (captureValue: unknown): boolean => {
    if (bound || binding) {
      if (binding) bindingCancelled = true;
      return fail('already_bound');
    }
    binding = true; bindingCancelled = false;
    try {
      const capture = canonicalCapture(captureValue);
      const timestamp = now(); bindingFence();
      const expiresAt = Math.min(capture.expiresAt as number, timestamp + CONTEXT_TTL_MS);
      if (timestamp >= expiresAt - 1) return fail('context_unavailable');
      const userRef = hash('user', capture.userRef as string); bindingFence();
      const parentRef = hash('parent', capture.parentRef as string); bindingFence();
      const candidate: Active = { active: true, patientId: capture.patientId as string,
        ambulatoryId: capture.ambulatoryId as string, expectedPatientVersion: capture.expectedPatientVersion as number,
        userRef, parentRef, generation: increment(generation), selectionEpoch: capture.selectionEpoch as number,
        revocationGeneration, restartGeneration, parentGeneration: increment(parentGeneration), policyGeneration,
        expiresAt, cancel: null };
      version(candidate); bindingFence();
      let scheduling = true, fired = false, cancel: unknown;
      active = candidate;
      try { cancel = sources.schedule(expiresAt - timestamp, () => {
        if (scheduling) { fired = true; return; }
        if (active === candidate) terminal('expired');
      }); } catch { active = null; candidate.active = false; return fail('context_unavailable'); }
      scheduling = false;
      const cancelIsPromise = discardPromise(cancel);
      if (fired || cancelIsPromise || typeof cancel !== 'function' || types.isProxy(cancel)
        || types.isAsyncFunction(cancel)) {
        active = null; candidate.active = false;
        try { if (typeof cancel === 'function') cancel(); } catch { /* unpublished */ }
        return fail('context_unavailable');
      }
      candidate.cancel = cancel as () => void;
      try {
        bindingFence(candidate);
        version(candidate); bindingFence(candidate);
        const checkedAt = now(); bindingFence(candidate);
        if (checkedAt >= expiresAt) return fail('context_unavailable');
      } catch (error) {
        if (active === candidate) active = null; candidate.active = false;
        try { candidate.cancel(); } catch { /* unpublished */ }
        throw error;
      }
      generation = candidate.generation; parentGeneration = candidate.parentGeneration;
      bound = true;
      return true;
    } finally { binding = false; bindingCancelled = false; }
  };
  const requestTerminal = (reason: TerminalReason): boolean => {
    if (binding) bindingCancelled = true;
    return terminal(reason);
  };
  return record({ activate, readHostContext, revoke: () => requestTerminal('revoked'),
    restart: () => requestTerminal('restarted'), dispose: () => requestTerminal('disposed') });
}
