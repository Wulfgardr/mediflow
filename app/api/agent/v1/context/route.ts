import { openDbServer } from '@/lib/db-server';
import { agentChannelFailure, requireAgentLoopback, withAgentTransaction } from '@/lib/security/agent-channel';

export const runtime = 'nodejs';
export async function GET(request: Request): Promise<Response> {
    try {
        requireAgentLoopback(request);
        return withAgentTransaction(openDbServer(), request, null, principal => Response.json({
            agentRef: principal.agentRef, mandateRef: principal.mandateRef, operations: principal.operations,
            expiresAt: principal.expiresAt, modelProvider: principal.modelProvider, allowsClinicalEgress: principal.allowsClinicalEgress,
            publicKey: principal.publicKey,
        }, { headers: { 'Cache-Control': 'no-store' } }));
    } catch (error) { return agentChannelFailure(error); }
}
