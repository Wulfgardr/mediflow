import { NextResponse } from 'next/server';
/* @Codex */
import { getNetworkNodeSummary } from '@/lib/network-home-base-server';
/* @Codex */
import { requireNetworkDiscoveryAuth } from '@/lib/network-write-context';

/* @Codex */
export async function GET(request: Request) {
    const auth = await requireNetworkDiscoveryAuth(request);
    if (!auth.ok) return auth.response;

    try {
        const summary = await getNetworkNodeSummary();
        return NextResponse.json(summary);
    } catch (error) {
        console.error('API GET /api/v1/network/node error:', error);
        return NextResponse.json({ error: 'Failed to load network node summary' }, { status: 500 });
    }
}
