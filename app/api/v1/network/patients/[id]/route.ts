import { jsonBodyTooLargeResponse } from '@/lib/native-network-json-body';
import { readPatientJsonObject } from '@/lib/patient-json-object';
import { NextResponse } from 'next/server';
import {
    authenticateNetworkPairedClient,
} from '@/lib/network-home-base-server';
import { getNetworkScopedPatientDetail } from '@/lib/network-patient-read';
import {
    deleteNetworkScopedPatient,
    NETWORK_PATIENT_LIFECYCLE_CAPABILITY,
} from '@/lib/network-patient-lifecycle';
import {
    NETWORK_PATIENT_WRITE_CAPABILITY,
    updateNetworkScopedPatient,
} from '@/lib/network-patient-write';
import { getNetworkModeGateResponse, requireNetworkCapabilityContext, resolveNetworkScope } from '@/lib/network-write-context';
import { forbiddenResponse, unauthorizedResponse } from '@/lib/security/server-auth';
import { requireAccountSession } from '@/lib/security/paired-native-session';

async function requireNetworkPatientWriteContext(
    request: Request,
    patientId: string
): Promise<
    | { ok: true; context: Parameters<typeof updateNetworkScopedPatient>[0] }
    | { ok: false; response: NextResponse }
> {
    const pairedClient = await authenticateNetworkPairedClient(request);
    if (!pairedClient) return { ok: false, response: unauthorizedResponse() };

    // WUL-307: paired-client tokens are inert while home-base mode is off.
    const modeGateResponse = await getNetworkModeGateResponse();
    if (modeGateResponse) return { ok: false, response: modeGateResponse };

    if (!pairedClient.grantedCapabilities.includes(NETWORK_PATIENT_WRITE_CAPABILITY)) {
        return { ok: false, response: forbiddenResponse() };
    }

    const session = await requireAccountSession(request);
    if (!session) return { ok: false, response: unauthorizedResponse() };

    const scopeAmbulatoryId = await resolveNetworkScope(session, request);
    if (!scopeAmbulatoryId) {
        return {
            ok: false,
            response: NextResponse.json({ error: 'Network scope unavailable' }, { status: 403 }),
        };
    }

    return {
        ok: true,
        context: {
            request,
            patientId,
            scopeAmbulatoryId,
            pairedClient,
            session,
        },
    };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const resolved = await getNetworkScopedPatientDetail(request, async () => (await params).id);
        if (!resolved.ok) return resolved.response;
        if (!resolved.profile) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        return NextResponse.json(resolved.profile);
    } catch (error) {
        console.error('API GET /api/v1/network/patients/[id] error:', error);
        return NextResponse.json({ error: 'Failed to fetch patient' }, { status: 500 });
    }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const resolved = await requireNetworkPatientWriteContext(request, id);
        if (!resolved.ok) return resolved.response;

        const parsed = await readPatientJsonObject(request);
        if (!parsed.ok) return NextResponse.json({ error: parsed.error, ...('code' in parsed ? { code: parsed.code } : {}) }, { status: parsed.status });
        const body = parsed.body;
        const result = await updateNetworkScopedPatient(resolved.context, body);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        const sizeError = jsonBodyTooLargeResponse(error);
        if (sizeError) return sizeError;
        console.error('API PUT /api/v1/network/patients/[id] error:', error);
        return NextResponse.json({ error: 'Failed to update patient' }, { status: 500 });
    }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const resolved = await requireNetworkCapabilityContext(request, NETWORK_PATIENT_LIFECYCLE_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const parsed = await readPatientJsonObject(request);
        if (!parsed.ok) return NextResponse.json({ error: parsed.error, ...('code' in parsed ? { code: parsed.code } : {}) }, { status: parsed.status });
        const body = parsed.body;
        const result = await deleteNetworkScopedPatient(
            {
                ...resolved.context,
                patientId: id,
            },
            body,
        );
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        const sizeError = jsonBodyTooLargeResponse(error);
        if (sizeError) return sizeError;
        console.error('API DELETE /api/v1/network/patients/[id] error:', error);
        return NextResponse.json({ error: 'Failed to delete patient' }, { status: 500 });
    }
}
