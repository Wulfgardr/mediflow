/* @Codex */
import 'server-only';

import crypto from 'crypto';

export const SESSION_COOKIE_NAME = 'mediflow_session';
const SESSION_TTL_MS = Number(process.env.MEDIFLOW_SESSION_TTL_MS || 1000 * 60 * 60 * 8);

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

const sessions = globalThis.__mediflowSessions ?? new Map<string, ServerSession>();
globalThis.__mediflowSessions = sessions;
const sessionResources = globalThis.__mediflowSessionResources
    ?? new Map<string, Set<ServerSessionResourceRegistration>>();
globalThis.__mediflowSessionResources = sessionResources;

function disposeSessionResources(sessionId: string, reason: ServerSessionDisposalReason): void {
    const registrations = sessionResources.get(sessionId);
    sessionResources.delete(sessionId);
    if (!registrations) return;

    for (const registration of registrations) {
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
    sessions.delete(sessionId);
    disposeSessionResources(sessionId, reason);
}

export function registerServerSessionResource(
    sessionId: string,
    dispose: ServerSessionResourceDisposer,
): (() => void) | null {
    const session = sessions.get(sessionId);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
        terminateSession(sessionId, 'session_expired');
        return null;
    }

    const registration: ServerSessionResourceRegistration = { active: true, dispose };
    const registrations = sessionResources.get(sessionId) ?? new Set<ServerSessionResourceRegistration>();
    registrations.add(registration);
    sessionResources.set(sessionId, registrations);

    return () => {
        const activeRegistrations = sessionResources.get(sessionId);
        if (!activeRegistrations?.delete(registration)) return;
        registration.active = false;
        if (activeRegistrations?.size === 0) sessionResources.delete(sessionId);
    };
}

export function createSession(
    user: { id: string; username: string; role: string },
    authChannel: ServerSession['authChannel'] = 'web'
): ServerSession {
    const now = Date.now();
    const session: ServerSession = {
        id: crypto.randomBytes(32).toString('hex'),
        userId: user.id,
        username: user.username,
        role: user.role,
        authChannel,
        createdAt: now,
        expiresAt: now + SESSION_TTL_MS
    };
    sessions.set(session.id, session);
    return session;
}

export function getSession(sessionId: string | null | undefined): ServerSession | null {
    if (!sessionId) return null;
    const session = sessions.get(sessionId);
    if (!session) return null;

    const now = Date.now();
    if (session.expiresAt <= now) {
        terminateSession(sessionId, 'session_expired');
        return null;
    }

    // Sliding expiration on access
    session.expiresAt = now + SESSION_TTL_MS;
    sessions.set(sessionId, session);
    return session;
}

/* @Codex */
export function peekSession(sessionId: string | null | undefined): ServerSession | null {
    if (!sessionId) return null;
    const session = sessions.get(sessionId);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
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

    const sessionIds = [...sessions.values()]
        .filter((session) => session.userId === userId)
        .map((session) => session.id);

    for (const sessionId of sessionIds) {
        deleteSession(sessionId);
    }
}

/* @Codex */
export function clearAllSessions(): void {
    const sessionIds = new Set([...sessions.keys(), ...sessionResources.keys()]);
    sessions.clear();
    for (const sessionId of sessionIds) {
        disposeSessionResources(sessionId, 'sessions_cleared');
    }
}
