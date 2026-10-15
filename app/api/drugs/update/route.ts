import { assertEmptyAifaRequestBody } from '@/lib/aifa-catalog-request';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { mintResourcePort, releaseResourcePort, registerPrivateResource, unregisterPrivateResource,
    beginResourceUse, commitResourceUse } from '@/lib/security/web-auth-lifecycle-owner-adapter';
import { recordAifaCatalogRejection, getAifaCatalogSnapshot, getAifaCatalogStatus, confirmAifaCatalogUnchanged, replaceAifaCatalog } from '@/lib/aifa-catalog-server';
import { AifaUpdateError, AifaReductionError, getAifaDownloadProgress, withAifaDownload } from '@/lib/aifa-catalog-download';

import { assertAifaNetworkAllowed } from '@/lib/aifa-catalog-source-server';
import type { AifaCatalogManifest } from '@/lib/aifa-catalog';
import { AIFA_DOWNLOAD_URL } from '@/lib/aifa-catalog-download';
import { buildAuditWriteInputFromRequest } from '@/lib/security/audit';

export const runtime = 'nodejs';

export async function GET() {
    if (!await requireSession()) return unauthorizedResponse();
    return Response.json({ progress: getAifaDownloadProgress() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    // No caller-supplied download configuration or payload is accepted.
    if (new URL(request.url).search) {
        return Response.json({ error: 'La richiesta AIFA non accetta parametri o contenuti' }, { status: 400 });
    }
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;
    const port = mintResourcePort(session);
    if (!port) return unauthorizedResponse();
    const controller = new AbortController();
    const cancel = () => controller.abort(new AifaUpdateError('Aggiornamento annullato', 499));
    request.signal.addEventListener('abort', cancel, { once: true });
    if (request.signal.aborted) cancel();
    const registration = registerPrivateResource(port, () => {
        controller.abort(new AifaUpdateError('Sessione non più valida', 401));
    });
    let previousManifest: AifaCatalogManifest | null = null;
    const expiry = setTimeout(() => controller.abort(new AifaUpdateError('Sessione scaduta', 401)), Math.max(0, session.expiresAt - Date.now()));
    try {
        if (!registration) throw new AifaUpdateError('Sessione non più valida', 401);
        const assertSession = () => {
            controller.signal.throwIfAborted();
            const use = beginResourceUse(port);
            if (!use || !commitResourceUse(use)) throw new AifaUpdateError('Sessione non più valida', 401);
        };
        assertSession();
        await assertEmptyAifaRequestBody(request, controller.signal);
        assertSession();
        assertAifaNetworkAllowed();
        const confirmedReduction = request.headers.get('x-mediflow-aifa-confirm-reduction') ?? undefined;
        if (confirmedReduction && !/^[a-f0-9]{64}:[a-f0-9]{64}$/.test(confirmedReduction)) throw new AifaUpdateError('Conferma della riduzione AIFA non valida', 400);
        const snapshot = getAifaCatalogSnapshot();
        const local = await getAifaCatalogStatus();
        previousManifest = local.manifest;
        const audit = buildAuditWriteInputFromRequest(request, session, {
            eventType: 'reference_data.aifa.updated', subjectType: 'reference_data', subjectRef: 'aifa',
        });
        assertSession();
        const result = await withAifaDownload(controller.signal, async (file, acquisition, signal, assertDeadline) => {
            const current = await requireSession();
            if (!current || current.id !== session.id) throw new AifaUpdateError('Sessione non più valida', 401);
            return replaceAifaCatalog(file, acquisition, { snapshot, assertCurrent: () => {
                assertDeadline();
                signal.throwIfAborted();
                assertSession();
                assertAifaNetworkAllowed();
            } }, { audit, confirmedReduction });
        }, fetch, {
            validators: local.manifest?.sourceUrl === AIFA_DOWNLOAD_URL ? local.manifest : undefined,
            assertAllowed: assertAifaNetworkAllowed,
            notModified: assertDeadline => confirmAifaCatalogUnchanged(snapshot, () => { assertDeadline(); assertSession(); assertAifaNetworkAllowed(); }, audit),
        });
        return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        await recordAifaCatalogRejection(buildAuditWriteInputFromRequest(request, session, {
            eventType: 'reference_data.aifa.updated', outcome: error instanceof AifaUpdateError && error.status === 403 ? 'denied' : 'failure',
            subjectType: 'reference_data', subjectRef: 'aifa', redactedMetadata: { aifaCatalog: { mode: 'remote', before: previousManifest, after: previousManifest, forcedReduction: false }, flags: ['mode:remote'], reasonCode: error instanceof AifaReductionError ? 'reduction-confirmation-required' : 'update-rejected' },
        })).catch(() => undefined);
        return Response.json({ ...(error instanceof AifaReductionError ? { code: 'AIFA_REDUCTION_CONFIRMATION_REQUIRED', confirmation: error.confirmation,
            previousCount: error.previousCount, nextCount: error.nextCount } : {}), error: error instanceof AifaUpdateError ? error.message : 'Aggiornamento AIFA non riuscito; catalogo conservato' },
            { status: error instanceof AifaUpdateError ? error.status : 422 });
    } finally {
        clearTimeout(expiry);
        request.signal.removeEventListener('abort', cancel);
        if (registration) unregisterPrivateResource(port, registration);
        releaseResourcePort(port);
    }
}
