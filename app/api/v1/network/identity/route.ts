import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { unauthorizedResponse } from '@/lib/security/server-auth';
import { requireAccountSession } from '@/lib/security/paired-native-session';
import { getNetworkIdentitySummary } from '@/lib/network-home-base-server';
import { requireNetworkDiscoveryAuth } from '@/lib/network-write-context';

export async function GET(request: Request) {
    const auth = await requireNetworkDiscoveryAuth(request);
    if (!auth.ok) return auth.response;

    try {
        const session = await requireAccountSession(request);
        if (auth.context.authMode === 'paired-client' && !session) {
            return unauthorizedResponse();
        }

        const activeAmbulatoryId = auth.context.authMode === 'paired-client'
            ? (await cookies()).get('ambulatory_id')?.value ?? null
            : null;
        const summary = await getNetworkIdentitySummary(session, activeAmbulatoryId);
        return NextResponse.json(summary);
    } catch (error) {
        console.error('API GET /api/v1/network/identity error:', error);
        return NextResponse.json({ error: 'Failed to load network identity summary' }, { status: 500 });
    }
}
