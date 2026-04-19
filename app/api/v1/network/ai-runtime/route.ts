import { NextResponse } from 'next/server';
import { requireLocalApiToken } from '@/lib/local-api-auth';
/* @Codex */
import { getNetworkAiRuntimeSummary } from '@/lib/network-home-base-server';

/* @Codex */
export async function GET(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const summary = await getNetworkAiRuntimeSummary();
        return NextResponse.json(summary);
    } catch (error) {
        console.error('API GET /api/v1/network/ai-runtime error:', error);
        return NextResponse.json({ error: 'Failed to load network AI runtime summary' }, { status: 500 });
    }
}
