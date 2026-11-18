import { z } from 'zod';
import { openDbServer } from '@/lib/db-server';
import { startVisitConfirmation, readVisitConfirmationReceipt } from '@/lib/agent-visit-confirmation';
import { visitConfirmationId } from '@/lib/agent-visit-confirmation-contract';
import { readNativeNetworkJson } from '@/lib/native-network-json-body';
import { AgentChannelDenied, agentChannelFailure, requireAgentLoopbackContext, withAuthenticatedAgentTransaction } from '@/lib/security/agent-channel';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };

export async function POST(request: Request): Promise<Response> {
    try {
        requireAgentLoopbackContext(request);
        const body = z.object({ visitId: visitConfirmationId }).strict().safeParse(await readNativeNetworkJson(request, 1024,
            { signal: request.signal, deadline: performance.now() + 3000 }));
        if (!body.success) throw new AgentChannelDenied(403);
        return withAuthenticatedAgentTransaction(openDbServer(), request, 'visita.chiudi', principal =>
            Response.json(startVisitConfirmation(principal, body.data.visitId), { headers }));
    } catch (error) { return agentChannelFailure(error); }
}

export function GET(request: Request): Response {
    try {
        const query = new URL(request.url).searchParams;
        const ref = visitConfirmationId.safeParse(query.get('reference'));
        if (!ref.success || query.size !== 1) throw new AgentChannelDenied(403);
        return withAuthenticatedAgentTransaction(openDbServer(), request, 'visita.chiudi', principal =>
            Response.json(readVisitConfirmationReceipt(principal, ref.data), { headers }));
    } catch (error) { return agentChannelFailure(error); }
}
