/* @Codex */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { deleteSession, SESSION_COOKIE_NAME } from '@/lib/server-session';

export async function POST() {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    deleteSession(sessionId);

    const response = NextResponse.json({ success: true });
    response.cookies.set(SESSION_COOKIE_NAME, '', {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        path: '/',
        maxAge: 0
    });
    return response;
}
