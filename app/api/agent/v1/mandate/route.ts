import { openDbServer } from '@/lib/db-server';
import { createAgentRegistrationStore } from '@/lib/agent-registration-store';
import { AgentMandateDenied } from '@/lib/agent-mandate-store';
import { agentChannelFailure, requireAgentLoopbackContext, AgentChannelDenied } from '@/lib/security/agent-channel';
import { isAgentUnlockActive } from '@/lib/security/agent-unlock-session';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
    try {
        requireAgentLoopbackContext(request);
        const registration = /^Bearer (mfr_[A-Za-z0-9_-]{43})$/u.exec(request.headers.get('authorization') ?? '')?.[1];
        if (!registration) throw new AgentChannelDenied(401);
        const { token, ...receipt } = createAgentRegistrationStore(openDbServer()).retrieve(registration, isAgentUnlockActive);
        return Response.json({ receipt, credential: { token } }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) { return agentChannelFailure(error instanceof AgentMandateDenied ? new AgentChannelDenied(401) : error); }
}
