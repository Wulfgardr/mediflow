import { openDbServer } from '@/lib/db-server';
import { AgentCassetteDenied, createAgentCassetteStore } from '@/lib/agent-cassette-store';
import { AGENT_ITEM_OPERATION, type AgentCassetteItem } from '@/lib/agent-cassette-contract';
import { agentChannelFailure, requireAgentLoopbackContext, withAuthenticatedAgentTransaction } from '@/lib/security/agent-channel';
import { readNativeNetworkJson } from '@/lib/native-network-json-body';
import type { AgentEnvelope } from '@/lib/agent-cassette-crypto';

export const runtime = 'nodejs';
export async function POST(request: Request): Promise<Response> {
    try {
        requireAgentLoopbackContext(request);
        const body = await readNativeNetworkJson(request, 24 * 1024 * 1024, { signal: request.signal, deadline: performance.now() + 10000 }) as Record<string, unknown>;
        const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body).sort().join(',') : '';
        const item = body?.item as AgentCassetteItem;
        const operation = keys === 'anchor,operation,visitId' && body.operation === 'visita.apri' ? 'visita.apri'
            : keys === 'expectedRevision,operation,visitId' && body.operation === 'visita.chiudi' ? 'visita.chiudi'
            : keys === 'expectedRevision,item,operation,visitId' && item && Object.hasOwn(AGENT_ITEM_OPERATION, item.kind) && body.operation === AGENT_ITEM_OPERATION[item.kind] ? AGENT_ITEM_OPERATION[item.kind] : null;
        if (!operation || typeof body.visitId !== 'string') throw new AgentCassetteDenied(400);
        const database = openDbServer(), store = createAgentCassetteStore(database);
        return withAuthenticatedAgentTransaction(database, request, operation, principal => {
            const receipt = operation === 'visita.apri' ? store.open(principal, body.visitId as string, body.anchor as AgentEnvelope)
                : operation === 'visita.chiudi' ? store.close(principal, body.visitId as string, body.expectedRevision as number)
                : store.add(principal, body.visitId as string, body.expectedRevision as number, item);
            return Response.json({ receipt }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
        });
    } catch (error) {
        return error instanceof AgentCassetteDenied ? Response.json({ code: 'AGENT_CASSETTE_DENIED' }, { status: error.status, headers: { 'Cache-Control': 'no-store' } }) : agentChannelFailure(error);
    }
}
