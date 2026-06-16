/* @Codex */
import { NextResponse, type NextRequest } from 'next/server';

import { loadClinicalAgendaCandidates } from '@/lib/clinical-agenda-bridge';
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseBoundedInt(value: string | null, fallback: number, min: number, max: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(parsed, max));
}

export async function GET(request: NextRequest) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    const params = request.nextUrl.searchParams;
    const result = await loadClinicalAgendaCandidates({
        futureDays: parseBoundedInt(params.get('days'), 30, 1, 180),
        pastDays: parseBoundedInt(params.get('pastDays'), 1, 0, 30),
        limit: parseBoundedInt(params.get('limit'), 8, 1, 50),
    });

    return NextResponse.json(result, {
        headers: {
            'Cache-Control': 'no-store',
        },
    });
}
