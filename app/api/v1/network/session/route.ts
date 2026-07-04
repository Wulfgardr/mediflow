import { NextResponse } from 'next/server';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';
/* @Codex */
import { getNetworkSessionSummary } from '@/lib/network-home-base-server';

/* @Codex */
export async function GET(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const summary = await getNetworkSessionSummary();
        return NextResponse.json(summary);
    } catch (error) {
        console.error('API GET /api/v1/network/session error:', error);
        return NextResponse.json({ error: 'Failed to load network session summary' }, { status: 500 });
    }
}
