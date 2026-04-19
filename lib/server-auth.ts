/* @Codex */
import 'server-only';

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { users } from '@/lib/schema';
import { deleteSession, getSession, SESSION_COOKIE_NAME, type ServerSession } from '@/lib/server-session';
/* @Codex */
import { requireLocalApiToken } from '@/lib/local-api-auth';

export async function requireSession(): Promise<ServerSession | null> {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const session = getSession(sessionId);
    if (!session || !sessionId) return null;

    try {
        const user = await dbServer
            .select({
                id: users.id,
                username: users.username,
                role: users.role,
            })
            .from(users)
            .where(eq(users.id, session.userId))
            .get();

        if (!user) {
            deleteSession(sessionId);
            return null;
        }

        session.username = user.username;
        session.role = user.role ?? session.role;
    } catch (error) {
        console.error('[MediFlow] Session validation against users table failed:', error);
    }

    return session;
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
