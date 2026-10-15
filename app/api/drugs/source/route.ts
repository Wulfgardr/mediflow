import { assertEmptyAifaRequestBody } from '@/lib/aifa-catalog-request';
import { AifaUpdateError } from '@/lib/aifa-catalog-lock';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { checkAifaSource, getAifaSourceStatus } from '@/lib/aifa-catalog-source-server';

import { mintResourcePort, releaseResourcePort, registerPrivateResource, unregisterPrivateResource,
    beginResourceUse, commitResourceUse } from '@/lib/security/web-auth-lifecycle-owner-adapter';
import { archiveGenerationForSession } from '@/lib/security/archive-session-generation';
import { assertArchiveGeneration } from '@/lib/archive-generation';
import { dbServer } from '@/lib/db-server';

export const runtime = 'nodejs';

export async function GET() {
    if (!await requireSession()) return unauthorizedResponse();
    return Response.json(await getAifaSourceStatus(), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    const denial = archiveWriteRequestDenial(request, session);
    if (denial) return denial;
    if (new URL(request.url).search) return Response.json({ error: 'La verifica AIFA non accetta contenuti o parametri' }, { status: 400 });
    const port = mintResourcePort(session);
    if (!port) return unauthorizedResponse();
    const controller = new AbortController();
    const cancel = () => controller.abort(new Error('AIFA_CHECK_CANCELLED'));
    request.signal.addEventListener('abort', cancel, { once: true });
    if (request.signal.aborted) cancel();
    const registration = registerPrivateResource(port, cancel);
    const expiry = setTimeout(cancel, Math.max(0, session.expiresAt - Date.now()));
    try {
        await assertEmptyAifaRequestBody(request, controller.signal);
        const status = await checkAifaSource(controller.signal, () => {
            controller.signal.throwIfAborted();
            const use = beginResourceUse(port);
            if (!registration || !use || !commitResourceUse(use)) throw new Error('SESSION_INVALID');
            assertArchiveGeneration(dbServer, archiveGenerationForSession(session));
        });
        return Response.json(status, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        if (error instanceof AifaUpdateError && error.status === 400) {
            return Response.json({ error: 'La verifica AIFA non accetta contenuti o parametri' }, { status: 400 });
        }
        return Response.json({ error: 'Verifica AIFA non disponibile' }, { status: 503 });
    } finally {
        clearTimeout(expiry);
        request.signal.removeEventListener('abort', cancel);
        if (registration) unregisterPrivateResource(port, registration);
        releaseResourcePort(port);
    }
}
