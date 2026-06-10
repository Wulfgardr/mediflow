/* @Codex */
import { cookies } from 'next/headers';
/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import {
    authenticateNetworkPairedClient,
    getNetworkIdentitySummary,
} from '@/lib/network-home-base-server';
/* @Codex */
import { listNetworkScopedPatients } from '@/lib/network-patient-read';
import { getNetworkModeGateResponse } from '@/lib/network-write-context';
/* @Codex */
import { forbiddenResponse, requireSession, unauthorizedResponse } from '@/lib/server-auth';

/* @Codex */
export async function GET(request: Request) {
    const pairedClient = await authenticateNetworkPairedClient(request);
    if (!pairedClient) return unauthorizedResponse();

    // WUL-307: paired-client tokens are inert while home-base mode is off.
    const modeGateResponse = await getNetworkModeGateResponse();
    if (modeGateResponse) return modeGateResponse;

    if (!pairedClient.grantedCapabilities.includes('network.replica.readonly-patients')) {
        return forbiddenResponse();
    }

    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const cookieStore = await cookies();
        const activeAmbulatoryId = cookieStore.get('ambulatory_id')?.value ?? null;
        const identity = await getNetworkIdentitySummary(session, activeAmbulatoryId);
        const scopeAmbulatoryId = identity.scope.effectiveAmbulatoryId;
        if (!scopeAmbulatoryId) {
            return NextResponse.json({ error: 'Network scope unavailable' }, { status: 403 });
        }

        const result = await listNetworkScopedPatients(scopeAmbulatoryId);
        return NextResponse.json(result);
    } catch (error) {
        console.error('API GET /api/v1/network/patients error:', error);
        return NextResponse.json({ error: 'Failed to fetch patients' }, { status: 500 });
    }
}
