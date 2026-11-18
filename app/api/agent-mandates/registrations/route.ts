import { requireAgentSettingsSession } from '@/lib/security/agent-settings-session';
import { createAgentRegistrationStore } from '@/lib/agent-registration-store';
import { AgentMandateDenied } from '@/lib/agent-mandate-store';
import { openDbServer } from '@/lib/db-server';
import { readNativeNetworkJson } from '@/lib/native-network-json-body';

export const runtime = 'nodejs';
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request: Request): Promise<Response> {
    try {
        const access = await requireAgentSettingsSession(request, false);
        return access ? reply(createAgentRegistrationStore(openDbServer()).list(access.session.userId)) : reply({ code: 'AGENT_REGISTRATION_DENIED' }, 403);
    } catch { return reply({ code: 'AGENT_REGISTRATION_UNAVAILABLE' }, 503); }
}

export async function DELETE(request: Request): Promise<Response> {
    try {
        const body = await readNativeNetworkJson(request, 128, { signal: request.signal, deadline: performance.now() + 2000 }) as Record<string, unknown>;
        if (!body || Object.keys(body).join(',') !== 'id' || typeof body.id !== 'string') return reply({ code: 'INVALID_INPUT' }, 400);
        const access = await requireAgentSettingsSession(request, true);
        if (!access) return reply({ code: 'AGENT_REGISTRATION_DENIED' }, 403);
        createAgentRegistrationStore(openDbServer()).revoke(body.id, access.session.userId, access.generation);
        return reply({ status: 'revoked' });
    } catch (error) { return reply({ code: 'AGENT_REGISTRATION_DENIED' }, error instanceof AgentMandateDenied ? 403 : 503); }
}
