import { NextResponse } from 'next/server';
import { isTrustedWebMutationRequest } from '@/lib/security/request-transport';
import { hasAttestedLoopbackIngress } from '@/lib/security/loopback-ingress.mjs';
import { requireSession } from '@/lib/security/server-auth';
import { isCurrentServerSession } from '@/lib/security/current-session-authority';
import { presentedWebSessionProof, webSessionProofBindings } from '@/lib/security/web-session-proof';
import {
    resolveWebAuthControlSession, setWebAuthControlLocator, setWebAuthSessionLocator, webAuthControlIdFromRequest,
} from '@/lib/security/web-auth-control-transport';
import { readNativeNetworkJson } from '@/lib/native-network-json-body';

const reply = (status: number) => new NextResponse(null, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request) {
    const proof = presentedWebSessionProof(request.headers);
    if (proof?.kind !== 'web' || !hasAttestedLoopbackIngress(request) || !isTrustedWebMutationRequest(request)) return reply(403);
    const input = await readNativeNetworkJson(request, 128, { signal: request.signal, deadline: performance.now() + 2000 }).catch(() => null);
    if (typeof input !== 'object' || !input || Object.keys(input).length !== 1) return reply(400);
    if ('offer' in input) {
        const session = await requireSession();
        const controlId = webAuthControlIdFromRequest(request);
        if (!session || !controlId || !isCurrentServerSession(session)) return reply(401);
        return reply(webSessionProofBindings.offerTab(controlId, session.id, proof, input.offer) ? 204 : 409);
    }
    if (!('accept' in input) || input.accept !== true) return reply(400);
    const grant = webSessionProofBindings.acceptTab(proof);
    if (!grant || resolveWebAuthControlSession(grant.sessionId, grant.controlId, request)?.status !== 'active') return reply(401);
    const response = reply(204);
    setWebAuthControlLocator(response, request, grant.controlId);
    setWebAuthSessionLocator(response, request, grant.sessionId);
    return response;
}
