import { archiveReplacementResponse } from '@/lib/api-error-response';
import { archiveGenerationForSession } from '@/lib/security/archive-session-generation';
import { NextResponse } from 'next/server';
import { entryRevisionCursor, readEntryRevisionPage } from '@/lib/entry-revision-read';
import { NETWORK_ENTRY_READ_CAPABILITY } from '@/lib/network-entry-read';
import { requireNetworkCapabilityContext } from '@/lib/network-write-context';
import { hasAttestedLoopbackIngress } from '@/lib/security/loopback-ingress.mjs';

export async function GET(request: Request, { params }: { params: Promise<{ id: string; entryId: string }> }) {
    if (!hasAttestedLoopbackIngress(request)) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const resolved = await requireNetworkCapabilityContext(request, NETWORK_ENTRY_READ_CAPABILITY);
    if (!resolved.ok) return resolved.response;
    const { session, scopeAmbulatoryId } = resolved.context;
    if (session.authChannel !== 'native') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const cursor = entryRevisionCursor(request);
    if (cursor === null) return NextResponse.json({ error: 'Invalid version cursor' }, { status: 400 });
    const { id, entryId } = await params;
    try {
        const page = readEntryRevisionPage(id, entryId, cursor, archiveGenerationForSession(session), scopeAmbulatoryId);
        return page ? NextResponse.json(page, { headers: { 'Cache-Control': 'no-store' } })
            : NextResponse.json({ error: 'Not found' }, { status: 404 });
    } catch (error) {
        return archiveReplacementResponse(error)
            ?? NextResponse.json({ error: 'Failed to read diary revisions' }, { status: 500 });
    }
}
