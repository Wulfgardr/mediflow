import { archiveReplacementResponse } from '@/lib/api-error-response';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
/* @Codex WUL-421 */
import { NextResponse } from 'next/server';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import {
    createVisitDraft,
    type VisitDraftRouteBody,
} from '@/lib/visit-draft-service';

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;

    try {
        const result = await createVisitDraft(await request.json() as VisitDraftRouteBody);
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
        return NextResponse.json(result.value);
    } catch (archiveError) {
        const replacement = archiveReplacementResponse(archiveError);
        if (replacement) return replacement;
        return NextResponse.json({ error: 'Visit transcript draft failed' }, { status: 500 });
    }
}
