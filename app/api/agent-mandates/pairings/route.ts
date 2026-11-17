import { readAuthenticatedWebSession } from '@/lib/security/server-auth';
import { hasAttestedLoopbackIngress } from '@/lib/security/loopback-ingress.mjs';
import { isTrustedWebMutationRequest } from '@/lib/security/request-transport';
import { archiveGenerationForSession } from '@/lib/security/archive-session-generation';
import { createAgentPairingStore } from '@/lib/agent-pairing-store';
import { AgentMandateDenied } from '@/lib/agent-mandate-store';
import { openDbServer } from '@/lib/db-server';
import { readNativeNetworkJson } from '@/lib/native-network-json-body';

export const runtime = 'nodejs';
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
async function session(request: Request, mutation: boolean) {
    if (!hasAttestedLoopbackIngress(request) || request.headers.has('authorization') || mutation && !isTrustedWebMutationRequest(request)) return null;
    const current = await readAuthenticatedWebSession();
    if (!current || current.role !== 'admin' || current.authChannel !== 'web') return null;
    if (mutation && request.headers.get('x-mediflow-archive-generation') !== archiveGenerationForSession(current)) return null;
    return current;
}
export async function GET(request: Request): Promise<Response> {
    try {
        if (!await session(request, false)) return reply({ code: 'PAIRING_APPROVAL_DENIED' }, 403);
        return reply(createAgentPairingStore(openDbServer()).pending());
    } catch { return reply({ code: 'PAIRING_APPROVAL_UNAVAILABLE' }, 503); }
}
export async function POST(request: Request): Promise<Response> {
    try {
        const current = await session(request, true);
        if (!current) return reply({ code: 'PAIRING_APPROVAL_DENIED' }, 403);
        const body = await readNativeNetworkJson(request, 1024, { signal: request.signal, deadline: performance.now() + 2000 }) as Record<string, unknown>;
        if (!body || Object.keys(body).sort().join(',') !== 'code,mandateRef,requestId'
            || ![body.code, body.mandateRef, body.requestId].every(value => typeof value === 'string')) return reply({ code: 'INVALID_INPUT' }, 400);
        const fresh = await session(request, true);
        if (fresh?.id !== current.id || fresh.userId !== current.userId) return reply({ code: 'PAIRING_APPROVAL_DENIED' }, 403);
        return reply(createAgentPairingStore(openDbServer()).approve(body.requestId as string, body.code as string, body.mandateRef as string,
            current.userId, archiveGenerationForSession(current)!));
    } catch (error) { return reply({ code: 'PAIRING_APPROVAL_DENIED' }, error instanceof AgentMandateDenied ? 403 : 503); }
}
