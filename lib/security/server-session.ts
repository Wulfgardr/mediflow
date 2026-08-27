/* @Codex */
import 'server-only';

import crypto from 'crypto';
import { types } from 'node:util';

export const SESSION_COOKIE_NAME = 'mediflow_session';
const SESSION_TTL_MS = Number(process.env.MEDIFLOW_SESSION_TTL_MS || 1000 * 60 * 60 * 8);
const MapConstructor = Map;
const SetConstructor = Set;
const DateNow = Date.now;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetOwnPropertyNames = Object.getOwnPropertyNames;
const ObjectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const ObjectFreeze = Object.freeze;
const applyIntrinsic = Reflect.apply;
const functionToString = Function.prototype.toString;
const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;
const mapDelete = Map.prototype.delete;
const mapClear = Map.prototype.clear;
const mapKeys = Map.prototype.keys;
const mapValues = Map.prototype.values;
const mapIteratorNext = ObjectGetPrototypeOf(new MapConstructor().keys()).next;
const setAdd = Set.prototype.add;
const setDelete = Set.prototype.delete;
const setValues = Set.prototype.values;
const setIteratorNext = ObjectGetPrototypeOf(new SetConstructor().values()).next;
const setSize = ObjectGetOwnPropertyDescriptor(Set.prototype, 'size')!.get!;
const arrayPush = Array.prototype.push;
const isProxy = types.isProxy;

function getMapValue<K, V>(registry: Map<K, V>, key: K): V | undefined {
    return applyIntrinsic(mapGet, registry, [key]);
}

function setMapValue<K, V>(registry: Map<K, V>, key: K, value: V): void {
    applyIntrinsic(mapSet, registry, [key, value]);
}

function deleteMapValue<K, V>(registry: Map<K, V>, key: K): void {
    applyIntrinsic(mapDelete, registry, [key]);
}

function clearMap<K, V>(registry: Map<K, V>): void {
    applyIntrinsic(mapClear, registry, []);
}

function nextMapIterator<T>(iterator: object): IteratorResult<T> {
    return applyIntrinsic(mapIteratorNext, iterator, []) as IteratorResult<T>;
}

function mapKeysOf<K, V>(registry: Map<K, V>): object {
    return applyIntrinsic(mapKeys, registry, []);
}

function mapValuesOf<K, V>(registry: Map<K, V>): object {
    return applyIntrinsic(mapValues, registry, []);
}

function addSetValue<T>(registry: Set<T>, value: T): void {
    applyIntrinsic(setAdd, registry, [value]);
}

function deleteSetValue<T>(registry: Set<T>, value: T): boolean {
    return applyIntrinsic(setDelete, registry, [value]);
}

function nextSetIterator<T>(iterator: object): IteratorResult<T> {
    return applyIntrinsic(setIteratorNext, iterator, []) as IteratorResult<T>;
}

function setSizeOf<T>(registry: Set<T>): number {
    return applyIntrinsic(setSize, registry, []);
}

function appendArrayValue<T>(target: T[], value: T): void {
    applyIntrinsic(arrayPush, target, [value]);
}

export type ServerSessionDisposalReason = 'session_deleted' | 'session_expired' | 'sessions_cleared' | 'application_locked';
export type ServerSessionResourceDisposer = (reason: ServerSessionDisposalReason) => void;
export type ServerSessionCleanupOutcome = 'completed' | 'failed' | 'unknown';

interface ServerSessionResourceRegistration {
    active: boolean;
    dispose: ServerSessionResourceDisposer;
}

export interface ServerSession {
    id: string;
    userId: string;
    username: string;
    role: string;
    authChannel: 'web' | 'native' | 'system';
    createdAt: number;
    expiresAt: number;
}

export type NativeServerSessionBinding = Readonly<{
    clientId: string;
    clientPlatform: 'macos' | 'ios' | 'ipados';
}>;

const sessions = new MapConstructor<string, ServerSession>();
const nativeSessionBindings = new WeakMap<ServerSession, NativeServerSessionBinding>();
const sessionResources = new MapConstructor<string, Set<ServerSessionResourceRegistration>>();
const sessionCleanupOutcomes = new MapConstructor<string, Exclude<ServerSessionCleanupOutcome, 'unknown'>>();

function isSupportedSynchronousDisposer(candidate: unknown): candidate is ServerSessionResourceDisposer {
    if (typeof candidate !== 'function' || isProxy(candidate)) return false;
    try {
        const source = applyIntrinsic(functionToString, candidate, []) as string;
        return !/^\s*async(?:\s|\()/u.test(source) && !source.includes('[native code]');
    } catch {
        return false;
    }
}

function recordCleanupOutcome(sessionId: string, failed: boolean): ServerSessionCleanupOutcome {
    const prior = getMapValue(sessionCleanupOutcomes, sessionId);
    const outcome = prior === 'failed' || failed ? 'failed' : 'completed';
    setMapValue(sessionCleanupOutcomes, sessionId, outcome);
    return outcome;
}

function disposeSessionResources(sessionId: string, reason: ServerSessionDisposalReason): boolean {
    const registrations = getMapValue(sessionResources, sessionId);
    deleteMapValue(sessionResources, sessionId);
    if (!registrations) return false;

    let disposalFailed = false;

    const iterator = applyIntrinsic(setValues, registrations, []);
    for (let next = nextSetIterator<ServerSessionResourceRegistration>(iterator); !next.done;
        next = nextSetIterator<ServerSessionResourceRegistration>(iterator)) {
        const registration = next.value;
        if (!registration.active) continue;
        registration.active = false;
        try {
            const outcome = registration.dispose(reason);
            if (outcome !== undefined) disposalFailed = true;
        } catch {
            // Session authority is already removed; cleanup failures stay opaque.
            disposalFailed = true;
        }
    }
    return disposalFailed;
}

function completeSessionTermination(
    sessionId: string,
    sessionBeforeDeletion: ServerSession | null,
    reason: ServerSessionDisposalReason,
): Readonly<{
    sessionBeforeDeletion: ServerSession | null;
    cleanupOutcome: ServerSessionCleanupOutcome;
    authorityAbsent: boolean;
}> {
    const registrations = getMapValue(sessionResources, sessionId);
    const disposalFailed = disposeSessionResources(sessionId, reason);
    const cleanupOutcome = sessionBeforeDeletion || registrations
        ? recordCleanupOutcome(sessionId, disposalFailed)
        : getMapValue(sessionCleanupOutcomes, sessionId) ?? 'unknown';
    return { sessionBeforeDeletion, cleanupOutcome, authorityAbsent: getMapValue(sessions, sessionId) === undefined };
}

function terminateSession(sessionId: string, reason: ServerSessionDisposalReason) {
    const sessionBeforeDeletion = getMapValue(sessions, sessionId) ?? null;
    deleteMapValue(sessions, sessionId);
    return completeSessionTermination(sessionId, sessionBeforeDeletion, reason);
}

export function registerServerSessionResource(
    sessionId: string,
    dispose: ServerSessionResourceDisposer,
): (() => void) | null {
    if (!isSupportedSynchronousDisposer(dispose)) return null;
    const session = getMapValue(sessions, sessionId);
    if (!session) return null;
    if (session.expiresAt <= DateNow()) {
        terminateSession(sessionId, 'session_expired');
        return null;
    }

    const registration: ServerSessionResourceRegistration = { active: true, dispose };
    const registrations = getMapValue(sessionResources, sessionId) ?? new SetConstructor<ServerSessionResourceRegistration>();
    addSetValue(registrations, registration);
    setMapValue(sessionResources, sessionId, registrations);

    return () => {
        const activeRegistrations = getMapValue(sessionResources, sessionId);
        if (!activeRegistrations || !deleteSetValue(activeRegistrations, registration)) return;
        registration.active = false;
        if (setSizeOf(activeRegistrations) === 0) deleteMapValue(sessionResources, sessionId);
    };
}

export function createSession(
    user: { id: string; username: string; role: string },
    authChannel: ServerSession['authChannel'] = 'web'
): ServerSession {
    const now = DateNow();
    const session: ServerSession = {
        id: crypto.randomBytes(32).toString('hex'),
        userId: user.id,
        username: user.username,
        role: user.role,
        authChannel,
        createdAt: now,
        expiresAt: now + SESSION_TTL_MS
    };
    setMapValue(sessions, session.id, session);
    return session;
}

/* @Codex: native authority is server-tagged and bound to the admitted paired client. */
export function createNativeServerSession(
    user: { id: string; username: string; role: string }, binding: NativeServerSessionBinding,
): ServerSession {
    if (!isNativeBinding(binding)) throw new Error('invalid native session binding');
    const session = createSession(user, 'native');
    nativeSessionBindings.set(session, ObjectFreeze({ clientId: binding.clientId, clientPlatform: binding.clientPlatform }));
    return session;
}

/** Compatibility accepts only the exact process-local native session and its admitted pair. */
/* @Codex */
export function isPairedNativeServerSession(
    session: unknown, binding: unknown,
): session is ServerSession {
    if (!isNativeBinding(binding) || !isExactStoredSession(session)) return false;
    const tagged = nativeSessionBindings.get(session);
    return Boolean(tagged && tagged.clientId === binding.clientId && tagged.clientPlatform === binding.clientPlatform);
}

function isNativeBinding(value: unknown): value is NativeServerSessionBinding {
    try {
        if (!value || typeof value !== 'object' || isProxy(value) || ObjectGetPrototypeOf(value) !== Object.prototype) return false;
        if (ObjectGetOwnPropertySymbols(value).length || ObjectGetOwnPropertyNames(value).length !== 2) return false;
        const clientId = ObjectGetOwnPropertyDescriptor(value, 'clientId'); const clientPlatform = ObjectGetOwnPropertyDescriptor(value, 'clientPlatform');
        return Boolean(clientId && clientPlatform && 'value' in clientId && 'value' in clientPlatform && clientId.enumerable && clientPlatform.enumerable
            && typeof clientId.value === 'string' && (clientPlatform.value === 'macos' || clientPlatform.value === 'ios' || clientPlatform.value === 'ipados'));
    } catch { return false; }
}

function isExactStoredSession(value: unknown): value is ServerSession {
    try {
        if (!value || typeof value !== 'object' || isProxy(value) || ObjectGetPrototypeOf(value) !== Object.prototype) return false;
        const id = ObjectGetOwnPropertyDescriptor(value, 'id');
        return Boolean(id && 'value' in id && typeof id.value === 'string' && getMapValue(sessions, id.value) === value);
    } catch { return false; }
}

export function getSession(sessionId: string | null | undefined): ServerSession | null {
    if (!sessionId) return null;
    const session = getMapValue(sessions, sessionId);
    if (!session) return null;

    const now = DateNow();
    if (session.expiresAt <= now) {
        terminateSession(sessionId, 'session_expired');
        return null;
    }

    // Sliding expiration on access
    session.expiresAt = now + SESSION_TTL_MS;
    setMapValue(sessions, sessionId, session);
    return session;
}

/* @Codex */
export function peekSession(sessionId: string | null | undefined): ServerSession | null {
    if (!sessionId) return null;
    const session = getMapValue(sessions, sessionId);
    if (!session) return null;
    if (session.expiresAt <= DateNow()) {
        terminateSession(sessionId, 'session_expired');
        return null;
    }
    return session;
}

export function deleteSession(sessionId: string | null | undefined): void {
    if (!sessionId) return;
    terminateSession(sessionId, 'session_deleted');
}

/* @Codex: WUL-522 application lock keeps deletion and cleanup in one server-only primitive. */
export function invalidateServerSessionForApplicationLock(sessionId: string): Readonly<{
    sessionBeforeDeletion: ServerSession | null;
    cleanupOutcome: ServerSessionCleanupOutcome;
    authorityAbsent: boolean;
}> {
    return terminateSession(sessionId, 'application_locked');
}

/* @Codex */
export function invalidateSessionsForUser(userId: string): void {
    if (!userId) return;

    const sessionIds: string[] = [];
    const iterator = mapValuesOf(sessions);
    for (let next = nextMapIterator<ServerSession>(iterator); !next.done; next = nextMapIterator<ServerSession>(iterator)) {
        if (next.value.userId === userId) appendArrayValue(sessionIds, next.value.id);
    }

    for (let index = 0; index < sessionIds.length; index += 1) {
        deleteSession(sessionIds[index]);
    }
}

/* @Codex */
export function clearAllSessions(): void {
    const sessionIds: string[] = [];
    const sessionSnapshots = new MapConstructor<string, ServerSession>();
    const sessionIterator = mapKeysOf(sessions);
    for (let next = nextMapIterator<string>(sessionIterator); !next.done; next = nextMapIterator<string>(sessionIterator)) {
        appendArrayValue(sessionIds, next.value);
        const session = getMapValue(sessions, next.value);
        if (session) setMapValue(sessionSnapshots, next.value, session);
    }
    const resourceIterator = mapKeysOf(sessionResources);
    for (let next = nextMapIterator<string>(resourceIterator); !next.done; next = nextMapIterator<string>(resourceIterator)) {
        const sessionId = next.value;
        let known = false;
        for (let index = 0; index < sessionIds.length; index += 1) {
            if (sessionIds[index] === sessionId) { known = true; break; }
        }
        if (!known) appendArrayValue(sessionIds, sessionId);
    }
    clearMap(sessions);
    for (let index = 0; index < sessionIds.length; index += 1) {
        completeSessionTermination(sessionIds[index], getMapValue(sessionSnapshots, sessionIds[index]) ?? null, 'sessions_cleared');
    }
}
