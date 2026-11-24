import { webAuthControlIdFromRequest, webAuthSessionIdFromRequest } from '@/lib/security/web-auth-control-transport';

import { completeExactWebP3Logout } from '@/lib/security/web-auth-logout-server';
import { completePortableSupervisorWebLifecycleMutationV1 } from '@/lib/security/portable-supervisor-web-lifecycle';

const SESSION_COOKIE_NAME = 'mediflow_session';
const CONTROL_COOKIE_NAME = 'mediflow_auth_control';

export async function POST(request: Request) {
    const bearerCookie = { name: SESSION_COOKIE_NAME, value: webAuthSessionIdFromRequest(request) };
    const controlCookie = { name: CONTROL_COOKIE_NAME, value: webAuthControlIdFromRequest(request) };
    return completePortableSupervisorWebLifecycleMutationV1(
        completeExactWebP3Logout(bearerCookie, controlCookie, request),
        'logout',
    );
}
