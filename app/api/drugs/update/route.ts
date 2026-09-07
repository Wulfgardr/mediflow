/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { mintResourcePort, releaseResourcePort, registerPrivateResource, unregisterPrivateResource,
    beginResourceUse, commitResourceUse } from '@/lib/security/web-auth-lifecycle-owner-adapter';
import { getAifaCatalogSnapshot, replaceAifaCatalog } from '@/lib/aifa-catalog-server';
import { AifaUpdateError, withAifaDownload } from '@/lib/aifa-catalog-download';

export const runtime = 'nodejs';

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    // No caller-supplied download configuration or payload is accepted.
    if (new URL(request.url).search || request.body !== null) {
        return Response.json({ error: 'La richiesta AIFA non accetta parametri o contenuti' }, { status: 400 });
    }
    const port = mintResourcePort(session);
    if (!port) return unauthorizedResponse();
    const controller = new AbortController();
    const cancel = () => controller.abort(new AifaUpdateError('Aggiornamento annullato', 499));
    request.signal.addEventListener('abort', cancel, { once: true });
    if (request.signal.aborted) cancel();
    const registration = registerPrivateResource(port, () => {
        controller.abort(new AifaUpdateError('Sessione non più valida', 401));
    });
    const expiry = setTimeout(() => controller.abort(new AifaUpdateError('Sessione scaduta', 401)), Math.max(0, session.expiresAt - Date.now()));
    try {
        if (!registration) throw new AifaUpdateError('Sessione non più valida', 401);
        const assertSession = () => {
            controller.signal.throwIfAborted();
            const use = beginResourceUse(port);
            if (!use || !commitResourceUse(use)) throw new AifaUpdateError('Sessione non più valida', 401);
        };
        assertSession();
        const snapshot = getAifaCatalogSnapshot();
        assertSession();
        const result = await withAifaDownload(controller.signal, async (file, acquisition, signal, assertDeadline) => {
            const current = await requireSession();
            if (!current || current.id !== session.id) throw new AifaUpdateError('Sessione non più valida', 401);
            return replaceAifaCatalog(file, acquisition, { snapshot, assertCurrent: () => {
                assertDeadline();
                signal.throwIfAborted();
                assertSession();
            } });
        });
        return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return Response.json({ error: error instanceof AifaUpdateError ? error.message : 'Aggiornamento AIFA non riuscito; catalogo conservato' },
            { status: error instanceof AifaUpdateError ? error.status : 422 });
    } finally {
        clearTimeout(expiry);
        request.signal.removeEventListener('abort', cancel);
        if (registration) unregisterPrivateResource(port, registration);
        releaseResourcePort(port);
    }
}
