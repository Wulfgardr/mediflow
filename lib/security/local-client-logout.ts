import { hasAttestedLoopbackIngress } from './loopback-ingress.mjs';
import { isTrustedWebMutationRequest } from './request-transport';
import { webAuthControlIdFromRequest, webAuthSessionIdFromRequest } from './web-auth-control-transport';
import { completeExactWebP3Logout } from './web-auth-logout-server';

function localRequest(request: Request): boolean {
    try {
        const url = new URL(request.url);
        return request.method === 'POST' && !url.search
            && hasAttestedLoopbackIngress(request) && isTrustedWebMutationRequest(request);
    } catch { return false; }
}

export function createLocalClientLogout(complete: typeof completeExactWebP3Logout = completeExactWebP3Logout) {
    return async (request: Request): Promise<Response> => {
        const reply = (status: number) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
        if (!localRequest(request)) return reply(403);
        const session = webAuthSessionIdFromRequest(request);
        const control = webAuthControlIdFromRequest(request);
        if (!session || !control) return reply(401);
        return complete({ name: 'mediflow_session', value: session }, { name: 'mediflow_auth_control', value: control }, request);
    };
}
