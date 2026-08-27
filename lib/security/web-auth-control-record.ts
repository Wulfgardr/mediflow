/* @Codex */

import crypto from 'node:crypto';

const apply = Reflect.apply;
const ObjectConstructor = Object;
const ObjectCreate = Object.create;
const freeze = Object.freeze;
const MapConstructor = Map;
const SetConstructor = Set;
const WeakMapConstructor = WeakMap;
const mapGetIntrinsic = Map.prototype.get;
const mapSetIntrinsic = Map.prototype.set;
const mapSizeIntrinsic = ObjectConstructor.getOwnPropertyDescriptor(Map.prototype, 'size')?.get;
const setAddIntrinsic = Set.prototype.add;
const setDeleteIntrinsic = Set.prototype.delete;
const setHasIntrinsic = Set.prototype.has;
const weakMapGetIntrinsic = WeakMap.prototype.get;
const weakMapSetIntrinsic = WeakMap.prototype.set;
const randomBytesIntrinsic = crypto.randomBytes;
const bufferToStringIntrinsic = Buffer.prototype.toString;
const isSafeInteger = Number.isSafeInteger;
const max = Math.max;
const bigint = BigInt;
const ZERO = bigint(0);
const ONE = bigint(1);
const MAX_U64 = bigint('18446744073709551615');
const MAX_TICKET_START = MAX_U64 - ONE;
const PENDING_TTL_MS = 120_000;
const REPLAY_TTL_MS = 300_000;
const IDEMPOTENCY_CAP = 64;
type Pending = Readonly<{ operation: string; fingerprint: string; generation: bigint; createdAt: number }>;
type Begin = Readonly<{ kind: 'begin'; requestFence: string; fence: string; fingerprint: string; generation: bigint; createdAt: number }>;
type Lock = { kind: 'lock'; requestFence: string; fence: string; fingerprint: string; generation: bigint; detachedSessionId: string | null; receipt: 'pending' | 'confirmed'; createdAt: number };
type Entry = Begin | Lock;
type Result = Readonly<{ ok: false }> | Readonly<{ ok: true; fence: string; generation: bigint }>;
type ControlState = {
    fence: string; generation: bigint; pending: Pending | null; activeSessionId: string | null; clock: number;
    used: Set<string>; reserved: Set<string>; entries: Map<string, Entry>; issuing: boolean; poisoned: boolean;
};
type TicketBinding = {
    lifecycle: 'prepared' | 'active' | 'retired' | 'denied'; owner: ControlState; pending: Pending;
    fence: string; generation: bigint; sessionId: string; activateFence: string; retireFence: string;
    retiredReason: RetireReason | null;
};
type RetireReason = 'lock' | 'dispose' | 'expired' | 'delete' | 'clear';
declare const authControlTicketBrand: unique symbol;
export type AuthControlTicket = { readonly [authControlTicketBrand]: never };
const denied = freeze({ ok: false } as const);
const frozen = <Value>(value: Value): Readonly<Value> => apply(freeze, ObjectConstructor, [value]) as Readonly<Value>;
const mapGet = <Value>(map: Map<string, Value>, key: string): Value | undefined => apply(mapGetIntrinsic, map, [key]) as Value | undefined;
const mapSet = <Value>(map: Map<string, Value>, key: string, value: Value): void => { apply(mapSetIntrinsic, map, [key, value]); };
const mapSize = (map: Map<string, unknown>): number => apply(mapSizeIntrinsic!, map, []) as number;
const setAdd = (set: Set<string>, value: string): void => { apply(setAddIntrinsic, set, [value]); };
const setDelete = (set: Set<string>, value: string): boolean => apply(setDeleteIntrinsic, set, [value]) as boolean;
const setHas = (set: Set<string>, value: string): boolean => apply(setHasIntrinsic, set, [value]) as boolean;
const weakMapGet = <Value>(map: WeakMap<object, Value>, key: unknown): Value | undefined =>
    (typeof key === 'object' && key !== null) || typeof key === 'function' ? apply(weakMapGetIntrinsic, map, [key]) as Value | undefined : undefined;
const weakMapSet = <Value>(map: WeakMap<object, Value>, key: object, value: Value): void => { apply(weakMapSetIntrinsic, map, [key, value]); };
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
const time = (value: unknown): value is number => typeof value === 'number' && isSafeInteger(value) && value >= 0;
const u64 = (value: unknown): value is bigint => typeof value === 'bigint' && value >= ZERO && value <= MAX_U64;
const ticketBindings = new WeakMapConstructor<object, TicketBinding>();
const opaque = <Value>(): Value => apply(freeze, ObjectConstructor, [apply(ObjectCreate, ObjectConstructor, [null])]) as Value;
const retireReason = (value: unknown): value is RetireReason => value === 'lock' || value === 'dispose' || value === 'expired' || value === 'delete' || value === 'clear';
const successorFence = (): string => {
    const bytes = apply(randomBytesIntrinsic, crypto, [32]) as Buffer;
    return apply(bufferToStringIntrinsic, bytes, ['hex']) as string;
};

/** Process-local P2a state; callers supply primitive ordering data only. */
/* @Codex */
export function createWebAuthControlRecord(initialFence: unknown, initialGeneration: unknown = ZERO) {
    if (!text(initialFence) || !u64(initialGeneration)) throw new TypeError('invalid trusted control state');
    const state: ControlState = { fence: initialFence, generation: initialGeneration, pending: null, activeSessionId: null, clock: 0,
        used: new SetConstructor<string>(), reserved: new SetConstructor<string>(), entries: new MapConstructor<string, Entry>(), issuing: false, poisoned: false };
    setAdd(state.used, state.fence);
    const tick = (value: unknown): number | null => { if (!time(value)) return null; state.clock = max(state.clock, value); if (state.pending && state.clock - state.pending.createdAt >= PENDING_TTL_MS) state.pending = null; return state.clock; };
    const replay = (key: unknown, fingerprint: unknown, requestFence: unknown, at: number): Entry | null | false => {
        if (!text(key) || !text(fingerprint) || !text(requestFence)) return false;
        const entry = mapGet(state.entries, key);
        return !entry ? null : entry.fingerprint === fingerprint && entry.requestFence === requestFence && at - entry.createdAt < REPLAY_TTL_MS ? entry : false;
    };
    const successor = (value: unknown): string | null => text(value) ? value : null;
    const next = (value: string, expectedFence: string, expectedGeneration: bigint, expectedPending: Pending | null): string | null =>
        expectedGeneration === MAX_U64 || setHas(state.used, value) || state.fence !== expectedFence || state.generation !== expectedGeneration || state.pending !== expectedPending ? null : value;
    const advance = (value: string, output: Readonly<{ ok: true; fence: string; generation: bigint }>): Result => { state.fence = value; setAdd(state.used, value); state.generation += ONE; return output; };
    return frozen({
        begin(kind: unknown, operation: unknown, key: unknown, fingerprint: unknown, at: unknown): Result {
            const current = tick(at); if (current === null || (kind !== 'login' && kind !== 'setup') || !text(operation) || !text(key) || !text(fingerprint)) return denied;
            const prior = replay(key, fingerprint, state.fence, current);
            if (prior) return prior.kind === 'begin' ? frozen({ ok: true, fence: prior.fence, generation: prior.generation }) : denied;
            if (prior === false || mapSize(state.entries) >= IDEMPOTENCY_CAP || state.pending || state.activeSessionId) return denied;
            const preparedPending = frozen({ operation, fingerprint, generation: state.generation, createdAt: current });
            const preparedEntry = frozen({ kind: 'begin' as const, requestFence: state.fence, fence: state.fence, fingerprint, generation: state.generation, createdAt: current });
            const output = frozen({ ok: true as const, fence: state.fence, generation: state.generation });
            mapSet(state.entries, key, preparedEntry); state.pending = preparedPending;
            return output;
        },
        finalizeAuth(expectedFence: unknown, operation: unknown, expectedGeneration: unknown, fingerprint: unknown, sessionId: unknown, successorFence: unknown, at: unknown): Result {
            const successorFenceValue = successor(successorFence);
            if (!successorFenceValue || !text(expectedFence) || !text(operation) || !u64(expectedGeneration) || !text(fingerprint) || !text(sessionId) || tick(at) === null) return denied;
            const match = state.pending;
            if (!match || state.activeSessionId || state.fence !== expectedFence || state.generation !== expectedGeneration || match.operation !== operation || match.fingerprint !== fingerprint || match.generation !== state.generation) return denied;
            const nextFence = next(successorFenceValue, state.fence, state.generation, match); if (!nextFence) return denied;
            const output = frozen({ ok: true as const, fence: nextFence, generation: state.generation + ONE });
            state.activeSessionId = sessionId; state.pending = null; return advance(nextFence, output);
        },
        advanceLock(expectedFence: unknown, key: unknown, fingerprint: unknown, successorFence: unknown, at: unknown): Result | Readonly<{ ok: true; fence: string; generation: bigint; detachedSessionId: string | null }> {
            const successorFenceValue = successor(successorFence);
            if (!successorFenceValue || !text(expectedFence) || !text(key) || !text(fingerprint)) return denied;
            const current = tick(at); if (current === null) return denied;
            const prior = replay(key, fingerprint, expectedFence, current);
            if (prior) return prior.kind === 'lock' && prior.fence === successorFenceValue ? frozen({ ok: true, fence: prior.fence, generation: prior.generation, detachedSessionId: prior.detachedSessionId }) : denied;
            if (prior === false || mapSize(state.entries) >= IDEMPOTENCY_CAP || state.fence !== expectedFence) return denied;
            const match = state.pending; const nextFence = next(successorFenceValue, state.fence, state.generation, match); if (!nextFence) return denied;
            const detachedSessionId = state.activeSessionId; const nextGeneration = state.generation + ONE;
            const entry: Lock = { kind: 'lock', requestFence: expectedFence, fence: nextFence, fingerprint, generation: nextGeneration, detachedSessionId, receipt: 'pending', createdAt: current };
            const output = frozen({ ok: true as const, fence: nextFence, generation: nextGeneration, detachedSessionId });
            state.pending = null; state.activeSessionId = null; state.fence = nextFence; setAdd(state.used, nextFence); state.generation = nextGeneration; mapSet(state.entries, key, entry);
            return output;
        },
        finalizeLock(expectedFence: unknown, key: unknown, fingerprint: unknown, at: unknown): Result | Readonly<{ ok: true; fence: string; generation: bigint; receipt: 'confirmed' }> {
            const current = tick(at); if (current === null) return denied;
            const prior = replay(key, fingerprint, expectedFence, current);
            if (prior === null || prior === false || prior.kind !== 'lock') return denied;
            const output = frozen({ ok: true as const, fence: prior.fence, generation: prior.generation, receipt: 'confirmed' as const });
            prior.receipt = 'confirmed'; return output;
        },
        disposeBoundSession(expectedFence: unknown, sessionId: unknown, successorFence: unknown, at: unknown): Result {
            const successorFenceValue = successor(successorFence);
            if (!successorFenceValue || !text(expectedFence) || !text(sessionId) || tick(at) === null || state.fence !== expectedFence || state.activeSessionId !== sessionId) return denied;
            const nextFence = next(successorFenceValue, state.fence, state.generation, state.pending); if (!nextFence) return denied;
            const output = frozen({ ok: true as const, fence: nextFence, generation: state.generation + ONE });
            state.activeSessionId = null; state.pending = null; return advance(nextFence, output);
        },
        prepareAuthControlTicket(expectedFence: unknown, operation: unknown, expectedGeneration: unknown, fingerprint: unknown, sessionId: unknown, at: unknown): AuthControlTicket | null {
            if (state.issuing) { state.poisoned = true; return null; }
            state.issuing = true;
            let activateFence: string | null = null; let retireFence: string | null = null; let reservedActivate = false; let reservedRetire = false;
            try {
                if (!text(expectedFence) || !text(operation) || !u64(expectedGeneration) || !text(fingerprint) || !text(sessionId) || tick(at) === null) return null;
                const match = state.pending;
                if (!match || state.activeSessionId || expectedGeneration >= MAX_TICKET_START || state.fence !== expectedFence || state.generation !== expectedGeneration
                    || match.operation !== operation || match.fingerprint !== fingerprint || match.generation !== state.generation) return null;
                activateFence = successorFence(); retireFence = successorFence();
                if (state.poisoned || state.pending !== match || state.fence !== expectedFence || state.generation !== expectedGeneration
                    || state.activeSessionId || activateFence === retireFence || setHas(state.used, activateFence) || setHas(state.used, retireFence)
                    || setHas(state.reserved, activateFence) || setHas(state.reserved, retireFence)) return null;
                const ticket = opaque<AuthControlTicket>();
                const binding: TicketBinding = { lifecycle: 'prepared', owner: state, pending: match, fence: expectedFence,
                    generation: expectedGeneration, sessionId, activateFence, retireFence, retiredReason: null };
                setAdd(state.reserved, activateFence); reservedActivate = true; setAdd(state.reserved, retireFence); reservedRetire = true;
                weakMapSet(ticketBindings, ticket, binding); reservedActivate = false; reservedRetire = false;
                return ticket;
            } catch { return null; }
            finally {
                try { if (reservedActivate && activateFence) setDelete(state.reserved, activateFence); if (reservedRetire && retireFence) setDelete(state.reserved, retireFence); } catch { /* fail closed */ }
                state.issuing = false; state.poisoned = false;
            }
        },
        snapshot(): Readonly<{ fence: string; generation: bigint; pending: boolean; active: boolean }> { return frozen({ fence: state.fence, generation: state.generation, pending: state.pending !== null, active: state.activeSessionId !== null }); },
    });
}

function denyTicket(binding: TicketBinding): void {
    binding.lifecycle = 'denied';
    try { setDelete(binding.owner.reserved, binding.activateFence); setDelete(binding.owner.reserved, binding.retireFence); } catch { /* fail closed */ }
}

/** Commits the exact prepared P2b ticket without exposing record or session authority. */
/* @Codex */
export function commitAuthControlTicket(ticket: unknown): boolean {
    const binding = weakMapGet(ticketBindings, ticket);
    if (!binding || binding.lifecycle !== 'prepared') return false;
    const state = binding.owner;
    try {
        if (state.pending !== binding.pending || state.activeSessionId !== null || state.fence !== binding.fence || state.generation !== binding.generation
            || !setHas(state.reserved, binding.activateFence) || !setHas(state.reserved, binding.retireFence)
            || setHas(state.used, binding.activateFence) || setHas(state.used, binding.retireFence)) { denyTicket(binding); return false; }
        if (!setDelete(state.reserved, binding.activateFence)) { denyTicket(binding); return false; }
        setAdd(state.used, binding.activateFence);
    } catch { denyTicket(binding); return false; }
    state.activeSessionId = binding.sessionId;
    state.pending = null;
    state.fence = binding.activateFence;
    state.generation = binding.generation + ONE;
    binding.lifecycle = 'active';
    return true;
}

/** Retires the exact active binding once; exact same-reason replay is receipt-only. */
/* @Codex */
export function retireAuthControlTicket(ticket: unknown, reason: unknown): 0 | 1 | 2 {
    const binding = weakMapGet(ticketBindings, ticket);
    if (!binding || !retireReason(reason)) return 0;
    if (binding.lifecycle === 'retired') return binding.retiredReason === reason ? 2 : 0;
    if (binding.lifecycle !== 'active') return 0;
    const state = binding.owner;
    try {
        if (state.pending !== null || state.activeSessionId !== binding.sessionId || state.fence !== binding.activateFence || state.generation !== binding.generation + ONE
            || !setHas(state.reserved, binding.retireFence) || setHas(state.used, binding.retireFence)) { denyTicket(binding); return 0; }
        if (!setDelete(state.reserved, binding.retireFence)) { denyTicket(binding); return 0; }
        setAdd(state.used, binding.retireFence);
    } catch { denyTicket(binding); return 0; }
    binding.retiredReason = reason;
    state.activeSessionId = null;
    state.pending = null;
    state.fence = binding.retireFence;
    state.generation = binding.generation + ONE + ONE;
    binding.lifecycle = 'retired';
    return 1;
}
export const WEB_AUTH_PENDING_TTL_MS = PENDING_TTL_MS;
export const WEB_AUTH_REPLAY_TTL_MS = REPLAY_TTL_MS;
export const WEB_AUTH_IDEMPOTENCY_CAP = IDEMPOTENCY_CAP;
