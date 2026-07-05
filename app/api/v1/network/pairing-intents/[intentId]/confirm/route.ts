/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import { requireLocalApiToken } from '@/lib/security/local-api-auth';
/* @Codex */
import { confirmNetworkPairingIntent } from '@/lib/network-home-base-server';

/* @Codex */
export async function POST(request: Request, { params }: { params: Promise<{ intentId: string }> }) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { intentId } = await params;
        const result = await confirmNetworkPairingIntent(intentId);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API POST /api/v1/network/pairing-intents/[intentId]/confirm error:', error);
        return NextResponse.json({ error: 'Failed to confirm pairing intent' }, { status: 500 });
    }
}
