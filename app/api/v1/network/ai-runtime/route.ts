import { NextResponse } from 'next/server';
/* @Codex */
import { getNetworkAiRuntimeSummary } from '@/lib/network-home-base-server';
/* @Codex */
import { requireNetworkDiscoveryAuth } from '@/lib/network-write-context';

/* @Codex */
export async function GET(request: Request) {
    const auth = await requireNetworkDiscoveryAuth(request);
    if (!auth.ok) return auth.response;

    try {
        const summary = await getNetworkAiRuntimeSummary();
        return NextResponse.json(summary);
    } catch (error) {
        console.error('API GET /api/v1/network/ai-runtime error:', error);
        return NextResponse.json({ error: 'Failed to load network AI runtime summary' }, { status: 500 });
    }
}
