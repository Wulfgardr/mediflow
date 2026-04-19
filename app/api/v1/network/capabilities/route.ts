import { NextResponse } from 'next/server';
import { requireLocalApiToken } from '@/lib/local-api-auth';
/* @Codex */
import { getNetworkCapabilities } from '@/lib/network-home-base-server';

/* @Codex */
export async function GET(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const capabilities = await getNetworkCapabilities();
        return NextResponse.json(capabilities);
    } catch (error) {
        console.error('API GET /api/v1/network/capabilities error:', error);
        return NextResponse.json({ error: 'Failed to load network capabilities' }, { status: 500 });
    }
}
