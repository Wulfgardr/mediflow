import { requireAgentSettingsSession } from '@/lib/security/agent-settings-session';
import { confirmAgentUnlock, confirmSharedAgentUnlock } from '@/lib/security/agent-unlock-session';
import { createAgentRegistrationStore } from '@/lib/agent-registration-store';
import { AgentMandateDenied } from '@/lib/agent-mandate-store';
import { openDbServer } from '@/lib/db-server';
import { bootstrapWebAuthControl, webAuthControlEtagFromHeader, webAuthControlIdFromRequest } from '@/lib/security/web-auth-control-transport';
import { readNativeNetworkJson } from '@/lib/native-network-json-body';

export const runtime = 'nodejs';
const reply = (status: number) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request): Promise<Response> {
    try {
        const body = await readNativeNetworkJson(request, 128, { signal: request.signal, deadline: performance.now() + 2000 }) as Record<string, unknown>;
        if (!body || Object.keys(body).length !== 1) return reply(400);
        const access = await requireAgentSettingsSession(request, true);
        if (!access) return reply(403);
        const { session, generation } = access;
        const issue = (unlockRef: string) => createAgentRegistrationStore(openDbServer()).renew(session.userId, generation, unlockRef);
        if (typeof body.ticket === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(body.ticket))
            return reply(confirmAgentUnlock(body.ticket, session.id, session.userId, issue) ? 204 : 403);
        if (typeof body.sharedTab !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(body.sharedTab))
            return reply(400);
        const controlId = webAuthControlIdFromRequest(request);
        const etag = webAuthControlEtagFromHeader(request.headers.get('if-match'));
        const control = controlId && etag ? bootstrapWebAuthControl(controlId) : null;
        if (!control || control.controlId !== controlId || control.etag !== etag) return reply(403);
        return reply(confirmSharedAgentUnlock(body.sharedTab, session.id, control.controlId, session.userId, issue) ? 204 : 403);
    } catch (error) { return reply(error instanceof AgentMandateDenied ? 403 : 503); }
}
