import 'server-only';
import { hasAttestedLoopbackIngress } from './loopback-ingress.mjs';
import { isTrustedWebMutationRequest } from './request-transport';
import { readAuthenticatedWebSession } from './server-auth';
import { archiveGenerationForSession, currentArchiveGeneration } from './archive-session-generation';

export async function requireLocalWebAdminSession(request: Request, mutation: boolean) {
    if (!hasAttestedLoopbackIngress(request) || request.headers.has('authorization')
        || request.headers.has('x-mediflow-token') || (mutation && !isTrustedWebMutationRequest(request))) return null;
    const session = await readAuthenticatedWebSession();
    if (!session || session.authChannel !== 'web' || session.role !== 'admin') return null;
    const generation = archiveGenerationForSession(session);
    if (!generation || generation !== currentArchiveGeneration()
        || (mutation && request.headers.get('x-mediflow-archive-generation') !== generation)) return null;
    return { session, generation };
}
