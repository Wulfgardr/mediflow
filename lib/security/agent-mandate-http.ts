import 'server-only';
import type { ServerSession } from './server-session';
import { isTrustedWebMutationRequest } from './request-transport';
import { hasAttestedLoopbackIngress } from './loopback-ingress.mjs';
import { validMandateInput } from '../agent-mandate-contract';
import { AgentMandateDenied, type createAgentMandateStore } from '../agent-mandate-store';
import { archiveGenerationForSession } from './archive-session-generation';
import { readNativeNetworkJson } from '../native-network-json-body';

type Sources = {
    session(): Promise<ServerSession | null>;
    verifyPin(username: string, pin: string): Promise<string | null>;
    store(): ReturnType<typeof createAgentMandateStore>;
};
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const denied = (status = 403) => reply({ code: 'AGENT_MANDATE_DENIED', error: 'Mandato non disponibile.' }, status);
export function createAgentMandateHttp(sources: Sources) {
    async function admitted(request: Request, mutation: boolean): Promise<ServerSession | null> {
        if (!hasAttestedLoopbackIngress(request) || mutation && !isTrustedWebMutationRequest(request)
            || request.headers.has('authorization')) return null;
        const session = await sources.session();
        if (!session || session.authChannel !== 'web' || session.role !== 'admin') return null;
        if (mutation && request.headers.get('x-mediflow-archive-generation') !== archiveGenerationForSession(session)) return null;
        return session;
    }
    return {
        GET: async (request: Request): Promise<Response> => {
            try {
                const session = await admitted(request, false);
                return session ? reply(sources.store().list(session.userId)) : denied(401);
            } catch { return denied(503); }
        },
        POST: async (request: Request): Promise<Response> => {
            try {
                const session = await admitted(request, true);
                if (!session) return denied();
                const value = await readNativeNetworkJson(request, 8192, { signal: request.signal, deadline: performance.now() + 2000 }) as Record<string, unknown>;
                if (!value || Object.keys(value).sort().join(',') !== 'mandate,pin' || !validMandateInput(value.mandate)
                    || typeof value.pin !== 'string' || !/^[0-9]{4,8}$/u.test(value.pin)) return denied(400);
                const publicKey = await crypto.subtle.importKey('raw', Uint8Array.from(atob(value.mandate.publicKey), byte => byte.charCodeAt(0)),
                    { name: 'ECDH', namedCurve: 'P-256' }, false, []);
                if (publicKey.type !== 'public') return denied(400);
                const verified = await sources.verifyPin(session.username, value.pin);
                const current = await admitted(request, true);
                if (verified !== session.userId || current?.id !== session.id || current.userId !== session.userId) return denied();
                const mandate = sources.store().create(value.mandate, session.userId, archiveGenerationForSession(session)!);
                return reply(mandate, 201);
            } catch (error) { return denied(error instanceof AgentMandateDenied ? 403 : 503); }
        },
        DELETE: async (request: Request): Promise<Response> => {
            try {
                const session = await admitted(request, true);
                if (!session) return denied();
                const value = await readNativeNetworkJson(request, 512, { signal: request.signal, deadline: performance.now() + 2000 }) as Record<string, unknown>;
                if (!value || Object.keys(value).join(',') !== 'id' || typeof value.id !== 'string') return denied(400);
                sources.store().revoke(value.id, session.userId, archiveGenerationForSession(session)!);
                return reply({ status: 'revoked' });
            } catch (error) { return denied(error instanceof AgentMandateDenied ? 403 : 503); }
        },
    };
}
