import 'server-only';
import { readAuthenticatedWebSession } from './server-auth';
import { hasAttestedLoopbackIngress } from './loopback-ingress.mjs';
import { isTrustedWebMutationRequest } from './request-transport';
import { archiveGenerationForSession } from './archive-session-generation';

export async function requireAgentSettingsSession(request: Request, mutation: boolean) {
    if (!hasAttestedLoopbackIngress(request) || request.headers.has('authorization') || (mutation && !isTrustedWebMutationRequest(request))) return null;
    const session = await readAuthenticatedWebSession();
    if (!session || session.role !== 'admin' || session.authChannel !== 'web') return null;
    const generation = archiveGenerationForSession(session);
    if (!generation || (mutation && request.headers.get('x-mediflow-archive-generation') !== generation)) return null;
    return { session, generation };
}
