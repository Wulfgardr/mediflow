import { resolveWebAuthControlSession, webAuthControlIdFromRequest } from '@/lib/security/web-auth-control-transport';
import type { WebSessionProjection } from '@/lib/security/web-auth-lifecycle-owner-adapter';
import { POST as login } from '../../login/route';
import { bindLocalClientSession, hasAttestedLoopbackIngress } from '@/lib/security/loopback-ingress.mjs';
import { isTrustedWebMutationRequest } from '@/lib/security/request-transport';

export async function POST(request: Request) {
    if (!hasAttestedLoopbackIngress(request) || !isTrustedWebMutationRequest(request) || new URL(request.url).search) {
        return new Response(null, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }
    const response = await login(request);
    const session = response.cookies.get('mediflow_session')?.value;
    if (response.ok && session) {
        const resolved = resolveWebAuthControlSession(session, webAuthControlIdFromRequest(request));
        if (resolved?.status !== 'active') return new Response(null, { status: 503 });
        bindLocalClientSession(session, (resolved.projection as WebSessionProjection).expiresAt);
    }
    return response;
}
