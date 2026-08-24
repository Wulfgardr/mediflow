/* @Codex */
import 'server-only';

import { randomBytes } from 'node:crypto';
import { types } from 'node:util';
import { createTypedProjectionBroker, ProjectionBrokerError, type TypedProjectionBrokerConfig } from '../typed-projection-broker';
import { bindProjectionBrokerToServerSession } from './server-session-projection-broker';
import { getSession, peekSession, registerServerSessionResource, type ServerSession } from './server-session';

type TypedBroker = ReturnType<typeof createTypedProjectionBroker>;
type ActiveBinding = {
    selection: SelectionState; active: boolean; control: TypedBroker['control']; unregister: (() => void) | null;
    ingest: TypedBroker['ingest']; service: TypedBroker['service'];
};
type CanonicalPair = Readonly<{ patientId: string; ambulatoryId: string }>;
type SelectionSources = Readonly<{
    resolve(session: ServerSession, input: CanonicalPair): CanonicalPair;
    clock(): number;
    entropy(): Uint8Array;
    brokerFactory(config: TypedProjectionBrokerConfig): TypedBroker;
}>;
type SelectionLease = Readonly<{
    sessionRef: string; selectionEpoch: number; patientRef: string; ambulatoryRef: string;
    leaseRef: string; expiresAt: number;
}>;
type SelectionState = CanonicalPair & SelectionLease;

const authenticOwners = new WeakSet<object>();
const weakSetAdd = WeakSet.prototype.add;
const weakSetHas = WeakSet.prototype.has;
const weakMapSet = WeakMap.prototype.set;
const weakMapGet = WeakMap.prototype.get;
const applyIntrinsic = Reflect.apply;
const isProxy = types.isProxy;
const isAsyncFunction = types.isAsyncFunction;
const isPromise = types.isPromise;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const promiseThen = Promise.prototype.then;

function addOwnerIdentity(registry: WeakSet<object>, owner: object): void {
    applyIntrinsic(weakSetAdd, registry, [owner]);
}

function hasOwnerIdentity(registry: WeakSet<object>, candidate: object): boolean {
    return applyIntrinsic(weakSetHas, registry, [candidate]);
}

function setWeakMapValue<T>(registry: WeakMap<object, T>, key: object, value: T): void {
    applyIntrinsic(weakMapSet, registry, [key, value]);
}

function getWeakMapValue<T>(registry: WeakMap<object, T>, key: object): T | undefined {
    return applyIntrinsic(weakMapGet, registry, [key]);
}

export type ServerSessionProjectionOwnerErrorCode =
    | 'broker_factory_failed' | 'broker_unavailable' | 'epoch_conflict' | 'input_invalid' | 'lease_expired' | 'owner_disposed'
    | 'owner_acquiring' | 'owner_exists' | 'reference_unavailable' | 'selection_busy' | 'selection_unavailable'
    | 'session_ineligible' | 'session_unavailable' | 'stale_selection';

export class ServerSessionProjectionOwnerError extends Error {
    constructor(readonly code: ServerSessionProjectionOwnerErrorCode) {
        super(`Server session projection owner rejected: ${code}`);
        this.name = 'ServerSessionProjectionOwnerError';
    }
}

export type ServerSessionProjectionOwner = Readonly<{
    snapshotSelectionEpoch(session: ServerSession): number;
    snapshotReviewContextEpoch(session: ServerSession): number;
    acquireProjectionIngest(session: ServerSession, input: SelectionLeaseTuple): TypedBroker['ingest'];
    resolveProjectionService(session: ServerSession): TypedBroker['service'];
    issueSelection(input: Readonly<{ expectedEpoch: number; patientId: string; ambulatoryId: string }>): SelectionLease;
    dereferenceSelection(session: ServerSession, input: Readonly<{
        sessionRef: string; selectionEpoch: number; patientRef: string; ambulatoryRef: string; leaseRef: string;
    }>): CanonicalPair;
    withLeaseCriticalSection<T>(session: ServerSession, callback: (selection: CanonicalPair) => T): T;
    dispose(): void;
}>;

export type LeaseCommitTurn = object;
export type LeaseCommitTurnPhase = 'abort' | 'commit';
type LeaseCommitTurnState = {
    owner: ServerSessionProjectionOwner; session: ServerSession; phase: 'abort' | 'closed' | 'commit' | 'prepare';
    live: boolean; spent: boolean;
};
type LeaseCommitTurnRunner = (session: ServerSession, prepare: (selection: CanonicalPair) => unknown,
    commit: (prepared: unknown, turn: LeaseCommitTurn) => unknown, abort: (turn: LeaseCommitTurn) => unknown) => void;

const commitTurnRunners = new WeakMap<object, LeaseCommitTurnRunner>();
const commitTurnStates = new WeakMap<object, LeaseCommitTurnState>();

function synchronousCallback(candidate: unknown): candidate is (...args: never[]) => unknown {
    return typeof candidate === 'function' && !isProxy(candidate) && !isAsyncFunction(candidate);
}

function observeNativePromise(value: unknown): void {
    if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return;
    if (isProxy(value) || !isPromise(value)) return;
    try { applyIntrinsic(promiseThen, value, [undefined, () => undefined]); } catch { /* A late completion stays opaque. */ }
}

function hasThenable(value: unknown): boolean {
    if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return false;
    if (isProxy(value) || isPromise(value)) return true;
    try {
        let cursor: object | null = value;
        while (cursor) {
            if (isProxy(cursor) || getOwnPropertyDescriptor(cursor, 'then')) return true;
            cursor = getPrototypeOf(cursor);
        }
    } catch { return true; }
    return false;
}

function rejectThenable(value: unknown): void {
    if (!hasThenable(value)) return;
    observeNativePromise(value);
    return fail('input_invalid');
}

export function spendLeaseCommitTurn(owner: unknown, session: ServerSession, turn: unknown, phase: LeaseCommitTurnPhase): void {
    if (!isServerSessionProjectionOwner(owner) || (phase !== 'abort' && phase !== 'commit')
        || typeof turn !== 'object' || turn === null || isProxy(turn)) return fail('input_invalid');
    const state = getWeakMapValue(commitTurnStates, turn);
    if (!state || !state.live || state.spent || state.owner !== owner || state.session !== session || state.phase !== phase) {
        return fail('selection_unavailable');
    }
    state.spent = true;
}

export function withLeaseCommitTurn<T>(owner: unknown, session: ServerSession,
    prepare: (selection: CanonicalPair) => T, commit: (prepared: T, turn: LeaseCommitTurn) => unknown,
    abort: (turn: LeaseCommitTurn) => unknown): void {
    if (!isServerSessionProjectionOwner(owner) || !synchronousCallback(prepare)
        || !synchronousCallback(commit) || !synchronousCallback(abort)) return fail('input_invalid');
    const runner = getWeakMapValue(commitTurnRunners, owner);
    if (!runner) return fail('owner_disposed');
    runner(session, prepare as (selection: CanonicalPair) => unknown,
        commit as (prepared: unknown, turn: LeaseCommitTurn) => unknown, abort as (turn: LeaseCommitTurn) => unknown);
}

export function isServerSessionProjectionOwner(candidate: unknown): candidate is ServerSessionProjectionOwner {
    if (typeof candidate !== 'object' || candidate === null || isProxy(candidate)) return false;
    return hasOwnerIdentity(authenticOwners, candidate);
}

type SelectionLeaseTuple = Readonly<{ sessionRef: string; selectionEpoch: number; patientRef: string;
    ambulatoryRef: string; leaseRef: string }>;

function fail(code: ServerSessionProjectionOwnerErrorCode): never {
    throw new ServerSessionProjectionOwnerError(code);
}

function revoke(binding: ActiveBinding | null, unregister = true): void {
    if (!binding) return;
    binding.active = false;
    if (unregister) binding.unregister?.();
    binding.unregister = null;
    try { binding.control.revoke(); } catch { /* Authority remains removed and cleanup detail stays opaque. */ }
}

const defaultSources: SelectionSources = Object.freeze({
    resolve: () => fail('selection_unavailable'),
    clock: () => Date.now(),
    entropy: () => randomBytes(16),
    brokerFactory: (config) => createTypedProjectionBroker(config),
});

function exact(input: unknown, keys: readonly string[]): Record<string, unknown> {
    if (typeof input !== 'object' || input === null || Array.isArray(input)
        || Object.getPrototypeOf(input) !== Object.prototype || Reflect.ownKeys(input).length !== keys.length) {
        return fail('input_invalid');
    }
    const result: Record<string, unknown> = {};
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor || !('value' in descriptor)) return fail('input_invalid');
        result[key] = descriptor.value;
    }
    return result;
}

export function createServerSessionProjectionOwnerRegistry(sourceOverrides: Partial<SelectionSources> = {}) {
    const sources = Object.freeze({ ...defaultSources, ...sourceOverrides });
    const owners = new Map<string, ServerSessionProjectionOwner>();
    const registryOwners = new WeakSet<object>();
    const retired = new Set<string>();
    const acquiring = new Set<string>();

    const registry = {
        isAuthenticOwner(candidate: unknown): candidate is ServerSessionProjectionOwner {
            if (!isServerSessionProjectionOwner(candidate)) return false;
            return hasOwnerIdentity(registryOwners, candidate);
        },
        lookup(sessionId: string): ServerSessionProjectionOwner | null {
            return owners.get(sessionId) ?? null;
        },
        snapshotSelectionEpoch(session: ServerSession): number {
            if (session.authChannel !== 'web' || session.id === 'local-api' || peekSession(session.id) !== session) {
                return fail('session_ineligible');
            }
            return owners.get(session.id)?.snapshotSelectionEpoch(session) ?? 0;
        },
        snapshotReviewContextEpoch(session: ServerSession): number {
            if (session.authChannel !== 'web' || session.id === 'local-api' || peekSession(session.id) !== session) {
                return fail('session_ineligible');
            }
            return owners.get(session.id)?.snapshotReviewContextEpoch(session) ?? 0;
        },
        acquire(session: ServerSession): ServerSessionProjectionOwner {
            if (session.authChannel !== 'web' || session.id === 'local-api' || getSession(session.id) !== session) {
                return fail('session_ineligible');
            }
            return owners.get(session.id) ?? registry.create(session);
        },
        create(session: ServerSession): ServerSessionProjectionOwner {
            if (session.authChannel !== 'web' || session.id === 'local-api' || getSession(session.id) !== session) {
                return fail('session_ineligible');
            }
            if (owners.has(session.id)) return fail('owner_exists');
            if (retired.has(session.id)) return fail('owner_disposed');
            if (acquiring.has(session.id)) return fail('owner_acquiring');
            acquiring.add(session.id);
            try {

            let active: ActiveBinding | null = null;
            let epoch = 0;
            let reviewContextEpoch = 0;
            let selection: SelectionState | null = null;
            let selecting = false;
            let leaseCriticalSectionActive = false;
            let creating: SelectionState | null = null;
            let terminal = false;
            let unregisterOwner: (() => void) | null = null;
            const finish = (revokeActive: boolean) => {
                if (terminal) return;
                terminal = true;
                retired.add(session.id);
                owners.delete(session.id);
                unregisterOwner?.();
                unregisterOwner = null;
                const previous = active;
                active = null;
                selection = null;
                reviewContextEpoch += 1;
                if (previous && revokeActive) revoke(previous);
                else if (previous) { previous.active = false; previous.unregister = null; }
            };
            const issuedRefs = new Set<string>();
            const reference = (prefix: string) => {
                let bytes: Uint8Array;
                try { bytes = sources.entropy(); } catch { return fail('reference_unavailable'); }
                if (!(bytes instanceof Uint8Array) || bytes.byteLength < 16) return fail('reference_unavailable');
                let hex = ''; for (let index = 0; index < 16; index += 1) hex += bytes[index].toString(16).padStart(2, '0');
                const value = `${prefix}_${hex}`;
                if (issuedRefs.has(value)) return fail('reference_unavailable');
                issuedRefs.add(value); return value;
            };
            const sessionRef = reference('ssr');
            const readClock = () => {
                try { const now = sources.clock(); if (Number.isFinite(now)) return now; } catch { /* fixed error below */ }
                return fail('selection_unavailable');
            };
            const requireCurrentSession = (presented: ServerSession) => {
                if (terminal || presented !== session || session.authChannel !== 'web' || getSession(session.id) !== session) fail('session_unavailable');
            };
            const readTuple = (input: unknown) => exact(input, ['sessionRef', 'selectionEpoch', 'patientRef', 'ambulatoryRef', 'leaseRef']) as SelectionLeaseTuple;
            const tupleMatches = (value: SelectionLeaseTuple, current: SelectionState) =>
                value.sessionRef === sessionRef && value.selectionEpoch === current.selectionEpoch
                && value.patientRef === current.patientRef && value.ambulatoryRef === current.ambulatoryRef
                && value.leaseRef === current.leaseRef;
            const expire = () => {
                const previous = active; const hadSelection = selection !== null;
                active = null; selection = null;
                if (hadSelection) reviewContextEpoch += 1;
                revoke(previous);
            };
            const rejectLeaseCriticalSectionReentry = () => {
                if (leaseCriticalSectionActive) fail('selection_busy');
            };
            const commitTurnRunner: LeaseCommitTurnRunner = (presentedSession, prepare, commit, abort) => {
                if (leaseCriticalSectionActive) return fail('selection_busy');
                const current = selection;
                const expectedSelectionEpoch = epoch;
                const expectedReviewContextEpoch = reviewContextEpoch;
                const assertCurrent = () => {
                    requireCurrentSession(presentedSession);
                    if (!current || selection !== current || epoch !== expectedSelectionEpoch || reviewContextEpoch !== expectedReviewContextEpoch) {
                        return fail('stale_selection');
                    }
                    const now = readClock();
                    requireCurrentSession(presentedSession);
                    if (selection !== current || epoch !== expectedSelectionEpoch || reviewContextEpoch !== expectedReviewContextEpoch) {
                        return fail('stale_selection');
                    }
                    if (now >= current.expiresAt) { expire(); return fail('lease_expired'); }
                };
                leaseCriticalSectionActive = true;
                const turn = Object.freeze(Object.create(null));
                const state: LeaseCommitTurnState = { owner, session: presentedSession, phase: 'prepare', live: true, spent: false };
                setWeakMapValue(commitTurnStates, turn, state);
                const abortOnce = (cause: unknown): never => {
                    state.phase = 'abort';
                    let outcome: unknown;
                    const unsafeCause = hasThenable(cause);
                    observeNativePromise(cause);
                    try { outcome = abort(turn); } catch (error) { observeNativePromise(error); /* The primary precommit outcome remains authoritative. */ }
                    observeNativePromise(outcome);
                    if (!state.spent) return fail('selection_unavailable');
                    if (unsafeCause) return fail('input_invalid');
                    throw cause;
                };
                try {
                    let prepared: unknown;
                    try { assertCurrent(); prepared = prepare(Object.freeze({ patientId: current!.patientId, ambulatoryId: current!.ambulatoryId })); }
                    catch (error) { return abortOnce(error); }
                    try { rejectThenable(prepared); assertCurrent(); }
                    catch (error) { return abortOnce(error); }
                    state.phase = 'commit';
                    let outcome: unknown;
                    try { outcome = commit(prepared, turn); } catch (error) {
                        observeNativePromise(error);
                        if (state.spent) return;
                        return abortOnce(error);
                    }
                    observeNativePromise(outcome);
                    if (state.spent) return;
                    return abortOnce(new ServerSessionProjectionOwnerError('selection_unavailable'));
                } finally {
                    state.live = false;
                    state.phase = 'closed';
                    leaseCriticalSectionActive = false;
                }
            };
            const candidateControl = (candidate: unknown): TypedBroker['control'] | null => {
                if (typeof candidate !== 'object' || candidate === null) return null;
                const descriptor = Object.getOwnPropertyDescriptor(candidate, 'control');
                if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'object' || !descriptor.value) return null;
                return typeof descriptor.value.revoke === 'function' ? descriptor.value as TypedBroker['control'] : null;
            };
            const validCandidate = (candidate: unknown): candidate is TypedBroker => {
                if (typeof candidate !== 'object' || candidate === null) return false;
                const value = candidate as Partial<TypedBroker>;
                return typeof value.ingest?.ingest === 'function' && typeof value.service?.consume === 'function'
                    && typeof value.control?.lock === 'function' && typeof value.control.revoke === 'function'
                    && typeof value.control.changeSelection === 'function';
            };
            const owner: ServerSessionProjectionOwner = Object.freeze({
                snapshotSelectionEpoch(presentedSession) {
                    if (terminal || presentedSession !== session || session.authChannel !== 'web' || peekSession(session.id) !== session) {
                        return fail('session_unavailable');
                    }
                    return epoch;
                },
                snapshotReviewContextEpoch(presentedSession) {
                    if (terminal || presentedSession !== session || session.authChannel !== 'web' || peekSession(session.id) !== session) {
                        return fail('session_unavailable');
                    }
                    return reviewContextEpoch;
                },
                acquireProjectionIngest(presentedSession, input) {
                    rejectLeaseCriticalSectionReentry();
                    requireCurrentSession(presentedSession);
                    const value = readTuple(input); const current = selection;
                    if (!current || !tupleMatches(value, current)) return fail('stale_selection');
                    if (readClock() >= current.expiresAt) { expire(); return fail('lease_expired'); }
                    if (active?.selection === current && active.active) return active.ingest;
                    if (creating === current) return fail('broker_unavailable');
                    creating = current;
                    let candidate: unknown;
                    try {
                        candidate = sources.brokerFactory({ sessionRef: current.sessionRef, ambulatoryRef: current.ambulatoryRef,
                            patientRef: current.patientRef, selectionEpoch: current.selectionEpoch, leaseRef: current.leaseRef,
                            expiresAt: new Date(current.expiresAt).toISOString() });
                    } catch { creating = null; return fail('broker_factory_failed'); }
                    creating = null;
                    try { if (!validCandidate(candidate)) throw new Error('malformed'); }
                    catch {
                        try { candidateControl(candidate)?.revoke(); } catch { /* Opaque cleanup failure. */ }
                        return fail('broker_factory_failed');
                    }
                    try {
                        requireCurrentSession(presentedSession);
                        if (selection !== current || !tupleMatches(value, current)) fail('stale_selection');
                        if (readClock() >= current.expiresAt) { expire(); fail('lease_expired'); }
                    } catch (error) {
                        try { candidate.control.revoke(); } catch { /* Opaque cleanup failure. */ }
                        throw error;
                    }
                    const binding = { selection: current, active: false, control: candidate.control,
                        unregister: null } as ActiveBinding;
                    const assertActive = () => {
                        if (!binding.active || active !== binding || selection !== current) {
                            throw new ProjectionBrokerError('broker_revoked');
                        }
                    };
                    binding.ingest = Object.freeze({ ingest(value) { assertActive(); return candidate.ingest.ingest(value); } });
                    binding.service = Object.freeze({ consume(value) { assertActive(); return candidate.service.consume(value); } });
                    try { binding.unregister = bindProjectionBrokerToServerSession(session.id, candidate.control); }
                    catch { return fail('session_unavailable'); }
                    binding.active = true; active = binding;
                    return binding.ingest;
                },
                resolveProjectionService(presentedSession) {
                    rejectLeaseCriticalSectionReentry();
                    requireCurrentSession(presentedSession);
                    if (!selection) return fail('stale_selection');
                    if (readClock() >= selection.expiresAt) { expire(); return fail('lease_expired'); }
                    if (!active?.active || active.selection !== selection) return fail('broker_unavailable');
                    return active.service;
                },
                issueSelection(input) {
                    rejectLeaseCriticalSectionReentry();
                    if (terminal) return fail('session_unavailable');
                    if (selecting) return fail('selection_busy');
                    selecting = true;
                    try {
                        const value = exact(input, ['expectedEpoch', 'patientId', 'ambulatoryId']);
                        if (!Number.isSafeInteger(value.expectedEpoch) || (value.expectedEpoch as number) < 0
                            || typeof value.patientId !== 'string' || typeof value.ambulatoryId !== 'string') fail('input_invalid');
                        const live = getSession(session.id);
                        if (session.authChannel !== 'web' || live !== session) fail('session_unavailable');
                        let pair: CanonicalPair;
                        try { pair = sources.resolve(session, { patientId: value.patientId, ambulatoryId: value.ambulatoryId }); }
                        catch { return fail('selection_unavailable'); }
                        const finalSession = getSession(session.id);
                        if (finalSession !== session || session.authChannel !== 'web') fail('session_unavailable');
                        if (value.expectedEpoch !== epoch) fail('epoch_conflict');
                        const now = readClock(); const expiresAt = finalSession.expiresAt;
                        if (now >= expiresAt) fail('lease_expired');
                        const next: SelectionState = Object.freeze({ ...pair, sessionRef, selectionEpoch: epoch + 1,
                            patientRef: reference('ptr'), ambulatoryRef: reference('abr'), leaseRef: reference('lsr'),
                            expiresAt });
                        const previous = active; active = null; revoke(previous);
                        reviewContextEpoch += 1;
                        epoch = next.selectionEpoch; selection = next;
                        return Object.freeze({ sessionRef, selectionEpoch: next.selectionEpoch, patientRef: next.patientRef,
                            ambulatoryRef: next.ambulatoryRef, leaseRef: next.leaseRef, expiresAt });
                    } finally { selecting = false; }
                },
                dereferenceSelection(presentedSession, input) {
                    rejectLeaseCriticalSectionReentry();
                    const value = exact(input, ['sessionRef', 'selectionEpoch', 'patientRef', 'ambulatoryRef', 'leaseRef']);
                    if (terminal) return fail('session_unavailable');
                    if (!selection) return fail('stale_selection');
                    if (readClock() >= selection.expiresAt) {
                        expire(); return fail('lease_expired');
                    }
                    if (presentedSession !== session || getSession(session.id) !== session) fail('session_unavailable');
                    if (value.sessionRef !== sessionRef || value.selectionEpoch !== selection.selectionEpoch
                        || value.patientRef !== selection.patientRef || value.ambulatoryRef !== selection.ambulatoryRef
                        || value.leaseRef !== selection.leaseRef) fail('stale_selection');
                    return Object.freeze({ patientId: selection.patientId, ambulatoryId: selection.ambulatoryId });
                },
                withLeaseCriticalSection(presentedSession, callback) {
                    if (leaseCriticalSectionActive) return fail('selection_busy');
                    if (typeof callback !== 'function') return fail('input_invalid');
                    requireCurrentSession(presentedSession);
                    const current = selection;
                    if (!current) return fail('stale_selection');
                    if (readClock() >= current.expiresAt) { expire(); return fail('lease_expired'); }
                    const expectedSelectionEpoch = epoch;
                    const expectedReviewContextEpoch = reviewContextEpoch;
                    const assertUnchanged = () => {
                        requireCurrentSession(presentedSession);
                        if (selection !== current || epoch !== expectedSelectionEpoch || reviewContextEpoch !== expectedReviewContextEpoch) {
                            return fail('stale_selection');
                        }
                        if (readClock() >= current.expiresAt) { expire(); return fail('lease_expired'); }
                    };
                    leaseCriticalSectionActive = true;
                    try {
                        let result: unknown;
                        try {
                            result = callback(Object.freeze({ patientId: current.patientId, ambulatoryId: current.ambulatoryId }));
                        } catch (error) {
                            assertUnchanged();
                            throw error;
                        }
                        assertUnchanged();
                        let thenable = false;
                        try {
                            thenable = result !== null && (typeof result === 'object' || typeof result === 'function')
                                && typeof (result as { then?: unknown }).then === 'function';
                        } catch { return fail('input_invalid'); }
                        assertUnchanged();
                        if (thenable) return fail('input_invalid');
                        return result as never;
                    } finally { leaseCriticalSectionActive = false; }
                },
                dispose() { rejectLeaseCriticalSectionReentry(); finish(true); },
            });

            unregisterOwner = registerServerSessionResource(session.id, () => finish(false));
            if (!unregisterOwner) return fail('session_ineligible');
            owners.set(session.id, owner);
            addOwnerIdentity(registryOwners, owner);
            addOwnerIdentity(authenticOwners, owner);
            setWeakMapValue(commitTurnRunners, owner, commitTurnRunner);
            return owner;
            } finally {
                acquiring.delete(session.id);
            }
        },
    };
    return Object.freeze(registry);
}
