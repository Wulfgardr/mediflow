import 'server-only';
import type { ServerSession } from './server-session';
import { isTrustedWebMutationRequest } from './request-transport';
import { hasAttestedLoopbackIngress } from './loopback-ingress.mjs';
import { AgentMandateDenied } from '../agent-mandate-store';
import type { createAgentLocalKitStore } from '../agent-local-kit-store';
import { archiveGenerationForSession } from './archive-session-generation';
import { readNativeNetworkJson } from '../native-network-json-body';
import {
    AGENT_PATIENT_CONTEXT_MAX_BYTES,
    parseAgentPatientContextInput,
    sealAgentPatientContextEnvelope,
} from '../agent-local-kit-context-contract';
import {
    clearLocalKitPatientContexts,
    listLocalKitPatientContexts,
    LocalKitPathError,
    removeLocalKitPatientContext,
    writeLocalKitPatientContext,
} from './agent-local-kit-files';

type Sources = {
    session(): Promise<ServerSession | null>;
    store(): ReturnType<typeof createAgentLocalKitStore>;
    isUnlockActive?: (ref: string, actorRef: string) => boolean;
};

const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const denied = (status = 403, code = 'AGENT_LOCAL_KIT_DENIED') => reply({ code, error: 'Contesto agente non disponibile.' }, status);

export function createAgentLocalKitContextHttp(sources: Sources) {
    async function admitted(request: Request, mutation: boolean, requireJsonBody = true): Promise<{ session: ServerSession; generation: string } | null> {
        if (!hasAttestedLoopbackIngress(request) || (mutation && !isTrustedWebMutationRequest(request, requireJsonBody))
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
                if (!access) return denied(401);
                const status = sources.store().status(access.session.userId, sources.isUnlockActive);
                let items: Array<{ taxCodeLast4: string; exportedAt: number; expiresAt: number }> = [];
                try {
                    items = listLocalKitPatientContexts(status.kitPath).map(({ taxCodeLast4, exportedAt, expiresAt }) => ({
                        taxCodeLast4,
                        exportedAt,
                        expiresAt,
                    }));
                } catch (error) {
                    if (!(error instanceof LocalKitPathError)) throw error;
                }
                return reply({
                    connected: status.connected,
                    active: status.active,
                    count: items.length,
                    items,
                });
            } catch {
                return denied(503);
            }
        },
        POST: async (request: Request): Promise<Response> => {
            try {
                const access = await admitted(request, true, true);
                if (!access) return denied(403);
                const store = sources.store();
                const status = store.status(access.session.userId, sources.isUnlockActive);
                if (!status.connected || !status.active) return denied(403, 'LOCAL_KIT_INACTIVE');
                const body = await readNativeNetworkJson(request, AGENT_PATIENT_CONTEXT_MAX_BYTES + 4096, {
                    signal: request.signal,
                    deadline: performance.now() + 2000,
                });
                const parsed = parseAgentPatientContextInput(body);
                if (!parsed) return denied(400, 'INVALID_INPUT');
                const fresh = await admitted(request, true, true);
                if (!fresh || fresh.session.id !== access.session.id
                    || fresh.session.userId !== access.session.userId
                    || fresh.generation !== access.generation) {
                    return denied(403);
                }
                const freshStatus = store.status(access.session.userId, sources.isUnlockActive);
                if (!freshStatus.connected || !freshStatus.active || freshStatus.kitPath !== status.kitPath) {
                    return denied(403, 'LOCAL_KIT_INACTIVE');
                }
                const envelope = sealAgentPatientContextEnvelope(parsed);
                writeLocalKitPatientContext(freshStatus.kitPath, envelope);
                try {
                    store.recordContextAudit(
                        'agent.context.exported',
                        access.session.userId,
                        envelope.patient.cfHash,
                        access.generation,
                        sources.isUnlockActive,
                    );
                } catch (auditError) {
                    try {
                        removeLocalKitPatientContext(freshStatus.kitPath, envelope.patient.cfHash);
                    } catch {
                    }
                    throw auditError;
                }
                return reply({
                    status: 'exported',
                    taxCodeLast4: envelope.patient.taxCodeLast4,
                    exportedAt: envelope.exportedAt,
                    expiresAt: envelope.expiresAt,
                }, 201);
            } catch (error) {
                if (error instanceof LocalKitPathError) return denied(400, error.code);
                return denied(error instanceof AgentMandateDenied ? 403 : 503);
            }
        },
        DELETE: async (request: Request): Promise<Response> => {
            try {
                const access = await admitted(request, true, false);
                if (!access) return denied(403);
                const store = sources.store();
                const kitPath = store.readKitPath();
                let removed = 0;
                try {
                    removed = clearLocalKitPatientContexts(kitPath);
                } catch (error) {
                    if (!(error instanceof LocalKitPathError)) throw error;
                }
                store.recordContextAudit('agent.context.cleared', access.session.userId, 'all', access.generation);
                return reply({ status: 'cleared', removed });
            } catch (error) {
                return denied(error instanceof AgentMandateDenied ? 403 : 503);
            }
        },
    };
}
