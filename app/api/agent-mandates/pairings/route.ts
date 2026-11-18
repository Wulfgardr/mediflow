import { requireAgentSettingsSession } from '@/lib/security/agent-settings-session';
import { verifyHostCredentials } from '@/lib/security/host-credential-verification';
import { createAgentPairingStore } from '@/lib/agent-pairing-store';
import { AgentMandateDenied } from '@/lib/agent-mandate-store';
import { openDbServer } from '@/lib/db-server';
import { readNativeNetworkJson } from '@/lib/native-network-json-body';

export const runtime = 'nodejs';
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request: Request): Promise<Response> {
    try {
        if (!await requireAgentSettingsSession(request, false)) return reply({ code: 'PAIRING_APPROVAL_DENIED' }, 403);
        return reply(createAgentPairingStore(openDbServer()).pending());
    } catch { return reply({ code: 'PAIRING_APPROVAL_UNAVAILABLE' }, 503); }
}
export async function POST(request: Request): Promise<Response> {
    try {
        const current = await requireAgentSettingsSession(request, true);
        if (!current) return reply({ code: 'PAIRING_APPROVAL_DENIED' }, 403);
        const body = await readNativeNetworkJson(request, 1024, { signal: request.signal, deadline: performance.now() + 2000 }) as Record<string, unknown>;
        if (!body || typeof body.code !== 'string' || typeof body.mandateRef !== 'string' || typeof body.requestId !== 'string')
            return reply({ code: 'INVALID_INPUT' }, 400);
        const renewable = body.renewOnUnlock === true;
        if (Object.keys(body).sort().join(',') !== (renewable ? 'code,mandateRef,pin,renewOnUnlock,requestId' : 'code,mandateRef,requestId'))
            return reply({ code: 'INVALID_INPUT' }, 400);
        if (renewable) {
            if (typeof body.pin !== 'string' || !/^[0-9]{4,8}$/u.test(body.pin)) return reply({ code: 'INVALID_INPUT' }, 400);
            const verified = await verifyHostCredentials({ username: current.session.username, pin: body.pin });
            if (verified.kind !== 'verified' || verified.account.id !== current.session.userId)
                return reply({ code: 'PAIRING_APPROVAL_DENIED' }, 403);
        }
        const fresh = await requireAgentSettingsSession(request, true);
        if (fresh?.session.id !== current.session.id || fresh.session.userId !== current.session.userId || fresh.generation !== current.generation)
            return reply({ code: 'PAIRING_APPROVAL_DENIED' }, 403);
        return reply(createAgentPairingStore(openDbServer()).approve(body.requestId, body.code, body.mandateRef,
            current.session.userId, current.generation, renewable));
    } catch (error) { return reply({ code: 'PAIRING_APPROVAL_DENIED' }, error instanceof AgentMandateDenied ? 403 : 503); }
}
