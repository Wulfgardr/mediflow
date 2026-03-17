/* @Codex */
import 'server-only';

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSession, SESSION_COOKIE_NAME, type ServerSession } from '@/lib/server-session';
/* @Codex */
import { requireLocalApiToken } from '@/lib/local-api-auth';
/* @Codex */
import { dbServer } from '@/lib/db-server';
/* @Codex */
import { users } from '@/lib/schema';

export async function requireSession(): Promise<ServerSession | null> {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    return getSession(sessionId);
}

/* @Codex */
async function resolveLocalApiActorSession(): Promise<ServerSession> {
    const now = Date.now();
    const user = await dbServer
        .select({
            id: users.id,
            username: users.username,
            role: users.role,
        })
        .from(users)
        .limit(1)
        .get();

    if (user) {
        return {
            id: `native:${user.id}`,
            userId: user.id,
            username: user.username,
            role: user.role || 'user',
            authChannel: 'native',
            createdAt: now,
            expiresAt: now + 1000 * 60 * 60,
        };
    }

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

    return resolveLocalApiActorSession();
}

/* @Codex */
export async function requireLocalApiActorSession(request: Request): Promise<ServerSession | null> {
    const tokenError = requireLocalApiToken(request);
    if (tokenError) return null;
    return resolveLocalApiActorSession();
}

export function unauthorizedResponse() {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export function forbiddenResponse() {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
