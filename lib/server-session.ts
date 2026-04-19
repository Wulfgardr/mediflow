/* @Codex */
import 'server-only';

import crypto from 'crypto';

export const SESSION_COOKIE_NAME = 'mediflow_session';
const SESSION_TTL_MS = Number(process.env.MEDIFLOW_SESSION_TTL_MS || 1000 * 60 * 60 * 8);

declare global {
    // eslint-disable-next-line no-var
    var __mediflowSessions: Map<string, ServerSession> | undefined;
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
        sessions.delete(sessionId);
        return null;
    }

    // Sliding expiration on access
    session.expiresAt = now + SESSION_TTL_MS;
    sessions.set(sessionId, session);
    return session;
}

export function deleteSession(sessionId: string | null | undefined): void {
    if (!sessionId) return;
    sessions.delete(sessionId);
}

/* @Codex */
export function clearAllSessions(): void {
    sessions.clear();
}
