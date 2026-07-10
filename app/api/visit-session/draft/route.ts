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

    try {
        const result = await createVisitDraft(await request.json() as VisitDraftRouteBody);
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
        return NextResponse.json(result.value);
    } catch {
        return NextResponse.json({ error: 'Visit transcript draft failed' }, { status: 500 });
    }
}
