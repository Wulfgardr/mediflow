/* @Codex */

import crypto from 'node:crypto';
import { types } from 'node:util';

const apply = Reflect.apply;
const ObjectConstructor = Object;
const ObjectCreate = Object.create;
const freeze = Object.freeze;
const MapConstructor = Map;
const WeakMapConstructor = WeakMap;
const BufferPrototype = Buffer.prototype;
const getPrototypeOfIntrinsic = Object.getPrototypeOf;
const isBufferIntrinsic = Buffer.isBuffer;
const isProxyIntrinsic = types.isProxy;
const byteLengthIntrinsic = ObjectConstructor.getOwnPropertyDescriptor(ObjectConstructor.getPrototypeOf(Uint8Array.prototype), 'byteLength')?.get;
const mapGetIntrinsic = Map.prototype.get;
const mapSetIntrinsic = Map.prototype.set;
const mapDeleteIntrinsic = Map.prototype.delete;
const mapSizeIntrinsic = ObjectConstructor.getOwnPropertyDescriptor(Map.prototype, 'size')?.get;
const weakMapGetIntrinsic = WeakMap.prototype.get;
const weakMapSetIntrinsic = WeakMap.prototype.set;
const weakMapDeleteIntrinsic = WeakMap.prototype.delete;
const randomBytesIntrinsic = crypto.randomBytes;
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
type FenceTable = { [key: string]: true | undefined };
type ControlState = {
    fence: string; generation: bigint; pending: Pending | null; activeSessionId: string | null; clock: number;
    ticketedPending: Pending | null; used: FenceTable; reserved: FenceTable; entries: Map<string, Entry>;
};
type TicketBinding = {
    lifecycle: 'prepared' | 'activation_prepared' | 'active' | 'retirement_prepared' | 'retired' | 'denied'; owner: ControlState; pending: Pending;
    fence: string; generation: bigint; sessionId: string; activateFence: string; retireFence: string;
    retiredReason: RetireReason | null;
};
type RetireReason = 'lock' | 'dispose' | 'expired' | 'delete' | 'clear';
declare const authControlTicketBrand: unique symbol;
export type AuthControlTicket = { readonly [authControlTicketBrand]: never };
declare const preparedAuthControlActivationBrand: unique symbol;
export type PreparedAuthControlActivation = { readonly [preparedAuthControlActivationBrand]: never };
type PreparedAuthControlActivationRecord = {
    lifecycle: 'prepared' | 'committed' | 'denied'; capability: PreparedAuthControlActivation; binding: TicketBinding;
};
declare const preparedAuthControlRetirementBrand: unique symbol;
export type PreparedAuthControlRetirement = { readonly [preparedAuthControlRetirementBrand]: never };
type PreparedAuthControlRetirementRecord = {
    lifecycle: 'prepared' | 'committed' | 'denied'; capability: PreparedAuthControlRetirement; binding: TicketBinding; reason: RetireReason;
};
const denied = freeze({ ok: false } as const);
const frozen = <Value>(value: Value): Readonly<Value> => apply(freeze, ObjectConstructor, [value]) as Readonly<Value>;
const mapGet = <Value>(map: Map<string, Value>, key: string): Value | undefined => apply(mapGetIntrinsic, map, [key]) as Value | undefined;
const mapSet = <Value>(map: Map<string, Value>, key: string, value: Value): void => { apply(mapSetIntrinsic, map, [key, value]); };
const mapDelete = (map: Map<string, unknown>, key: string): boolean => apply(mapDeleteIntrinsic, map, [key]) as boolean;
const mapSize = (map: Map<string, unknown>): number => apply(mapSizeIntrinsic!, map, []) as number;
const tableHas = (table: FenceTable, value: string): boolean => table[value] === true;
const tableAdd = (table: FenceTable, value: string): void => { table[value] = true; };
const tableDelete = (table: FenceTable, value: string): void => { delete table[value]; };
const weakMapGet = <Value>(map: WeakMap<object, Value>, key: unknown): Value | undefined =>
    (typeof key === 'object' && key !== null) || typeof key === 'function' ? apply(weakMapGetIntrinsic, map, [key]) as Value | undefined : undefined;
const weakMapSet = <Value>(map: WeakMap<object, Value>, key: object, value: Value): void => { apply(weakMapSetIntrinsic, map, [key, value]); };
const weakMapDelete = (map: WeakMap<object, unknown>, key: object): boolean => apply(weakMapDeleteIntrinsic, map, [key]) as boolean;
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
const time = (value: unknown): value is number => typeof value === 'number' && isSafeInteger(value) && value >= 0;
const u64 = (value: unknown): value is bigint => typeof value === 'bigint' && value >= ZERO && value <= MAX_U64;
const ticketBindings = new WeakMapConstructor<object, TicketBinding>();
let preparedAuthControlActivation: PreparedAuthControlActivationRecord | null = null;
let preparedAuthControlRetirement: PreparedAuthControlRetirementRecord | null = null;
let ticketOperationActive = false;
let ticketOperationPoisoned = false;
let currentBindingObservationActive = false;
let currentBindingObservationPoisoned = false;
const enterCurrentBindingObservation = (): boolean => {
    if (currentBindingObservationActive) { currentBindingObservationPoisoned = true; return false; }
    currentBindingObservationActive = true; currentBindingObservationPoisoned = false; return true;
};
const leaveCurrentBindingObservation = (): void => { currentBindingObservationActive = false; currentBindingObservationPoisoned = false; };
const enterTicketOperation = (): boolean => {
    if (ticketOperationActive) { ticketOperationPoisoned = true; return false; }
    ticketOperationActive = true; ticketOperationPoisoned = false; return true;
};
const leaveTicketOperation = (): void => { ticketOperationActive = false; ticketOperationPoisoned = false; };
const opaque = <Value>(): Value => apply(freeze, ObjectConstructor, [apply(ObjectCreate, ObjectConstructor, [null])]) as Value;
const retireReason = (value: unknown): value is RetireReason => value === 'lock' || value === 'dispose' || value === 'expired' || value === 'delete' || value === 'clear';
const successorFence = (): string | null => {
    const bytes = apply(randomBytesIntrinsic, crypto, [32]) as unknown;
    if (typeof bytes !== 'object' || bytes === null || apply(isProxyIntrinsic, types, [bytes])
        || !apply(isBufferIntrinsic, Buffer, [bytes]) || apply(getPrototypeOfIntrinsic, ObjectConstructor, [bytes]) !== BufferPrototype
        || apply(byteLengthIntrinsic!, bytes, []) !== 32) return null;
    const digits = '0123456789abcdef'; let output = '';
    for (let index = 0; index < 32; index += 1) { const byte = (bytes as Buffer)[index]!; output += digits[byte >> 4]! + digits[byte & 15]!; }
    return output;
};

/** Process-local P2a state; callers supply primitive ordering data only. */
/* @Codex */
export function createWebAuthControlRecord(initialFence: unknown, initialGeneration: unknown = ZERO) {
    if (!text(initialFence) || !u64(initialGeneration)) throw new TypeError('invalid trusted control state');
    const state: ControlState = { fence: initialFence, generation: initialGeneration, pending: null, activeSessionId: null, clock: 0, ticketedPending: null,
        used: apply(ObjectCreate, ObjectConstructor, [null]) as FenceTable, reserved: apply(ObjectCreate, ObjectConstructor, [null]) as FenceTable, entries: new MapConstructor<string, Entry>() };
    tableAdd(state.used, state.fence);
    const tick = (value: unknown): number | null => { if (!time(value)) return null; state.clock = max(state.clock, value); if (state.pending && state.clock - state.pending.createdAt >= PENDING_TTL_MS) state.pending = null; return state.clock; };
    const replay = (key: unknown, fingerprint: unknown, requestFence: unknown, at: number): Entry | null | false => {
        if (!text(key) || !text(fingerprint) || !text(requestFence)) return false;
        const entry = mapGet(state.entries, key);
        return !entry ? null : entry.fingerprint === fingerprint && entry.requestFence === requestFence && at - entry.createdAt < REPLAY_TTL_MS ? entry : false;
    };
    const successor = (value: unknown): string | null => text(value) ? value : null;
    const next = (value: string, expectedFence: string, expectedGeneration: bigint, expectedPending: Pending | null): string | null =>
        expectedGeneration === MAX_U64 || tableHas(state.used, value) || state.fence !== expectedFence || state.generation !== expectedGeneration || state.pending !== expectedPending ? null : value;
    const advance = (value: string, output: Readonly<{ ok: true; fence: string; generation: bigint }>): Result => { state.fence = value; tableAdd(state.used, value); state.generation += ONE; return output; };
    let beginOperationActive = false; let beginOperationPoisoned = false;
    let pendingCancellationActive = false; let pendingCancellationPoisoned = false;
    return frozen({
        begin(kind: unknown, operation: unknown, key: unknown, fingerprint: unknown, at: unknown): Result {
            if (beginOperationActive) { beginOperationPoisoned = true; return denied; }
            beginOperationActive = true; beginOperationPoisoned = false;
            let preparedKey: string | null = null; let preparedPending: Pending | null = null;
            const rollback = (): void => {
                if (state.pending === preparedPending) state.pending = null;
                if (preparedKey) { try { mapDelete(state.entries, preparedKey); } catch { /* deny */ } }
            };
            try {
                const current = tick(at); if (current === null || (kind !== 'login' && kind !== 'setup') || !text(operation) || !text(key) || !text(fingerprint)) return denied;
                const prior = replay(key, fingerprint, state.fence, current); if (beginOperationPoisoned) return denied;
                if (prior) return prior.kind === 'begin' ? frozen({ ok: true, fence: prior.fence, generation: prior.generation }) : denied;
                const size = mapSize(state.entries); if (beginOperationPoisoned || prior === false || size >= IDEMPOTENCY_CAP || state.pending || state.activeSessionId) return denied;
                preparedPending = frozen({ operation, fingerprint, generation: state.generation, createdAt: current });
                const preparedEntry = frozen({ kind: 'begin' as const, requestFence: state.fence, fence: state.fence, fingerprint, generation: state.generation, createdAt: current });
                const output = frozen({ ok: true as const, fence: state.fence, generation: state.generation });
                if (beginOperationPoisoned) return denied; preparedKey = key; mapSet(state.entries, key, preparedEntry);
                if (beginOperationPoisoned) { rollback(); return denied; }
                state.pending = preparedPending; return output;
            } catch { rollback(); return denied; }
            finally { beginOperationActive = false; beginOperationPoisoned = false; }
        },
        cancelPendingAuth(expectedFence: unknown, operation: unknown, expectedGeneration: unknown, fingerprint: unknown, at: unknown): 0 | 1 {
            if (pendingCancellationActive) { pendingCancellationPoisoned = true; return 0; }
            pendingCancellationActive = true; pendingCancellationPoisoned = false;
            try {
                if (!text(expectedFence) || !text(operation) || !u64(expectedGeneration) || !text(fingerprint) || !time(at)) return 0;
                const match = state.pending;
                if (!match || state.ticketedPending === match || state.activeSessionId !== null || state.fence !== expectedFence
                    || state.generation !== expectedGeneration || match.operation !== operation || match.fingerprint !== fingerprint
                    || match.generation !== expectedGeneration) return 0;
                const current = state.clock >= at ? state.clock : at;
                if (pendingCancellationPoisoned || state.pending !== match || state.ticketedPending === match) return 0;
                state.clock = current;
                if (current - match.createdAt >= PENDING_TTL_MS) { state.pending = null; return 0; }
                state.pending = null; return 1;
            } catch { return 0; }
            finally { pendingCancellationActive = false; pendingCancellationPoisoned = false; }
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
            state.pending = null; state.activeSessionId = null; state.fence = nextFence; tableAdd(state.used, nextFence); state.generation = nextGeneration; mapSet(state.entries, key, entry);
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
            if (!enterTicketOperation()) return null;
            let activateFence: string | null = null; let retireFence: string | null = null; let ticket: AuthControlTicket | null = null; let bound = false; let published = false;
            try {
                if (!text(expectedFence) || !text(operation) || !u64(expectedGeneration) || !text(fingerprint) || !text(sessionId) || tick(at) === null) return null;
                const match = state.pending;
                if (!match || state.activeSessionId || expectedGeneration >= MAX_TICKET_START || state.fence !== expectedFence || state.generation !== expectedGeneration
                    || match.operation !== operation || match.fingerprint !== fingerprint || match.generation !== state.generation) return null;
                activateFence = successorFence(); retireFence = successorFence();
                if (ticketOperationPoisoned || !activateFence || !retireFence || state.pending !== match || state.fence !== expectedFence || state.generation !== expectedGeneration
                    || state.activeSessionId || activateFence === retireFence || tableHas(state.used, activateFence) || tableHas(state.used, retireFence)
                    || tableHas(state.reserved, activateFence) || tableHas(state.reserved, retireFence)) return null;
                if (ticketOperationPoisoned) return null;
                ticket = opaque<AuthControlTicket>();
                const binding: TicketBinding = { lifecycle: 'prepared', owner: state, pending: match, fence: expectedFence,
                    generation: expectedGeneration, sessionId, activateFence, retireFence, retiredReason: null };
                tableAdd(state.reserved, activateFence); tableAdd(state.reserved, retireFence);
                bound = true; weakMapSet(ticketBindings, ticket, binding); if (ticketOperationPoisoned) return null;
                state.ticketedPending = match;
                published = true;
                return ticket;
            } catch { return null; }
            finally {
                if (!published) {
                    try { if (bound && ticket) weakMapDelete(ticketBindings, ticket); } catch { /* unreachable ticket remains denied */ }
                    if (activateFence) tableDelete(state.reserved, activateFence); if (retireFence) tableDelete(state.reserved, retireFence);
                }
                leaveTicketOperation();
            }
        },
        snapshot(): Readonly<{ fence: string; generation: bigint; pending: boolean; active: boolean }> { return frozen({ fence: state.fence, generation: state.generation, pending: state.pending !== null, active: state.activeSessionId !== null }); },
    });
}

/** Burns one exact prepared ticket and clears only its still-current pending attempt. */
/* @Codex */
export function abortPreparedAuthControlTicket(ticket: unknown): boolean {
    if (!enterTicketOperation()) return false;
    try {
        const binding = weakMapGet(ticketBindings, ticket);
        if (ticketOperationPoisoned || !binding || binding.lifecycle !== 'prepared') return false;
        const state = binding.owner;
        const clearsPending = state.pending === binding.pending && state.ticketedPending === binding.pending
            && state.activeSessionId === null && state.fence === binding.fence && state.generation === binding.generation;
        denyTicket(binding);
        if (clearsPending) { state.pending = null; state.ticketedPending = null; }
        return true;
    } catch { return false; }
    finally { leaveTicketOperation(); }
}

function denyTicket(binding: TicketBinding): void {
    binding.lifecycle = 'denied';
    tableDelete(binding.owner.reserved, binding.activateFence); tableDelete(binding.owner.reserved, binding.retireFence);
}

function denyPreparedAuthControlActivation(record: PreparedAuthControlActivationRecord): void {
    if (record.lifecycle !== 'prepared') return;
    record.lifecycle = 'denied';
    if (preparedAuthControlActivation === record) preparedAuthControlActivation = null;
    if (record.binding.lifecycle === 'activation_prepared') denyTicket(record.binding);
}

/** Resolves one exact ticket and session binding before the fallible-free final CAS. */
/* @Codex */
export function prepareAuthControlActivation(ticket: unknown, exactSessionId: unknown): PreparedAuthControlActivation | null {
    if (!enterTicketOperation()) return null;
    let binding: TicketBinding | undefined;
    try {
        binding = weakMapGet(ticketBindings, ticket);
        if (!binding || binding.lifecycle !== 'prepared' || !text(exactSessionId) || binding.sessionId !== exactSessionId || ticketOperationPoisoned) {
            if (binding?.lifecycle === 'activation_prepared' && preparedAuthControlActivation?.binding === binding) denyPreparedAuthControlActivation(preparedAuthControlActivation);
            else if (binding?.lifecycle === 'prepared') denyTicket(binding);
            return null;
        }
        if (preparedAuthControlActivation) {
            denyPreparedAuthControlActivation(preparedAuthControlActivation);
            denyTicket(binding);
            return null;
        }
        const state = binding.owner;
        if (state.pending !== binding.pending || state.activeSessionId !== null || state.fence !== binding.fence || state.generation !== binding.generation
            || binding.pending.operation.length === 0 || binding.pending.generation !== binding.generation
            || !tableHas(state.reserved, binding.activateFence) || !tableHas(state.reserved, binding.retireFence)
            || tableHas(state.used, binding.activateFence) || tableHas(state.used, binding.retireFence)) {
            denyTicket(binding);
            return null;
        }
        const capability = opaque<PreparedAuthControlActivation>();
        const record: PreparedAuthControlActivationRecord = { lifecycle: 'prepared', capability, binding };
        preparedAuthControlActivation = record;
        binding.lifecycle = 'activation_prepared';
        if (ticketOperationPoisoned) { denyPreparedAuthControlActivation(record); return null; }
        return capability;
    } catch {
        if (!binding) { try { binding = weakMapGet(ticketBindings, ticket); } catch { /* unresolved input remains denied */ } }
        if (binding?.lifecycle === 'activation_prepared' && preparedAuthControlActivation?.binding === binding) denyPreparedAuthControlActivation(preparedAuthControlActivation);
        else if (binding?.lifecycle === 'prepared') denyTicket(binding);
        return null;
    } finally { leaveTicketOperation(); }
}

/** Performs only the exact prepared lexical CAS; no registry or caller work is entered. */
/* @Codex */
export function commitPreparedAuthControlActivation(prepared: unknown): 0 | 1 {
    const activation = preparedAuthControlActivation;
    preparedAuthControlActivation = null;
    if (!activation) return 0;
    const binding = activation.binding;
    const state = binding.owner;
    if (prepared !== activation.capability || activation.lifecycle !== 'prepared' || binding.lifecycle !== 'activation_prepared'
        || state.pending !== binding.pending || state.activeSessionId !== null || state.fence !== binding.fence || state.generation !== binding.generation
        || state.reserved[binding.activateFence] !== true || state.reserved[binding.retireFence] !== true
        || state.used[binding.activateFence] === true || state.used[binding.retireFence] === true) {
        activation.lifecycle = 'denied'; binding.lifecycle = 'denied';
        delete state.reserved[binding.activateFence]; delete state.reserved[binding.retireFence];
        return 0;
    }
    delete state.reserved[binding.activateFence]; state.used[binding.activateFence] = true;
    state.activeSessionId = binding.sessionId; state.pending = null; state.fence = binding.activateFence;
    state.generation = binding.generation + ONE; binding.lifecycle = 'active'; activation.lifecycle = 'committed';
    return 1;
}

/** Burns one exact prepared activation without mutating control authority. */
/* @Codex */
export function abortPreparedAuthControlActivation(prepared: unknown): boolean {
    const activation = preparedAuthControlActivation;
    if (!activation) return false;
    const exact = prepared === activation.capability && activation.lifecycle === 'prepared';
    denyPreparedAuthControlActivation(activation);
    return exact;
}

/** Observes one exact ACTIVE ticket/session binding without spending or exposing it. */
/* @Codex */
export function isCurrentAuthControlSessionBinding(ticket: unknown, exactSessionId: unknown): boolean {
    if (!enterCurrentBindingObservation()) return false;
    try {
        if (!text(exactSessionId)) return false;
        const binding = weakMapGet(ticketBindings, ticket);
        if (currentBindingObservationPoisoned || !binding || binding.lifecycle !== 'active'
            || binding.sessionId !== exactSessionId || binding.retiredReason !== null) return false;
        const state = binding.owner;
        const current = state.pending === null && state.activeSessionId === binding.sessionId
            && state.fence === binding.activateFence && state.generation === binding.generation + ONE
            && state.reserved[binding.activateFence] !== true && state.used[binding.activateFence] === true
            && state.reserved[binding.retireFence] === true && state.used[binding.retireFence] !== true;
        return !currentBindingObservationPoisoned && current;
    } catch { return false; } finally { leaveCurrentBindingObservation(); }
}

function denyPreparedAuthControlRetirement(record: PreparedAuthControlRetirementRecord): void {
    if (record.lifecycle !== 'prepared') return;
    record.lifecycle = 'denied';
    if (preparedAuthControlRetirement === record) preparedAuthControlRetirement = null;
    if (record.binding.lifecycle === 'retirement_prepared') denyTicket(record.binding);
}

/** Resolves one active ticket, session, and reason before the fallible-free retirement CAS. */
/* @Codex */
export function prepareAuthControlRetirement(ticket: unknown, exactSessionId: unknown, exactReason: unknown): PreparedAuthControlRetirement | null {
    if (!enterTicketOperation()) return null;
    let binding: TicketBinding | undefined;
    try {
        binding = weakMapGet(ticketBindings, ticket);
        if (!binding || binding.lifecycle !== 'active' || !text(exactSessionId) || binding.sessionId !== exactSessionId
            || !retireReason(exactReason) || ticketOperationPoisoned) {
            if (binding?.lifecycle === 'retirement_prepared' && preparedAuthControlRetirement?.binding === binding) denyPreparedAuthControlRetirement(preparedAuthControlRetirement);
            else if (binding?.lifecycle === 'active') denyTicket(binding);
            return null;
        }
        if (preparedAuthControlRetirement) {
            denyPreparedAuthControlRetirement(preparedAuthControlRetirement);
            denyTicket(binding);
            return null;
        }
        const state = binding.owner;
        if (state.pending !== null || state.activeSessionId !== binding.sessionId || state.fence !== binding.activateFence
            || state.generation !== binding.generation + ONE || !tableHas(state.reserved, binding.retireFence)
            || tableHas(state.used, binding.retireFence) || binding.retiredReason !== null) {
            denyTicket(binding);
            return null;
        }
        const capability = opaque<PreparedAuthControlRetirement>();
        const record: PreparedAuthControlRetirementRecord = { lifecycle: 'prepared', capability, binding, reason: exactReason };
        preparedAuthControlRetirement = record;
        binding.lifecycle = 'retirement_prepared';
        if (ticketOperationPoisoned) { denyPreparedAuthControlRetirement(record); return null; }
        return capability;
    } catch {
        if (!binding) { try { binding = weakMapGet(ticketBindings, ticket); } catch { /* unresolved input remains denied */ } }
        if (binding?.lifecycle === 'retirement_prepared' && preparedAuthControlRetirement?.binding === binding) denyPreparedAuthControlRetirement(preparedAuthControlRetirement);
        else if (binding?.lifecycle === 'active') denyTicket(binding);
        return null;
    } finally { leaveTicketOperation(); }
}

/** Performs only the exact prepared lexical retirement CAS; no registry or caller work is entered. */
/* @Codex */
export function commitPreparedAuthControlRetirement(prepared: unknown): 0 | 2 {
    const retirement = preparedAuthControlRetirement;
    preparedAuthControlRetirement = null;
    if (!retirement) return 0;
    const binding = retirement.binding;
    const state = binding.owner;
    if (prepared !== retirement.capability || retirement.lifecycle !== 'prepared' || binding.lifecycle !== 'retirement_prepared'
        || state.pending !== null || state.activeSessionId !== binding.sessionId || state.fence !== binding.activateFence
        || state.generation !== binding.generation + ONE || state.reserved[binding.retireFence] !== true
        || state.used[binding.retireFence] === true || binding.retiredReason !== null) {
        retirement.lifecycle = 'denied'; binding.lifecycle = 'denied';
        delete state.reserved[binding.activateFence]; delete state.reserved[binding.retireFence];
        return 0;
    }
    delete state.reserved[binding.retireFence]; state.used[binding.retireFence] = true;
    binding.retiredReason = retirement.reason; state.activeSessionId = null; state.pending = null;
    state.fence = binding.retireFence; state.generation = binding.generation + ONE + ONE;
    binding.lifecycle = 'retired'; retirement.lifecycle = 'committed';
    return 2;
}

/** Burns one exact prepared retirement without reviving control authority. */
/* @Codex */
export function abortPreparedAuthControlRetirement(prepared: unknown): boolean {
    const retirement = preparedAuthControlRetirement;
    if (!retirement) return false;
    const exact = prepared === retirement.capability && retirement.lifecycle === 'prepared';
    denyPreparedAuthControlRetirement(retirement);
    return exact;
}

/** Commits the exact prepared P2b ticket without exposing record or session authority. */
/* @Codex */
export function commitAuthControlTicket(ticket: unknown): boolean {
    if (!enterTicketOperation()) return false;
    let binding: TicketBinding | undefined;
    try {
        binding = weakMapGet(ticketBindings, ticket);
        if (ticketOperationPoisoned || !binding || binding.lifecycle !== 'prepared') { leaveTicketOperation(); return false; }
        const state = binding.owner;
        if (state.pending !== binding.pending || state.activeSessionId !== null || state.fence !== binding.fence || state.generation !== binding.generation
            || !tableHas(state.reserved, binding.activateFence) || !tableHas(state.reserved, binding.retireFence)
            || tableHas(state.used, binding.activateFence) || tableHas(state.used, binding.retireFence) || ticketOperationPoisoned) throw new Error('ticket denied');
    } catch {
        if (binding?.lifecycle === 'prepared') denyTicket(binding);
        leaveTicketOperation(); return false;
    }
    const state = binding.owner;
    tableDelete(state.reserved, binding.activateFence);
    tableAdd(state.used, binding.activateFence);
    state.activeSessionId = binding.sessionId;
    state.pending = null;
    state.fence = binding.activateFence;
    state.generation = binding.generation + ONE;
    binding.lifecycle = 'active';
    ticketOperationActive = false; ticketOperationPoisoned = false;
    return true;
}

/** Retires the exact active binding once; exact same-reason replay is receipt-only. */
/* @Codex */
export function retireAuthControlTicket(ticket: unknown, reason: unknown): 0 | 1 | 2 {
    if (!enterTicketOperation()) return 0;
    let binding: TicketBinding | undefined;
    try {
        binding = weakMapGet(ticketBindings, ticket);
        if (ticketOperationPoisoned || !binding) { leaveTicketOperation(); return 0; }
        if (binding.lifecycle === 'prepared') { denyTicket(binding); leaveTicketOperation(); return 0; }
        if (!retireReason(reason)) { leaveTicketOperation(); return 0; }
        if (binding.lifecycle === 'retired') { const replay = binding.retiredReason === reason ? 2 : 0; leaveTicketOperation(); return replay; }
        if (binding.lifecycle !== 'active') { leaveTicketOperation(); return 0; }
        const state = binding.owner;
        if (state.pending !== null || state.activeSessionId !== binding.sessionId || state.fence !== binding.activateFence || state.generation !== binding.generation + ONE
            || !tableHas(state.reserved, binding.retireFence) || tableHas(state.used, binding.retireFence) || ticketOperationPoisoned) throw new Error('ticket denied');
    } catch {
        if (binding?.lifecycle === 'prepared') denyTicket(binding);
        leaveTicketOperation(); return 0;
    }
    const state = binding.owner;
    tableDelete(state.reserved, binding.retireFence);
    tableAdd(state.used, binding.retireFence);
    binding.retiredReason = reason;
    state.activeSessionId = null;
    state.pending = null;
    state.fence = binding.retireFence;
    state.generation = binding.generation + ONE + ONE;
    binding.lifecycle = 'retired';
    ticketOperationActive = false; ticketOperationPoisoned = false;
    return 1;
}
export const WEB_AUTH_PENDING_TTL_MS = PENDING_TTL_MS;
export const WEB_AUTH_REPLAY_TTL_MS = REPLAY_TTL_MS;
export const WEB_AUTH_IDEMPOTENCY_CAP = IDEMPOTENCY_CAP;
