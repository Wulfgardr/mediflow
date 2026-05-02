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
import {
    NETWORK_PATIENT_WRITE_CAPABILITY,
    updateNetworkScopedPatient,
} from '@/lib/network-patient-write';
/* @Codex */
import { forbiddenResponse, requireSession, unauthorizedResponse } from '@/lib/server-auth';

/* @Codex */
async function resolveNetworkScope(session: Awaited<ReturnType<typeof requireSession>>) {
    const cookieStore = await cookies();
    const activeAmbulatoryId = cookieStore.get('ambulatory_id')?.value ?? null;
    const identity = await getNetworkIdentitySummary(session, activeAmbulatoryId);
    return identity.scope.effectiveAmbulatoryId;
}

/* @Codex */
async function requireNetworkPatientWriteContext(
    request: Request,
    patientId: string
): Promise<
    | { ok: true; context: Parameters<typeof updateNetworkScopedPatient>[0] }
    | { ok: false; response: NextResponse }
> {
    const pairedClient = await authenticateNetworkPairedClient(request);
    if (!pairedClient) return { ok: false, response: unauthorizedResponse() };
    if (!pairedClient.grantedCapabilities.includes(NETWORK_PATIENT_WRITE_CAPABILITY)) {
        return { ok: false, response: forbiddenResponse() };
    }

    const session = await requireSession();
    if (!session) return { ok: false, response: unauthorizedResponse() };

    const scopeAmbulatoryId = await resolveNetworkScope(session);
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
        const scopeAmbulatoryId = await resolveNetworkScope(session);
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

/* @Codex */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const resolved = await requireNetworkPatientWriteContext(request, id);
        if (!resolved.ok) return resolved.response;

        const body = await request.json() as Record<string, unknown>;
        const result = await updateNetworkScopedPatient(resolved.context, body);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API PUT /api/v1/network/patients/[id] error:', error);
        return NextResponse.json({ error: 'Failed to update patient' }, { status: 500 });
    }
}
