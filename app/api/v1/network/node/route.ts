import { NextResponse } from 'next/server';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';
/* @Codex */
import { getNetworkNodeSummary } from '@/lib/network-home-base-server';

/* @Codex */
export async function GET(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const summary = await getNetworkNodeSummary();
        return NextResponse.json(summary);
    } catch (error) {
        console.error('API GET /api/v1/network/node error:', error);
        return NextResponse.json({ error: 'Failed to load network node summary' }, { status: 500 });
    }
}
