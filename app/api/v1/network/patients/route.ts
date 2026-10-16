import { readPatientJsonObject } from '@/lib/patient-json-object';
import { jsonBodyTooLargeResponse } from '@/lib/native-network-json-body';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
    authenticateNetworkPairedClient,
    getNetworkIdentitySummary,
} from '@/lib/network-home-base-server';
import {
    createNetworkScopedPatient,
    NETWORK_PATIENT_LIFECYCLE_CAPABILITY,
} from '@/lib/network-patient-lifecycle';
import { listNetworkScopedPatients } from '@/lib/network-patient-read';
import { getNetworkModeGateResponse, requireNetworkCapabilityContext } from '@/lib/network-write-context';
import { forbiddenResponse, unauthorizedResponse } from '@/lib/security/server-auth';
import { requireAccountSession } from '@/lib/security/paired-native-session';

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
    const includeDiagnoses = new URL(request.url).searchParams.get('include') === 'diagnoses';
    if (includeDeleted && !pairedClient.grantedCapabilities.includes(NETWORK_PATIENT_LIFECYCLE_CAPABILITY)) {
        return forbiddenResponse();
    }

    const session = await requireAccountSession(request);
    if (!session) return unauthorizedResponse();

    try {
        const cookieStore = await cookies();
        const activeAmbulatoryId = cookieStore.get('ambulatory_id')?.value ?? null;
        const identity = await getNetworkIdentitySummary(session, activeAmbulatoryId);
        const scopeAmbulatoryId = identity.scope.effectiveAmbulatoryId;
        if (!scopeAmbulatoryId) {
            return NextResponse.json({ error: 'Network scope unavailable' }, { status: 403 });
        }

        const result = await listNetworkScopedPatients(scopeAmbulatoryId, { includeDeleted, includeDiagnoses });
        return NextResponse.json(result);
    } catch (error) {
        console.error('API GET /api/v1/network/patients error:', error);
        return NextResponse.json({ error: 'Failed to fetch patients' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const resolved = await requireNetworkCapabilityContext(request, NETWORK_PATIENT_LIFECYCLE_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const parsed = await readPatientJsonObject(request);
        if (!parsed.ok) return NextResponse.json({ error: parsed.error, ...('code' in parsed ? { code: parsed.code } : {}) }, { status: parsed.status });
        const body = parsed.body;
        const result = await createNetworkScopedPatient(resolved.context, body);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        const sizeError = jsonBodyTooLargeResponse(error);
        if (sizeError) return sizeError;
        console.error('API POST /api/v1/network/patients error:', error);
        return NextResponse.json({ error: 'Failed to create patient' }, { status: 500 });
    }
}
