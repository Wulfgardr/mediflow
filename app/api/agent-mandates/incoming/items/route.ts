import { readAuthenticatedWebSession } from '@/lib/security/server-auth';
import { hasAttestedLoopbackIngress } from '@/lib/security/loopback-ingress.mjs';
import { decideAgentVisitItem, AgentApplicationDenied } from '@/lib/agent-visit-application';
import { isTrustedWebMutationRequest } from '@/lib/security/request-transport';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { readNativeNetworkJson } from '@/lib/native-network-json-body';

export const runtime = 'nodejs';

const denied = (status: number) => Response.json({ status: 'not_decided', code: 'INCOMING_ITEM_DENIED' }, { status, headers: { 'Cache-Control': 'no-store' } });

async function requireAdminWebSession(request: Request) {
    if (!hasAttestedLoopbackIngress(request) || request.headers.has('authorization') || !isTrustedWebMutationRequest(request)) return denied(403);
    const session = await readAuthenticatedWebSession();
    if (!session || session.role !== 'admin' || session.authChannel !== 'web') return denied(403);
    return archiveWriteRequestDenial(request, session) ?? session;
}

export async function POST(request: Request): Promise<Response> {
    try {
        const session = await requireAdminWebSession(request);
        if (session instanceof Response) return session;
        const body = await readNativeNetworkJson(request, 34 * 1024 * 1024, { signal: request.signal, deadline: performance.now() + 15000 });
        const current = await readAuthenticatedWebSession();
        if (current?.id !== session.id || current.userId !== session.userId) return denied(403);
        return Response.json(decideAgentVisitItem(request, current, body), { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) { return denied(error instanceof AgentApplicationDenied ? error.status : 409); }
}
