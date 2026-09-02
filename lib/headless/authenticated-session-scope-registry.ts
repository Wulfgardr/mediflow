/* @Codex */
import { Buffer } from 'node:buffer';
import { types } from 'node:util';

const SOURCE_KEYS = ['now', 'nextNonce', 'hashRef', 'readHostSelection'] as const;
const SELECTION_KEYS = ['status', 'patientId', 'ambulatoryId', 'generation', 'revocationGeneration',
  'selectionEpoch', 'restartGeneration', 'expiresAt'] as const;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const NONCE = /^[a-z][a-z0-9._-]{15,127}$/u;
const ID_MAX_BYTES = 256;
const HASH_DOMAIN = 'mediflow.headless.authenticated-session-scope.v1';
export const AUTHENTICATED_SESSION_SCOPE_MAX_CAPTURES_V1 = 256;

export type AuthenticatedSessionScopeRegistryV1ErrorCode = 'input_invalid' | 'selection_unavailable'
  | 'reference_invalid' | 'ticket_invalid' | 'owner_invalid' | 'clock_invalid' | 'capacity_exceeded';

export class AuthenticatedSessionScopeRegistryV1Error extends Error {
  constructor(public readonly code: AuthenticatedSessionScopeRegistryV1ErrorCode) {
    super(`Authenticated session scope registry rejected: ${code}`);
    this.name = 'AuthenticatedSessionScopeRegistryV1Error';
  }
}

type Selection = Readonly<{
  status: 'available'; patientId: string; ambulatoryId: string; generation: number;
  revocationGeneration: number; selectionEpoch: number; restartGeneration: number; expiresAt: number;
}>;
type TicketRecord = { selection: Selection; scopeDigest: string; generation: number; state: 'available' | 'bound' };
type SessionRecord = { selection: Selection; scopeDigest: string; owner: object; generation: number; active: boolean };

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  try {
    if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)
      || Object.getPrototypeOf(value) !== null || !Object.isFrozen(value)) return null;
    const actual = Reflect.ownKeys(value);
    if (actual.length !== keys.length) return null;
    const output = Object.create(null) as Record<string, unknown>;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (actual[index] !== key || !descriptor || !descriptor.enumerable || !('value' in descriptor)
        || descriptor.configurable || descriptor.writable) return null;
      output[key] = descriptor.value;
    }
    return output;
  } catch { return null; }
}

function opaque(value: unknown): value is object {
  try {
    return !!value && typeof value === 'object' && !types.isProxy(value) && Object.getPrototypeOf(value) === null
      && Object.isFrozen(value) && Reflect.ownKeys(value).length === 0;
  } catch { return false; }
}

function integer(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function hostId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
    && Buffer.byteLength(value, 'utf8') <= ID_MAX_BYTES;
}

function record<T extends object>(value: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, value));
}

function handle(): object { return Object.freeze(Object.create(null)) as object; }

export function createAuthenticatedSessionScopeRegistryV1(sourcesValue: unknown) {
  const sources = exact(sourcesValue, SOURCE_KEYS);
  if (!sources || SOURCE_KEYS.some((key) => typeof sources[key] !== 'function' || types.isProxy(sources[key]))) {
    throw new AuthenticatedSessionScopeRegistryV1Error('input_invalid');
  }
  const nowSource = sources.now as () => unknown;
  const nextNonceSource = sources.nextNonce as () => unknown;
  const hashRefSource = sources.hashRef as (value: string) => unknown;
  const readHostSelectionSource = sources.readHostSelection as () => unknown;
  const tickets = new WeakMap<object, TicketRecord>();
  const sessions = new WeakMap<object, SessionRecord>();
  const executions = new WeakMap<object, SessionRecord>();
  const issuedDigests = new Set<string>();
  let lastNow = -1;
  let generation = 0;
  let captures = 0;
  let observing = false;
  let reentered = false;

  const enter = (): void => {
    if (observing) {
      reentered = true;
      throw new AuthenticatedSessionScopeRegistryV1Error('input_invalid');
    }
  };
  const observe = <T>(code: AuthenticatedSessionScopeRegistryV1ErrorCode, action: () => T): T => {
    enter(); observing = true; reentered = false;
    try {
      let result: T;
      try { result = action(); } catch { throw new AuthenticatedSessionScopeRegistryV1Error(code); }
      if (reentered || types.isPromise(result)) throw new AuthenticatedSessionScopeRegistryV1Error(code);
      return result;
    } finally { observing = false; reentered = false; }
  };

  const now = (): number => {
    const value = observe('clock_invalid', nowSource);
    if (!integer(value) || value < lastNow) {
      throw new AuthenticatedSessionScopeRegistryV1Error('clock_invalid');
    }
    lastNow = value;
    return value;
  };
  const readSelection = (): Selection => {
    const raw = observe('selection_unavailable', readHostSelectionSource);
    const value = exact(raw, SELECTION_KEYS);
    const timestamp = now();
    if (!value || value.status !== 'available' || !hostId(value.patientId) || !hostId(value.ambulatoryId)
      || !integer(value.generation, 1) || !integer(value.revocationGeneration) || !integer(value.selectionEpoch)
      || !integer(value.restartGeneration, 1) || !integer(value.expiresAt, timestamp + 1)) {
      throw new AuthenticatedSessionScopeRegistryV1Error('selection_unavailable');
    }
    return record(value as Selection);
  };
  const sameSelection = (left: Selection, right: Selection): boolean => SELECTION_KEYS.every((key) =>
    left[key as keyof Selection] === right[key as keyof Selection]);
  const capture = (): object => {
    enter();
    if (captures >= AUTHENTICATED_SESSION_SCOPE_MAX_CAPTURES_V1) {
      throw new AuthenticatedSessionScopeRegistryV1Error('capacity_exceeded');
    }
    const selection = readSelection();
    const nonce = observe('reference_invalid', nextNonceSource);
    if (typeof nonce !== 'string' || !NONCE.test(nonce)) {
      throw new AuthenticatedSessionScopeRegistryV1Error('reference_invalid');
    }
    const scopeDigest = observe('reference_invalid', () => hashRefSource(`${HASH_DOMAIN}\0${nonce}`));
    if (typeof scopeDigest !== 'string' || !DIGEST.test(scopeDigest) || issuedDigests.has(scopeDigest)) {
      throw new AuthenticatedSessionScopeRegistryV1Error('reference_invalid');
    }
    issuedDigests.add(scopeDigest);
    captures += 1;
    const ticket = handle();
    tickets.set(ticket, { selection, scopeDigest, generation, state: 'available' });
    return ticket;
  };
  const activation = (ticketValue: unknown) => {
    enter();
    if (!opaque(ticketValue)) throw new AuthenticatedSessionScopeRegistryV1Error('ticket_invalid');
    const ticket = tickets.get(ticketValue);
    if (!ticket || ticket.state !== 'available' || ticket.generation !== generation) {
      throw new AuthenticatedSessionScopeRegistryV1Error('ticket_invalid');
    }
    return record({ scopeDigest: ticket.scopeDigest, generation: ticket.selection.generation,
      revocationGeneration: ticket.selection.revocationGeneration, selectionEpoch: ticket.selection.selectionEpoch,
      restartGeneration: ticket.selection.restartGeneration, expiresAt: ticket.selection.expiresAt });
  };
  const bindOwner = (ticketValue: unknown, ownerValue: unknown): object => {
    enter();
    if (!opaque(ticketValue)) throw new AuthenticatedSessionScopeRegistryV1Error('ticket_invalid');
    if (!opaque(ownerValue)) throw new AuthenticatedSessionScopeRegistryV1Error('owner_invalid');
    const ticket = tickets.get(ticketValue);
    if (!ticket || ticket.state !== 'available' || ticket.generation !== generation) {
      throw new AuthenticatedSessionScopeRegistryV1Error('ticket_invalid');
    }
    ticket.state = 'bound';
    const session = handle();
    sessions.set(session, { selection: ticket.selection, scopeDigest: ticket.scopeDigest, owner: ownerValue,
      generation: ticket.generation, active: true });
    return session;
  };
  const bindExecution = (sessionValue: unknown, ownerValue: unknown, executionValue: unknown): boolean => {
    enter();
    if (!opaque(sessionValue) || !opaque(ownerValue) || !opaque(executionValue)) return false;
    const session = sessions.get(sessionValue);
    if (!session || session.owner !== ownerValue || !session.active || session.generation !== generation
      || executions.has(executionValue)) return false;
    executions.set(executionValue, session);
    return true;
  };
  const resolveExecution = (executionValue: unknown) => {
    enter();
    if (!opaque(executionValue)) return null;
    const session = executions.get(executionValue);
    if (!session || !session.active || session.generation !== generation) return null;
    let current: Selection;
    try { current = readSelection(); } catch { session.active = false; return null; }
    if (!session.active || session.generation !== generation || !sameSelection(session.selection, current)) {
      session.active = false; return null;
    }
    return record({ ...current, scopeDigest: session.scopeDigest });
  };
  const revoke = (sessionValue: unknown): boolean => {
    enter();
    if (!opaque(sessionValue)) return false;
    const session = sessions.get(sessionValue);
    if (!session || !session.active) return false;
    session.active = false;
    return true;
  };
  const restart = (): void => {
    enter();
    if (generation >= Number.MAX_SAFE_INTEGER) throw new AuthenticatedSessionScopeRegistryV1Error('input_invalid');
    generation += 1;
  };
  return Object.freeze({ capture, activation, bindOwner, bindExecution, resolveExecution, revoke, restart });
}
