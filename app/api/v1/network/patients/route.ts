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
import {
    createNetworkScopedPatient,
    NETWORK_PATIENT_LIFECYCLE_CAPABILITY,
} from '@/lib/network-patient-lifecycle';
/* @Codex */
import { listNetworkScopedPatients } from '@/lib/network-patient-read';
import { getNetworkModeGateResponse, requireNetworkCapabilityContext } from '@/lib/network-write-context';
/* @Codex */
import { forbiddenResponse, requireSession, unauthorizedResponse } from '@/lib/security/server-auth';

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

    const includeDeleted = new URL(request.url).searchParams.get('includeDeleted') === 'true';
    if (includeDeleted && !pairedClient.grantedCapabilities.includes(NETWORK_PATIENT_LIFECYCLE_CAPABILITY)) {
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

        const result = await listNetworkScopedPatients(scopeAmbulatoryId, { includeDeleted });
        return NextResponse.json(result);
    } catch (error) {
        console.error('API GET /api/v1/network/patients error:', error);
        return NextResponse.json({ error: 'Failed to fetch patients' }, { status: 500 });
    }
}

/* @Codex */
export async function POST(request: Request) {
    try {
        const resolved = await requireNetworkCapabilityContext(request, NETWORK_PATIENT_LIFECYCLE_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const body = await request.json() as Record<string, unknown>;
        const result = await createNetworkScopedPatient(resolved.context, body);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API POST /api/v1/network/patients error:', error);
        return NextResponse.json({ error: 'Failed to create patient' }, { status: 500 });
    }
}
