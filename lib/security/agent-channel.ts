import 'server-only';
import type Database from 'better-sqlite3';
import { hasAttestedLoopbackIngress } from './loopback-ingress.mjs';
import { createAgentPairingStore, type AgentPrincipal } from '../agent-pairing-store';
import type { AgentOperation } from '../agent-mandate-contract';

export class AgentChannelDenied extends Error {
    constructor(readonly status: 401 | 403 | 404) { super('AGENT_CHANNEL_DENIED'); }
}
export function requireAgentLoopbackContext(request: Request): void {
    if (!hasAttestedLoopbackIngress(request)) throw new AgentChannelDenied(404);
}
export function withAuthenticatedAgentTransaction<T>(database: Database.Database, request: Request, operation: AgentOperation | null,
    consume: (principal: AgentPrincipal) => T): T {
    requireAgentLoopbackContext(request);
    const match = /^Bearer (mfa_[A-Za-z0-9_-]{43})$/u.exec(request.headers.get('authorization') ?? '');
    if (!match) throw new AgentChannelDenied(401);
    return database.transaction(() => {
        const principal = createAgentPairingStore(database).principal(match[1]!);
        if (!principal) throw new AgentChannelDenied(401);
        if (operation && !principal.operations.includes(operation)) throw new AgentChannelDenied(403);
        return consume(principal);
    }).immediate();
}
export function agentChannelFailure(error: unknown): Response {
    const status = error instanceof AgentChannelDenied ? error.status : 503;
    return Response.json({ code: 'AGENT_CHANNEL_DENIED' }, { status, headers: { 'Cache-Control': 'no-store' } });
}
