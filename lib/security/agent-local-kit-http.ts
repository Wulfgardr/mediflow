import 'server-only';
import type { ServerSession } from './server-session';
import { isTrustedWebMutationRequest } from './request-transport';
import { hasAttestedLoopbackIngress } from './loopback-ingress.mjs';
import { validMandateInput } from '../agent-mandate-contract';
import { AgentMandateDenied } from '../agent-mandate-store';
import type { createAgentLocalKitStore } from '../agent-local-kit-store';
import { archiveGenerationForSession } from './archive-session-generation';
import { readNativeNetworkJson } from '../native-network-json-body';
import {
    isValidLoopbackOrigin,
    LocalKitPathError,
    readDepositoJson,
    removeLocalKitCredentials,
    resolveKitCredentialsDirectory,
    validateLocalKitDirectory,
    writeLocalKitCredentials,
} from './agent-local-kit-files';

type Sources = {
    session(): Promise<ServerSession | null>;
    verifyPin(username: string, pin: string): Promise<string | null>;
    store(): ReturnType<typeof createAgentLocalKitStore>;
    renew?: (request: Request, session: ServerSession, generation: string) => boolean;
};

const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const denied = (status = 403, code = 'AGENT_LOCAL_KIT_DENIED') => reply({ code, error: 'Collegamento non disponibile.' }, status);

function resolveLoopbackOrigin(deposito: Record<string, unknown>, request: Request): string {
    if (isValidLoopbackOrigin(deposito.origine)) return deposito.origine;
    try {
        const requestOrigin = new URL(request.url).origin;
        if (isValidLoopbackOrigin(requestOrigin)) return requestOrigin;
    } catch {
    }
    throw new LocalKitPathError('LOCAL_KIT_PATH_INVALID');
}

export function createAgentLocalKitHttp(sources: Sources) {
    async function admitted(request: Request, mutation: boolean): Promise<{ session: ServerSession; generation: string } | null> {
        if (!hasAttestedLoopbackIngress(request) || (mutation && !isTrustedWebMutationRequest(request))
            || request.headers.has('authorization')) return null;
        const session = await sources.session();
        if (!session || session.authChannel !== 'web' || session.role !== 'admin') return null;
        const generation = archiveGenerationForSession(session);
        if (!generation) return null;
        if (mutation && request.headers.get('x-mediflow-archive-generation') !== generation) return null;
        return { session, generation };
    }

    return {
        GET: async (request: Request): Promise<Response> => {
            try {
                const access = await admitted(request, false);
                return access ? reply(sources.store().status(access.session.userId)) : denied(401);
            } catch {
                return denied(503);
            }
        },
        PATCH: async (request: Request): Promise<Response> => {
            try {
                const access = await admitted(request, true);
                if (!access || !sources.renew) return denied(403);
                const store = sources.store();
                const current = store.status(access.session.userId);
                if (!current.connected) return denied(409, 'LOCAL_KIT_NOT_CONNECTED');
                if (!sources.renew(request, access.session, access.generation)) return denied(403);
                return reply(store.status(access.session.userId));
            } catch (error) {
                return denied(error instanceof AgentMandateDenied ? 403 : 503);
            }
        },
        PUT: async (request: Request): Promise<Response> => {
            try {
                const access = await admitted(request, true);
                if (!access) return denied(403);
                const body = await readNativeNetworkJson(request, 2048, { signal: request.signal, deadline: performance.now() + 2000 }) as Record<string, unknown>;
                if (!body || Object.keys(body).join(',') !== 'kitPath' || typeof body.kitPath !== 'string') return denied(400, 'INVALID_INPUT');
                const validated = validateLocalKitDirectory(body.kitPath);
                readDepositoJson(validated);
                const current = sources.store().status(access.session.userId);
                if (current.connected && current.kitPath !== validated) return denied(409, 'LOCAL_KIT_CONNECTED');
                return reply(sources.store().saveKitPath(validated, access.session.userId, access.generation));
            } catch (error) {
                if (error instanceof LocalKitPathError) return denied(400, error.code);
                return denied(error instanceof AgentMandateDenied ? 403 : 503);
            }
        },
        POST: async (request: Request): Promise<Response> => {
            try {
                const access = await admitted(request, true);
                if (!access) return denied(403);
                const body = await readNativeNetworkJson(request, 8192, { signal: request.signal, deadline: performance.now() + 2000 }) as Record<string, unknown>;
                if (!body || typeof body !== 'object') return denied(400, 'INVALID_INPUT');
                const keys = Object.keys(body).sort().join(',');
                if (keys !== 'mandate,pin' && keys !== 'kitPath,mandate,pin') return denied(400, 'INVALID_INPUT');
                if (!validMandateInput(body.mandate) || typeof body.pin !== 'string' || !/^[0-9]{4,8}$/u.test(body.pin)) {
                    return denied(400, 'INVALID_INPUT');
                }
                if (body.kitPath !== undefined && typeof body.kitPath !== 'string') return denied(400, 'INVALID_INPUT');

                const store = sources.store();
                const requestedKitPath = typeof body.kitPath === 'string' ? body.kitPath : store.readKitPath();
                const physicalKitDir = validateLocalKitDirectory(requestedKitPath);
                const deposito = readDepositoJson(physicalKitDir);
                resolveKitCredentialsDirectory(requestedKitPath, deposito);
                const origin = resolveLoopbackOrigin(deposito, request);

                const publicKey = await crypto.subtle.importKey(
                    'raw',
                    Uint8Array.from(atob(body.mandate.publicKey), byte => byte.charCodeAt(0)),
                    { name: 'ECDH', namedCurve: 'P-256' },
                    false,
                    [],
                );
                if (publicKey.type !== 'public') return denied(400, 'INVALID_INPUT');

                const verified = await sources.verifyPin(access.session.username, body.pin);
                const fresh = await admitted(request, true);
                if (verified !== access.session.userId || fresh?.session.id !== access.session.id
                    || fresh.session.userId !== access.session.userId || fresh.generation !== access.generation) {
                    return denied(403);
                }

                if (typeof body.kitPath === 'string') {
                    const current = store.status(access.session.userId);
                    if (current.connected && current.kitPath !== physicalKitDir) return denied(409, 'LOCAL_KIT_CONNECTED');
                    store.saveKitPath(physicalKitDir, access.session.userId, access.generation);
                }
                const connection = store.connect(body.mandate, access.session.userId, access.generation);
                try {
                    writeLocalKitCredentials(
                        physicalKitDir,
                        {
                            agentRef: connection.agentRef,
                            mandateRef: connection.mandateRef,
                            token: connection.bearerToken,
                            expiresAt: connection.expiresAt,
                            origin,
                        },
                        {
                            agentRef: connection.agentRef,
                            token: connection.registrationToken,
                            origin,
                        },
                        connection.patientReferenceKey,
                    );
                } catch (writeError) {
                    store.disconnect(access.session.userId, access.generation);
                    throw writeError;
                }

                return reply({
                    status: 'connected',
                    agentRef: connection.agentRef,
                    mandateRef: connection.mandateRef,
                    expiresAt: connection.expiresAt,
                    kitPath: physicalKitDir,
                }, 201);
            } catch (error) {
                if (error instanceof LocalKitPathError) return denied(400, error.code);
                return denied(error instanceof AgentMandateDenied ? 403 : 503);
            }
        },
        DELETE: async (request: Request): Promise<Response> => {
            try {
                const access = await admitted(request, true);
                if (!access) return denied(403);
                const store = sources.store();
                const kitPath = store.readKitPath();
                const { agentRef } = store.disconnect(access.session.userId, access.generation);
                if (agentRef) {
                    removeLocalKitCredentials(kitPath, agentRef);
                }
                return reply({ status: 'disconnected' });
            } catch (error) {
                return denied(error instanceof AgentMandateDenied ? 403 : 503);
            }
        },
    };
}
