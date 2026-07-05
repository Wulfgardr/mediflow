import { NextResponse } from 'next/server';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';
/* @Codex */
import { requireSession } from '@/lib/security/server-auth';
/* @Codex */
import { getNetworkIdentitySummary } from '@/lib/network-home-base-server';

/* @Codex */
export async function GET(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const session = await requireSession();
        const summary = await getNetworkIdentitySummary(session, null);
        return NextResponse.json(summary);
    } catch (error) {
        console.error('API GET /api/v1/network/identity error:', error);
        return NextResponse.json({ error: 'Failed to load network identity summary' }, { status: 500 });
    }
}
