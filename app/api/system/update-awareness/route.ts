/* @Codex */
import { NextResponse } from 'next/server';
import { getAppBranch, getAppRevision } from '@/lib/app-revision';
import { readUpdateAwarenessPayload } from '@/lib/update-awareness';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    return NextResponse.json({
        ...readUpdateAwarenessPayload(),
        branch: getAppBranch(),
        revision: getAppRevision(),
    }, { headers: { 'Cache-Control': 'no-store, must-revalidate' } });
}
