import { requireAgentSettingsSession } from '@/lib/security/agent-settings-session';
import { confirmAgentUnlock } from '@/lib/security/agent-unlock-session';
import { createAgentRegistrationStore } from '@/lib/agent-registration-store';
import { AgentMandateDenied } from '@/lib/agent-mandate-store';
import { openDbServer } from '@/lib/db-server';
import { readNativeNetworkJson } from '@/lib/native-network-json-body';

export const runtime = 'nodejs';
const reply = (status: number) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request): Promise<Response> {
    try {
        const body = await readNativeNetworkJson(request, 128, { signal: request.signal, deadline: performance.now() + 2000 }) as Record<string, unknown>;
        if (!body || Object.keys(body).join(',') !== 'ticket' || typeof body.ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(body.ticket)) return reply(400);
        const access = await requireAgentSettingsSession(request, true);
        if (!access) return reply(403);
        const { session, generation } = access;
        return reply(confirmAgentUnlock(body.ticket, session.id, session.userId,
            unlockRef => createAgentRegistrationStore(openDbServer()).renew(session.userId, generation, unlockRef)) ? 204 : 403);
    } catch (error) { return reply(error instanceof AgentMandateDenied ? 403 : 503); }
}
