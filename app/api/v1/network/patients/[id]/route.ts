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
import { getNetworkScopedPatientDetail } from '@/lib/network-patient-read';
/* @Codex */
import { forbiddenResponse, requireSession, unauthorizedResponse } from '@/lib/server-auth';

/* @Codex */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const pairedClient = await authenticateNetworkPairedClient(request);
    if (!pairedClient) return unauthorizedResponse();
    if (!pairedClient.grantedCapabilities.includes('network.replica.readonly-patients')) {
        return forbiddenResponse();
    }

    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await params;
        const cookieStore = await cookies();
        const activeAmbulatoryId = cookieStore.get('ambulatory_id')?.value ?? null;
        const identity = await getNetworkIdentitySummary(session, activeAmbulatoryId);
        const scopeAmbulatoryId = identity.scope.effectiveAmbulatoryId;
        if (!scopeAmbulatoryId) {
            return NextResponse.json({ error: 'Network scope unavailable' }, { status: 403 });
        }

        const patient = await getNetworkScopedPatientDetail(id, scopeAmbulatoryId);
        if (!patient) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        return NextResponse.json(patient);
    } catch (error) {
        console.error('API GET /api/v1/network/patients/[id] error:', error);
        return NextResponse.json({ error: 'Failed to fetch patient' }, { status: 500 });
    }
}
