import { NextResponse } from 'next/server';
/* @Codex */
import { getNetworkCapabilities } from '@/lib/network-home-base-server';
/* @Codex */
import { requireNetworkDiscoveryAuth } from '@/lib/network-write-context';
/* @Codex */
import { projectNetworkCapabilitiesForDiscoveryAuth } from '@/lib/network-discovery-auth';

/* @Codex */
export async function GET(request: Request) {
    const auth = await requireNetworkDiscoveryAuth(request);
    if (!auth.ok) return auth.response;

    try {
        const capabilities = await getNetworkCapabilities();
        return NextResponse.json(projectNetworkCapabilitiesForDiscoveryAuth(capabilities, auth.context));
    } catch (error) {
        console.error('API GET /api/v1/network/capabilities error:', error);
        return NextResponse.json({ error: 'Failed to load network capabilities' }, { status: 500 });
    }
}
