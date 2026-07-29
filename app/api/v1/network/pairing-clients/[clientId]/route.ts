/* @Codex */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { dbServer } from '@/lib/db-server';
import {
    NETWORK_PAIRING_STATE_KEY,
    parseNetworkPairingState,
    removePairedClient,
    serializeNetworkPairingState,
} from '@/lib/network-pairing-model';
import { settings } from '@/lib/schema';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';

const REVOKE_CAS_ATTEMPTS = 3;

function conflictResponse() {
    return NextResponse.json(
        { error: 'Conflict', code: 'PAIRING_STATE_CONFLICT', message: 'Pairing state changed, retry.' },
        { status: 409 },
    );
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ clientId: string }> },
) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { clientId } = await params;

        // Compare-and-swap sul valore serializzato (pattern di
        // pin-change-service): due revoche concorrenti non possono
        // sovrascriversi a vicenda; la perdente rilegge e riprova.
        for (let attempt = 0; attempt < REVOKE_CAS_ATTEMPTS; attempt += 1) {
            const row = await dbServer
                .select({ value: settings.value })
                .from(settings)
                .where(eq(settings.key, NETWORK_PAIRING_STATE_KEY))
                .get();
            const rawState = row?.value ?? null;
            const pairingState = parseNetworkPairingState(rawState);
            const result = removePairedClient(pairingState, clientId);
            if (!result.ok) {
                return NextResponse.json(result.value, { status: result.status });
            }
            if (rawState === null) {
                // Client trovato senza riga persistita: stato incoerente,
                // impossibile per costruzione (parse di null e' vuoto);
                // fail-closed senza scrivere.
                return conflictResponse();
            }

            const updateResult = dbServer
                .update(settings)
                .set({ value: serializeNetworkPairingState(result.nextState) })
                .where(and(
                    eq(settings.key, NETWORK_PAIRING_STATE_KEY),
                    eq(settings.value, rawState),
                ))
                .run();
            if (updateResult.changes === 1) {
                return NextResponse.json(result.value, { status: result.status });
            }
        }

        return conflictResponse();
    } catch (error) {
        console.error('API DELETE /api/v1/network/pairing-clients/[clientId] error:', error);
        return NextResponse.json({ error: 'Failed to revoke paired client' }, { status: 500 });
    }
}
