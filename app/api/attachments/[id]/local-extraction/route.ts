/* @Codex */
import { NextResponse } from 'next/server';
import { composeAnyDocCurrentSourceExtraction } from '@/lib/domain/documents/anydoc-current-source-composition';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';

function noStore(response: NextResponse): NextResponse {
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

function unavailableResponse(): NextResponse {
    return noStore(NextResponse.json({ error: 'Local extraction unavailable' }, { status: 409 }));
}

/** Converts only the authenticated session's current host-owned attachment source. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
    let session;
    try {
        session = await requireSession();
    } catch {
        return noStore(unauthorizedResponse());
    }
    if (!session) return noStore(unauthorizedResponse());

    try {
        const { id } = await params;
        const result = await composeAnyDocCurrentSourceExtraction(session, { attachmentId: id });
        return result.status === 'denied' ? unavailableResponse() : noStore(NextResponse.json(result));
    } catch {
        return unavailableResponse();
    }
}
