import { readAuthenticatedWebSession } from '@/lib/security/server-auth';
import { hasAttestedLoopbackIngress } from '@/lib/security/loopback-ingress.mjs';
import { readAgentCassettes } from '@/lib/agent-cassette-store';
import { openDbServer } from '@/lib/db-server';

export const runtime = 'nodejs';
export async function GET(request: Request): Promise<Response> {
    if (!hasAttestedLoopbackIngress(request) || request.headers.has('authorization')) return Response.json({ code: 'INCOMING_DENIED' }, { status: 404 });
    const session = await readAuthenticatedWebSession();
    if (!session || session.role !== 'admin' || session.authChannel !== 'web') return Response.json({ code: 'INCOMING_DENIED' }, { status: 403 });
    return Response.json(readAgentCassettes(openDbServer()), { headers: { 'Cache-Control': 'no-store' } });
}
