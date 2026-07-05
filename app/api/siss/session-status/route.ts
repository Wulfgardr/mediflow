/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
/* @Codex */
import { readSissSessionStatusFromAtlasHistory } from '@/lib/siss-session-observer';

/* @Codex */
export async function GET() {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const status = readSissSessionStatusFromAtlasHistory();
        return NextResponse.json(status);
    } catch (error) {
        console.error('API GET /api/siss/session-status error:', error);
        return NextResponse.json({ error: 'Failed to inspect local SISS session state' }, { status: 500 });
    }
}
