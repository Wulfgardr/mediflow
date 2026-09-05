/* @Codex */
import { types } from 'node:util';

import {
  PORTABLE_SUPERVISOR_WEB_IPC_SCHEMA_V1,
  decodePortableSupervisorWebIpcFrameV1,
  encodePortableSupervisorWebIpcFrameV1,
  type PortableSupervisorWebCaptureV1,
  type PortableSupervisorWebIpcFrameV1,
} from './portable-supervisor-web-ipc-contract.ts';

const SOURCE_KEYS = ['now', 'nextChallenge', 'activate', 'revoke'] as const;
const RESULT_KEYS = ['expiresAt'] as const;
const CHALLENGE = /^pswc_[0-9a-f]{64}$/u;
const TERMINAL_REASONS = new Set(['logout', 'application_lock', 'reselection', 'expiry',
  'web_disconnect', 'mcp_disconnect', 'restart', 'explicit']);
export const PORTABLE_SUPERVISOR_WEB_PREPARE_TTL_MS = 5_000;

type CanonicalRecord = Record<string, unknown>;
type Phase = 'idle' | 'preparing' | 'prepared' | 'activating' | 'active' | 'terminal';
type TerminalReason = 'logout' | 'application_lock' | 'reselection' | 'expiry'
  | 'web_disconnect' | 'mcp_disconnect' | 'restart' | 'explicit';
type Sources = Readonly<{
  now(): unknown;
  nextChallenge(): unknown;
  activate(capture: PortableSupervisorWebCaptureV1): unknown;
  revoke(reason: TerminalReason): unknown;
}>;
type Pending = Readonly<{ requestRef: string; challenge: string; expiresAt: number }>;

export class PortableSupervisorWebControlV1Error extends Error {
  constructor(public readonly code: 'protocol_invalid') {
    super(`Portable supervisor Web control rejected: ${code}`);
    this.name = 'PortableSupervisorWebControlV1Error';
  }
}

function fail(): never { throw new PortableSupervisorWebControlV1Error('protocol_invalid'); }
function record<T extends CanonicalRecord>(value: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, value));
}
function integer(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}
function exact(value: unknown, keys: readonly string[], frozen = false): CanonicalRecord {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)
      || types.isPromise(value) || (frozen && !Object.isFrozen(value))) return fail();
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
    if (error instanceof PortableSupervisorWebControlV1Error) throw error;
    return fail();
  }
}
function discardPromise(value: unknown): boolean {
  if (!types.isPromise(value)) return false;
  try { void Promise.prototype.then.call(value, undefined, () => undefined); } catch { /* denied source */ }
  return true;
}

export function createPortableSupervisorWebControlV1(sourcesValue: unknown) {
  const source = exact(sourcesValue, SOURCE_KEYS);
  if (SOURCE_KEYS.some((key) => typeof source[key] !== 'function' || types.isProxy(source[key]))) return fail();
  const sources = source as unknown as Sources;
  let phase: Phase = 'idle', pending: Pending | null = null, termination: Promise<void> | null = null, lastNow = -1;
  const now = (): number => {
    let value: unknown;
    try { value = sources.now(); } catch { return fail(); }
    if (discardPromise(value) || !integer(value) || value < lastNow) return fail();
    lastNow = value; return value;
  };
  const ack = (requestRef: string, value: CanonicalRecord): string =>
    encodePortableSupervisorWebIpcFrameV1({ schemaVersion: PORTABLE_SUPERVISOR_WEB_IPC_SCHEMA_V1,
      method: 'ack', requestRef, ...value });
  const denied = (requestRef: string, denialCode: string): string =>
    ack(requestRef, { outcome: 'denied', denialCode });
  const terminate = async (reason: TerminalReason): Promise<boolean> => {
    const first = termination === null;
    if (first) {
      phase = 'terminal'; pending = null;
      let complete!: () => void, reject!: () => void;
      termination = new Promise<void>((resolve, rejectPromise) => {
        complete = resolve;
        reject = () => rejectPromise(new Error('revoke_failed'));
      });
      try {
        const result = sources.revoke(TERMINAL_REASONS.has(reason) ? reason : 'explicit');
        if (types.isPromise(result)) void Promise.prototype.then.call(result, complete, reject);
        else if (result === undefined) complete();
        else reject();
      } catch { reject(); }
    }
    try { await termination; } catch { throw new Error('revoke_failed'); }
    return first;
  };
  const protocolFailure = async (): Promise<never> => {
    try { await terminate('explicit'); } catch { /* protocol failure remains terminal */ }
    return fail();
  };
  const prepare = async (frame: PortableSupervisorWebIpcFrameV1): Promise<string> => {
    const requestRef = frame.requestRef as string;
    if (phase === 'prepared' || phase === 'preparing') return denied(requestRef, 'replayed');
    if (phase === 'active' || phase === 'activating') return denied(requestRef, 'already_bound');
    if (phase === 'terminal') return denied(requestRef, 'host_unavailable');
    phase = 'preparing';
    let timestamp: number, challenge: unknown;
    try { timestamp = now(); challenge = sources.nextChallenge(); }
    catch { try { await terminate('explicit'); } catch { /* terminal */ } return denied(requestRef, 'host_unavailable'); }
    if (phase !== 'preparing' || discardPromise(challenge) || typeof challenge !== 'string'
      || !CHALLENGE.test(challenge) || timestamp > Number.MAX_SAFE_INTEGER - PORTABLE_SUPERVISOR_WEB_PREPARE_TTL_MS) {
      try { await terminate('explicit'); } catch { /* terminal */ }
      return denied(requestRef, 'host_unavailable');
    }
    const expiresAt = timestamp + PORTABLE_SUPERVISOR_WEB_PREPARE_TTL_MS;
    pending = record({ requestRef, challenge, expiresAt }); phase = 'prepared';
    return ack(requestRef, { outcome: 'prepared', challenge, expiresAt });
  };
  const activate = async (frame: PortableSupervisorWebIpcFrameV1): Promise<string> => {
    const requestRef = frame.requestRef as string;
    if (phase === 'active' || phase === 'activating') return denied(requestRef, 'already_bound');
    if (phase === 'terminal') return denied(requestRef, 'host_unavailable');
    const challenge = pending;
    if (phase !== 'prepared' || !challenge || requestRef !== challenge.requestRef
      || frame.challenge !== challenge.challenge) {
      try { await terminate('explicit'); } catch { /* terminal */ }
      return denied(requestRef, 'challenge_invalid');
    }
    pending = null; phase = 'activating';
    let timestamp: number;
    try { timestamp = now(); } catch {
      try { await terminate('explicit'); } catch { /* terminal */ }
      return denied(requestRef, 'host_unavailable');
    }
    if (timestamp >= challenge.expiresAt) {
      try { await terminate('explicit'); } catch { /* terminal */ }
      return denied(requestRef, 'challenge_expired');
    }
    try {
      const activation = sources.activate(frame.capture as PortableSupervisorWebCaptureV1);
      if (!types.isPromise(activation)) throw new Error('activation_failed');
      const result = exact(await activation, RESULT_KEYS, true);
      const completedAt = now();
      if (phase !== 'activating' || !integer(result.expiresAt, completedAt + 1)
        || (result.expiresAt as number) > (frame.capture as PortableSupervisorWebCaptureV1).expiresAt) {
        throw new Error('activation_failed');
      }
      phase = 'active';
      return ack(requestRef, { outcome: 'activated', expiresAt: result.expiresAt });
    } catch {
      try { await terminate('explicit'); } catch { /* terminal */ }
      return denied(requestRef, 'activation_failed');
    }
  };
  const revoke = async (frame: PortableSupervisorWebIpcFrameV1): Promise<string> => {
    const requestRef = frame.requestRef as string;
    try { await terminate(frame.reason as TerminalReason); }
    catch { return denied(requestRef, 'revoke_failed'); }
    return ack(requestRef, { outcome: 'revoked' });
  };
  const handle = async (frameValue: unknown): Promise<string> => {
    let frame: PortableSupervisorWebIpcFrameV1;
    try { frame = decodePortableSupervisorWebIpcFrameV1(frameValue); }
    catch { return protocolFailure(); }
    if (frame.method === 'prepare') return prepare(frame);
    if (frame.method === 'activate') return activate(frame);
    if (frame.method === 'revoke_all') return revoke(frame);
    return protocolFailure();
  };
  return record({ handle, terminate });
}
