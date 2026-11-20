import { completeExactWebP3ApplicationLock } from '@/lib/security/web-auth-application-lock-server';
import { resolveWebAuthControlSession, webAuthControlMutationFromRequest, webAuthSessionIdFromRequest } from '@/lib/security/web-auth-control-transport';
import { SESSION_COOKIE_NAME } from '@/lib/security/server-session';
import { completePortableSupervisorWebLifecycleMutationV1 } from '@/lib/security/portable-supervisor-web-lifecycle';

export async function POST(request: Request) {
    const sessionId = webAuthSessionIdFromRequest(request);
    const cookie = { name: SESSION_COOKIE_NAME, value: sessionId };
    const mutation = webAuthControlMutationFromRequest(request);
    const active = sessionId && mutation && resolveWebAuthControlSession(sessionId, mutation.controlId, request)?.status === 'active';
    const result = completeExactWebP3ApplicationLock(cookie, mutation, request);
    return active ? completePortableSupervisorWebLifecycleMutationV1(result, 'application_lock') : result;
}
