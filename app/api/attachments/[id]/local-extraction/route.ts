/* @Codex */
import { NextResponse } from 'next/server';
import { composeAnyDocCurrentSourceExtraction, composeAnyDocClientProjectionExtraction } from '@/lib/domain/documents/anydoc-current-source-composition';
import { acquireAttachmentExtractionProjection, cancelAttachmentExtractionProjection } from '@/lib/domain/documents/attachment-extraction-projection-broker';
import { isLocalAttachmentExtractionRequest, hasEmptyAttachmentExtractionBody } from '@/lib/domain/documents/attachment-extraction-projection-transport';
import { ATTACHMENT_EXTRACTION_ACTION_HEADER, ATTACHMENT_EXTRACTION_GRANT_HEADER } from '@/lib/domain/documents/attachment-extraction-projection-protocol';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';

function noStore<T extends Response>(response: T): T {
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
function unavailableResponse(): NextResponse {
    return noStore(NextResponse.json({ error: 'Local extraction unavailable' }, { status: 409 }));
}
type Context = { params: Promise<{ id: string }> };

/** Legacy empty POST stays host-readable only. The ordinary UI uses authenticated client decryption. */
export async function POST(request: Request, { params }: Context): Promise<Response> {
    let session;
    try { session = await requireSession(); } catch { return noStore(unauthorizedResponse()); }
    if (!session) return noStore(unauthorizedResponse());
    try {
        const { id } = await params;
        if (request.signal.aborted) return unavailableResponse();
        const action = request.headers.get(ATTACHMENT_EXTRACTION_ACTION_HEADER);
        const grantId = request.headers.get(ATTACHMENT_EXTRACTION_GRANT_HEADER);
        if (action === null) {
            if (grantId !== null || !await hasEmptyAttachmentExtractionBody(request)) return unavailableResponse();
            const result = await composeAnyDocCurrentSourceExtraction(session, { attachmentId: id });
            return result.status === 'denied' ? unavailableResponse() : noStore(NextResponse.json(result));
        }
        if (!isLocalAttachmentExtractionRequest(request)) return unavailableResponse();
        if (action === 'acquire' && grantId === null && await hasEmptyAttachmentExtractionBody(request)) {
            const grant = acquireAttachmentExtractionProjection(session, id);
            return grant ? noStore(NextResponse.json(grant)) : unavailableResponse();
        }
        if (action === 'project' && grantId !== null)
            return composeAnyDocClientProjectionExtraction(session, { attachmentId: id }, grantId, request);
        return unavailableResponse();
    } catch { return unavailableResponse(); }
}

/** Best-effort browser cancellation is backed by synchronous owner revocation and server deadlines. */
export async function DELETE(request: Request, { params }: Context): Promise<Response> {
    let session;
    try { session = await requireSession(); } catch { return noStore(unauthorizedResponse()); }
    if (!session) return noStore(unauthorizedResponse());
    try {
        const { id } = await params;
        if (request.signal.aborted || !isLocalAttachmentExtractionRequest(request) || !await hasEmptyAttachmentExtractionBody(request)) return unavailableResponse();
        cancelAttachmentExtractionProjection(session, id, request.headers.get(ATTACHMENT_EXTRACTION_GRANT_HEADER));
        return noStore(new NextResponse(null, { status: 204 }));
    } catch { return unavailableResponse(); }
}
