/* @Codex */
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/security/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStore = Object.freeze({ 'cache-control': 'no-store' });

/** Retired legacy Smart Import apply boundary. */
export async function POST(
    _request: Request,
    _context: { params: Promise<{ id: string }> },
) {
    const session = await requireSession();
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore });
    }

    return NextResponse.json(
        {
            error: 'Smart Import legacy apply endpoint retired',
            code: 'SMART_IMPORT_LEGACY_APPLY_RETIRED',
        },
        { status: 410, headers: noStore },
    );
}
