import { archiveReplacementResponse } from '@/lib/api-error-response';
import { archiveGenerationForSession } from '@/lib/security/archive-session-generation';
import { NextResponse } from 'next/server';
import { entryRevisionCursor, readEntryRevisionPage } from '@/lib/entry-revision-read';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { hasAttestedLoopbackIngress } from '@/lib/security/loopback-ingress.mjs';

export async function GET(request: Request, { params }: { params: Promise<{ id: string; entryId: string }> }) {
    if (!hasAttestedLoopbackIngress(request)) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    const cursor = entryRevisionCursor(request);
    if (cursor === null) return NextResponse.json({ error: 'Invalid version cursor' }, { status: 400 });
    const { id, entryId } = await params;
    try {
        const page = readEntryRevisionPage(id, entryId, cursor, archiveGenerationForSession(session));
        return page ? NextResponse.json(page, { headers: { 'Cache-Control': 'no-store' } })
            : NextResponse.json({ error: 'Not found' }, { status: 404 });
    } catch (error) {
        return archiveReplacementResponse(error)
            ?? NextResponse.json({ error: 'Failed to read diary revisions' }, { status: 500 });
    }
}
