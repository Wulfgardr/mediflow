import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { dbServer } from '@/lib/db-server';
import { users } from '@/lib/schema';
/* @Codex */
import { requireSession, unauthorizedResponse, forbiddenResponse } from '@/lib/server-auth';
/* @Codex */
import { clearAllSessions, SESSION_COOKIE_NAME } from '@/lib/server-session';
/* @Codex */
import { sessionCookieOptionsForRequest } from '@/lib/request-transport';

export async function POST(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (session.role !== 'admin') return forbiddenResponse();

    try {
        // Delete all users. This effectively resets the onboarding state.
        await dbServer.delete(users);
        clearAllSessions();

        const cookieStore = await cookies();
        cookieStore.delete(SESSION_COOKIE_NAME);

        const response = NextResponse.json({ success: true });
        response.cookies.set(SESSION_COOKIE_NAME, '', {
            ...sessionCookieOptionsForRequest(request),
            maxAge: 0,
        });
        return response;
    } catch (error) {
        console.error("Reset error:", error);
        return NextResponse.json({ error: "Reset failed" }, { status: 500 });
    }
}
