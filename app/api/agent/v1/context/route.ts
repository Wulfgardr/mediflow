import { openDbServer } from '@/lib/db-server';
import { agentChannelFailure, requireAgentLoopbackContext, withAuthenticatedAgentTransaction } from '@/lib/security/agent-channel';

export const runtime = 'nodejs';
export async function GET(request: Request): Promise<Response> {
    try {
        requireAgentLoopbackContext(request);
        return withAuthenticatedAgentTransaction(openDbServer(), request, null, principal => Response.json({
            agentRef: principal.agentRef, mandateRef: principal.mandateRef, operations: principal.operations,
            expiresAt: principal.expiresAt, modelProvider: principal.modelProvider, allowsClinicalEgress: principal.allowsClinicalEgress,
            publicKey: principal.publicKey,
        }, { headers: { 'Cache-Control': 'no-store' } }));
    } catch (error) { return agentChannelFailure(error); }
}
