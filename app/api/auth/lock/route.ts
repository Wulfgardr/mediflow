/* @Codex */
import { cookies } from 'next/headers';

import { completeExactWebP3ApplicationLock } from '@/lib/security/web-auth-application-lock-server';
import { webAuthControlMutationFromRequest } from '@/lib/security/web-auth-control-transport';
import { SESSION_COOKIE_NAME } from '@/lib/security/server-session';
import { completePortableSupervisorWebLifecycleMutationV1 } from '@/lib/security/portable-supervisor-web-lifecycle';

export async function POST(request: Request) {
    let cookie: unknown = null;
    try {
        const cookieStore = await cookies();
        cookie = cookieStore.get(SESSION_COOKIE_NAME);
    } catch { /* The terminal service receives only the inert denial input. */ }
    const mutation = webAuthControlMutationFromRequest(request);
    return completePortableSupervisorWebLifecycleMutationV1(
        completeExactWebP3ApplicationLock(cookie, mutation, request),
        'application_lock',
    );
}
