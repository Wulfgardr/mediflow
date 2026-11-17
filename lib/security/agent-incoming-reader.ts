import 'server-only';
import type { ServerSession } from './server-session';
import type { AgentCassette } from '../agent-cassette-contract';
import { hasAttestedLoopbackIngress } from './loopback-ingress.mjs';

type Sources = { session(): Promise<ServerSession | null>; cassettes(): AgentCassette[] };
export function createAgentIncomingReader(sources: Sources) {
    async function requireIncomingSession() {
        const session = await sources.session();
        return session?.role === 'admin' && session.authChannel === 'web' ? session : null;
    }
    return async function GET(request: Request): Promise<Response> {
        const denied = (status: number) => Response.json({ code: 'INCOMING_DENIED' }, { status, headers: { 'Cache-Control': 'no-store' } });
        if (!hasAttestedLoopbackIngress(request) || request.headers.has('authorization')) return denied(404);
        const session = await requireIncomingSession();
        if (!session) return denied(403);
        return Response.json(sources.cassettes().filter(row => row.actorRef === session.userId), { headers: { 'Cache-Control': 'no-store' } });
    };
}
