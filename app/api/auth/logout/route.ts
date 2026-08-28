import { cookies } from 'next/headers';

import { completeExactWebP3Logout } from '@/lib/security/web-auth-logout-server';
import { SESSION_COOKIE_NAME } from '@/lib/security/server-session';

export async function POST(request: Request) {
    let cookie: unknown = null;
    try {
        const cookieStore = await cookies();
        cookie = cookieStore.get(SESSION_COOKIE_NAME);
    } catch { /* The terminal service receives only the inert denial input. */ }
    return completeExactWebP3Logout(cookie, request);
}
