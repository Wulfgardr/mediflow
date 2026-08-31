import { cookies } from 'next/headers';

import { completeExactWebP3Logout } from '@/lib/security/web-auth-logout-server';

const SESSION_COOKIE_NAME = 'mediflow_session';
const CONTROL_COOKIE_NAME = 'mediflow_auth_control';

/* @Codex */
export async function POST(request: Request) {
    let bearerCookie: unknown = null;
    let controlCookie: unknown = null;
    try {
        const cookieStore = await cookies();
        bearerCookie = cookieStore.get(SESSION_COOKIE_NAME);
        controlCookie = cookieStore.get(CONTROL_COOKIE_NAME);
    } catch { /* The terminal service receives only the inert denial input. */ }
    return completeExactWebP3Logout(bearerCookie, controlCookie, request);
}
