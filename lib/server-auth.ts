/* @Codex */
import 'server-only';

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSession, SESSION_COOKIE_NAME, type ServerSession } from '@/lib/server-session';
/* @Codex */
import { requireLocalApiToken } from '@/lib/local-api-auth';

export async function requireSession(): Promise<ServerSession | null> {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    return getSession(sessionId);
}

/* @Codex */
function buildLocalApiSystemSession(): ServerSession {
    const now = Date.now();
    return {
        id: 'local-api',
        userId: 'local-api',
        username: 'local-api',
        role: 'admin',
        authChannel: 'system',
        createdAt: now,
        expiresAt: now + 1000 * 60 * 60,
    };
}

/* @Codex */
export async function requireSessionOrLocalToken(request: Request): Promise<ServerSession | null> {
    const session = await requireSession();
    if (session) return session;

    const tokenError = requireLocalApiToken(request);
    if (tokenError) return null;

    return buildLocalApiSystemSession();
}

/* @Codex */
export async function requireLocalApiActorSession(request: Request): Promise<ServerSession | null> {
    const tokenError = requireLocalApiToken(request);
    if (tokenError) return null;

    const session = await requireSession();
    if (session) {
        return {
            ...session,
            id: `native:${session.userId}`,
            authChannel: 'native',
        };
    }

    return buildLocalApiSystemSession();
}

export function unauthorizedResponse() {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export function forbiddenResponse() {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
