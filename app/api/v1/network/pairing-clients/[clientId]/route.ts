/* @Codex */
import { NextResponse } from 'next/server';

import { dbServer } from '@/lib/db-server';
import { loadNetworkPairingState } from '@/lib/network-home-base-server';
import {
    NETWORK_PAIRING_STATE_KEY,
    removePairedClient,
    serializeNetworkPairingState,
} from '@/lib/network-pairing-model';
import { settings } from '@/lib/schema';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ clientId: string }> },
) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { clientId } = await params;
        const pairingState = await loadNetworkPairingState();
        const result = removePairedClient(pairingState, clientId);
        if (!result.ok) {
            return NextResponse.json(result.value, { status: result.status });
        }

        await dbServer
            .insert(settings)
            .values({
                key: NETWORK_PAIRING_STATE_KEY,
                value: serializeNetworkPairingState(result.nextState),
            })
            .onConflictDoUpdate({
                target: settings.key,
                set: { value: serializeNetworkPairingState(result.nextState) },
            });

        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API DELETE /api/v1/network/pairing-clients/[clientId] error:', error);
        return NextResponse.json({ error: 'Failed to revoke paired client' }, { status: 500 });
    }
}
