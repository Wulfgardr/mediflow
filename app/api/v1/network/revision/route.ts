/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import { getPublicAppRevisionSummary } from '@/lib/app-revision';
/* @Codex */
import { authenticateNetworkPairedClient } from '@/lib/network-home-base-server';
/* @Codex */
import { getNetworkModeGateResponse } from '@/lib/network-write-context';
/* @Codex */
import { unauthorizedResponse } from '@/lib/security/server-auth';

/* @Codex */
export const dynamic = 'force-dynamic';

/* @Codex */
export async function GET(request: Request) {
    const pairedClient = await authenticateNetworkPairedClient(request);
    if (!pairedClient) return unauthorizedResponse();

    const modeGateResponse = await getNetworkModeGateResponse();
    if (modeGateResponse) return modeGateResponse;

    return NextResponse.json(
        getPublicAppRevisionSummary(),
        {
            headers: {
                'Cache-Control': 'no-store',
            },
        },
    );
}
