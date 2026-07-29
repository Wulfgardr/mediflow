/* @Codex */
import { NextResponse } from 'next/server';

import { mutateNetworkPairingState } from '@/lib/network-home-base-server';
import { removePairedClient } from '@/lib/network-pairing-model';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ clientId: string }> },
) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { clientId } = await params;

        // Tutte le mutazioni dello stato pairing passano dalla primitiva CAS
        // condivisa: una conferma concorrente non puo' resuscitare un client
        // appena revocato.
        const persisted = await mutateNetworkPairingState((state) => {
            const result = removePairedClient(state, clientId);
            return result.ok
                ? { write: true, nextState: result.nextState, result }
                : { write: false, result };
        });
        if (persisted.conflict) {
            return NextResponse.json(
                { error: 'Conflict', code: 'PAIRING_STATE_CONFLICT', message: 'Pairing state changed, retry.' },
                { status: 409 },
            );
        }

        return NextResponse.json(persisted.result.value, { status: persisted.result.status });
    } catch (error) {
        console.error('API DELETE /api/v1/network/pairing-clients/[clientId] error:', error);
        return NextResponse.json({ error: 'Failed to revoke paired client' }, { status: 500 });
    }
}
