import { NextResponse } from 'next/server';
/* @Codex */
import { requireSession } from '@/lib/security/server-auth';

export const runtime = 'nodejs';

/** Retired legacy PDF extraction boundary. */
export async function POST() {
    /* @Codex */
    const session = await requireSession();
    if (!session) {
        return NextResponse.json({
            error: 'Unauthorized',
        }, { status: 401, headers: { 'cache-control': 'no-store' } });
    }

    return NextResponse.json({
        error: 'PDF extraction endpoint retired',
        code: 'PDF_EXTRACTION_RETIRED',
    }, { status: 410, headers: { 'cache-control': 'no-store' } });
}
