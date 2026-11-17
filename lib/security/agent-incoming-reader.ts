import 'server-only';
import type { ServerSession } from './server-session';
import type { AgentCassetteIndexPage, IncomingAgentCassette } from '../agent-cassette-contract';
import { isAgentId } from '../agent-cassette-crypto';
import { hasAttestedLoopbackIngress } from './loopback-ingress.mjs';

type Sources = {
    session(): Promise<ServerSession | null>;
    index(actorRef: string, after: string | null): AgentCassetteIndexPage;
    cassette(actorRef: string, id: string): IncomingAgentCassette | undefined;
};
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
        const search = new URL(request.url).searchParams;
        const id = search.get('visit'), after = search.get('after');
        if ((id !== null && !isAgentId(id)) || (after !== null && (!isAgentId(after) || id !== null))) return denied(400);
        const headers = { 'Cache-Control': 'no-store' };
        if (id !== null) {
            const cassette = sources.cassette(session.userId, id);
            return cassette?.actorRef === session.userId ? Response.json(cassette, { headers }) : denied(404);
        }
        return Response.json(sources.index(session.userId, after), { headers });
    };
}
