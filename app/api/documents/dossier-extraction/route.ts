import { extractDossierSource } from '@/lib/domain/documents/dossier-extraction-host';
import { isLocalAttachmentExtractionRequest } from '@/lib/domain/documents/attachment-extraction-projection-transport';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';

export const runtime = 'nodejs';

const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

/** Read-only local extraction for the dossier import (ADR 0175): no attachment, no write, no audit row. */
export async function POST(request: Request): Promise<Response> {
    let session;
    try { session = await requireSession(); } catch { return unauthorizedResponse(); }
    if (!session) return unauthorizedResponse();
    if (session.authChannel !== 'web' || new URL(request.url).search || !isLocalAttachmentExtractionRequest(request)) {
        return reply({ status: 'denied' }, 403);
    }
    try {
        const outcome = await extractDossierSource(request);
        if (outcome.status === 'busy') return reply({ status: 'busy' }, 503);
        if (outcome.status === 'unreadable') return reply({ status: 'denied' }, 400);
        return reply(outcome);
    } catch {
        return reply({ status: 'failed', detail: 'unavailable' });
    }
}
