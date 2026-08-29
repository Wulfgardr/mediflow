/* @Codex */
import { NextResponse } from 'next/server';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';

const RETIRED_RESPONSE = Object.freeze({
    error: 'OCR replay endpoint retired',
    code: 'OCR_REPLAY_RETIRED',
});

/** AnyDoc is the sole automated local extraction lane; legacy OCR replay is retired. */
export async function POST() {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    const response = NextResponse.json(RETIRED_RESPONSE, { status: 410 });
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
