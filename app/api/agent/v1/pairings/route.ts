import { openDbServer } from '@/lib/db-server';
import { AgentMandateDenied } from '@/lib/agent-mandate-store';
import { AgentPairingQueueFull, createAgentPairingStore } from '@/lib/agent-pairing-store';
import { agentChannelFailure, requireAgentLoopbackContext, requireNonBrowserAgentRequest } from '@/lib/security/agent-channel';
import { readNativeNetworkJson } from '@/lib/native-network-json-body';

export const runtime = 'nodejs';
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(request: Request): Promise<Response> {
    try {
        requireAgentLoopbackContext(request);
        requireNonBrowserAgentRequest(request, true);
        const body = await readNativeNetworkJson(request, 2048, { signal: request.signal, deadline: performance.now() + 2000 }) as Record<string, unknown>;
        if (!body || Object.keys(body).sort().join(',') !== 'name,operations') return reply({ code: 'INVALID_INPUT' }, 400);
        const result = createAgentPairingStore(openDbServer()).request(body.name, body.operations);
        return reply({ receipt: result.request, pairingCredential: { claim: result.claim } }, 201);
    } catch (error) {
        if (error instanceof AgentPairingQueueFull) return reply({ code: 'PAIRING_QUEUE_FULL' }, 429);
        return error instanceof AgentMandateDenied ? reply({ code: 'INVALID_INPUT' }, 400) : agentChannelFailure(error);
    }
}
export async function GET(request: Request): Promise<Response> {
    try {
        requireAgentLoopbackContext(request);
        requireNonBrowserAgentRequest(request, false);
        const url = new URL(request.url), id = url.searchParams.get('requestId');
        const claim = /^Pairing ([A-Za-z0-9_-]{43})$/u.exec(request.headers.get('authorization') ?? '')?.[1];
        if (!id || !claim || [...url.searchParams.keys()].join(',') !== 'requestId') return reply({ code: 'PAIRING_DENIED' }, 401);
        const result = createAgentPairingStore(openDbServer()).poll(id, claim);
        return reply(result, result.receipt.status === 'pending' ? 202 : 200);
    } catch (error) { return error instanceof AgentMandateDenied ? reply({ code: 'PAIRING_DENIED' }, 401) : agentChannelFailure(error); }
}
