import { readAuthenticatedWebSession } from '@/lib/security/server-auth';
import { createAgentIncomingReader } from '@/lib/security/agent-incoming-reader';
import { hasAttestedLoopbackIngress } from '@/lib/security/loopback-ingress.mjs';
import { readAgentCassettes } from '@/lib/agent-cassette-store';
import { applyAgentVisit, agentAppliedItemIds, AgentApplicationDenied } from '@/lib/agent-visit-application';
import { isTrustedWebMutationRequest } from '@/lib/security/request-transport';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { readNativeNetworkJson } from '@/lib/native-network-json-body';
import { openDbServer } from '@/lib/db-server';

export const runtime = 'nodejs';
export const GET = createAgentIncomingReader({ session: readAuthenticatedWebSession,
    cassettes: () => readAgentCassettes(openDbServer()).map(row => ({ ...row, appliedItemIds: agentAppliedItemIds(row.id) })) });

export async function POST(request: Request): Promise<Response> {
    const denied = (status: number) => Response.json({ status: 'not_applied', code: 'INCOMING_DENIED' }, { status, headers: { 'Cache-Control': 'no-store' } });
    if (!hasAttestedLoopbackIngress(request) || request.headers.has('authorization') || !isTrustedWebMutationRequest(request)) return denied(403);
    try {
        const session = await readAuthenticatedWebSession();
        if (!session || session.role !== 'admin' || session.authChannel !== 'web') return denied(403);
        const refusal = archiveWriteRequestDenial(request, session);
        if (refusal) return refusal;
        const body = await readNativeNetworkJson(request, 34 * 1024 * 1024, { signal: request.signal, deadline: performance.now() + 15000 });
        const current = await readAuthenticatedWebSession();
        if (current?.id !== session.id || current.userId !== session.userId) return denied(403);
        return Response.json(applyAgentVisit(request, current, body), { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) { return denied(error instanceof AgentApplicationDenied ? error.status : 409); }
}
