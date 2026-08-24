/* @Codex */
import 'server-only';

import crypto from 'crypto';

export const SESSION_COOKIE_NAME = 'mediflow_session';
const SESSION_TTL_MS = Number(process.env.MEDIFLOW_SESSION_TTL_MS || 1000 * 60 * 60 * 8);
const MapConstructor = Map;
const SetConstructor = Set;
const DateNow = Date.now;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const applyIntrinsic = Reflect.apply;
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

declare global {
    // eslint-disable-next-line no-var
    var __mediflowSessions: Map<string, ServerSession> | undefined;
    // eslint-disable-next-line no-var
    var __mediflowSessionResources: Map<string, Set<ServerSessionResourceRegistration>> | undefined;
}

export type ServerSessionDisposalReason = 'session_deleted' | 'session_expired' | 'sessions_cleared';
export type ServerSessionResourceDisposer = (reason: ServerSessionDisposalReason) => void;

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

const sessions = globalThis.__mediflowSessions ?? new MapConstructor<string, ServerSession>();
globalThis.__mediflowSessions = sessions;
const sessionResources = globalThis.__mediflowSessionResources
    ?? new MapConstructor<string, Set<ServerSessionResourceRegistration>>();
globalThis.__mediflowSessionResources = sessionResources;

function disposeSessionResources(sessionId: string, reason: ServerSessionDisposalReason): void {
    const registrations = getMapValue(sessionResources, sessionId);
    deleteMapValue(sessionResources, sessionId);
    if (!registrations) return;

    const iterator = applyIntrinsic(setValues, registrations, []);
    for (let next = nextSetIterator<ServerSessionResourceRegistration>(iterator); !next.done;
        next = nextSetIterator<ServerSessionResourceRegistration>(iterator)) {
        const registration = next.value;
        if (!registration.active) continue;
        registration.active = false;
        try {
            registration.dispose(reason);
        } catch {
            // Session authority is already removed; cleanup failures stay opaque.
        }
    }
}

function terminateSession(sessionId: string, reason: ServerSessionDisposalReason): void {
    deleteMapValue(sessions, sessionId);
    disposeSessionResources(sessionId, reason);
}

export function registerServerSessionResource(
    sessionId: string,
    dispose: ServerSessionResourceDisposer,
): (() => void) | null {
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

/* @Codex */
export function invalidateSessionsForUser(userId: string): void {
    if (!userId) return;

    const sessionIds: string[] = [];
    const iterator = mapValuesOf(sessions);
    for (let next = nextMapIterator<ServerSession>(iterator); !next.done; next = nextMapIterator<ServerSession>(iterator)) {
        if (next.value.userId === userId) sessionIds.push(next.value.id);
    }

    for (let index = 0; index < sessionIds.length; index += 1) {
        deleteSession(sessionIds[index]);
    }
}

/* @Codex */
export function clearAllSessions(): void {
    const sessionIds: string[] = [];
    const sessionIterator = mapKeysOf(sessions);
    for (let next = nextMapIterator<string>(sessionIterator); !next.done; next = nextMapIterator<string>(sessionIterator)) {
        sessionIds.push(next.value);
    }
    const resourceIterator = mapKeysOf(sessionResources);
    for (let next = nextMapIterator<string>(resourceIterator); !next.done; next = nextMapIterator<string>(resourceIterator)) {
        const sessionId = next.value;
        let known = false;
        for (let index = 0; index < sessionIds.length; index += 1) {
            if (sessionIds[index] === sessionId) { known = true; break; }
        }
        if (!known) sessionIds.push(sessionId);
    }
    clearMap(sessions);
    for (let index = 0; index < sessionIds.length; index += 1) {
        disposeSessionResources(sessionIds[index], 'sessions_cleared');
    }
}
