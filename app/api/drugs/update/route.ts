/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { mintResourcePort, releaseResourcePort, registerPrivateResource, unregisterPrivateResource,
    beginResourceUse, commitResourceUse } from '@/lib/security/web-auth-lifecycle-owner-adapter';
import { getAifaCatalogSnapshot, replaceAifaCatalog } from '@/lib/aifa-catalog-server';
import { AifaUpdateError, withAifaDownload } from '@/lib/aifa-catalog-download';

export const runtime = 'nodejs';

// Inspect without buffering: cap empty chunks and time, and never await stream cancellation.
async function assertEmptyBody(request: Request, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (!request.body) return;
    const reader = request.body.getReader();
    const invalid = () => new AifaUpdateError('La richiesta AIFA non accetta parametri o contenuti', 400);
    let rejectRead!: (reason: unknown) => void;
    const stopped = new Promise<never>((_resolve, reject) => { rejectRead = reject; });
    const cancel = () => rejectRead(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    const deadline = Date.now() + 1_000;
    const timer = setTimeout(() => rejectRead(invalid()), 1_000);
    try {
        for (let reads = 0; reads < 32; reads++) {
            signal.throwIfAborted();
            if (Date.now() >= deadline) throw invalid();
            const chunk = await Promise.race([reader.read(), stopped]);
            signal.throwIfAborted();
            if (Date.now() >= deadline) throw invalid();
            if (chunk.done) return;
            if (chunk.value.byteLength !== 0) throw invalid();
        }
        throw invalid();
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        void reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    // No caller-supplied download configuration or payload is accepted.
    if (new URL(request.url).search) {
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
        await assertEmptyBody(request, controller.signal);
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
