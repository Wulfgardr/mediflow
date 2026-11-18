import { visitConfirmationActionSchema } from '@/lib/agent-visit-confirmation-contract';
import { dismissVisitConfirmation, nextVisitConfirmation, prepareVisitConfirmation, presentVisitConfirmation } from '@/lib/agent-visit-confirmation';
import { readNativeNetworkJson } from '@/lib/native-network-json-body';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { hasAttestedLoopbackIngress } from '@/lib/security/loopback-ingress.mjs';
import { isTrustedWebMutationRequest } from '@/lib/security/request-transport';
import { readAuthenticatedWebSession } from '@/lib/security/server-auth';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };
const denied = () => Response.json({ status: 'not_applied' }, { headers, status: 403 });

async function requireVisitConfirmationSession(request: Request) {
    if (!hasAttestedLoopbackIngress(request) || request.headers.has('authorization')) return null;
    const session = await readAuthenticatedWebSession();
    return session?.role === 'admin' && session.authChannel === 'web' ? session : null;
}

export async function GET(request: Request): Promise<Response> {
    try {
        const session = await requireVisitConfirmationSession(request);
        if (!session) return denied();
        return Response.json(nextVisitConfirmation(session), { headers });
    } catch { return denied(); }
}

export async function POST(request: Request): Promise<Response> {
    try {
        if (!isTrustedWebMutationRequest(request)) return denied();
        const session = await requireVisitConfirmationSession(request);
        if (!session) return denied();
        const refusal = archiveWriteRequestDenial(request, session);
        if (refusal) return refusal;
        const input = visitConfirmationActionSchema.safeParse(await readNativeNetworkJson(request, 12 * 1024 * 1024,
            { signal: request.signal, deadline: performance.now() + 10000 }));
        if (!input.success || (await requireVisitConfirmationSession(request))?.id !== session.id) return denied();
        switch (input.data.action) {
            case 'prepare': return Response.json(await prepareVisitConfirmation(session, input.data.reference, input.data.patientId,
                input.data.patientVersion, request.signal), { headers });
            case 'dismiss': dismissVisitConfirmation(session, input.data.reference); return new Response(null, { status: 204, headers });
            case 'show': return Response.json(await presentVisitConfirmation(request, session, () => requireVisitConfirmationSession(request),
                input.data.reference, input.data.plan, input.data.presentation), { headers });
        }
    } catch { return denied(); }
}
