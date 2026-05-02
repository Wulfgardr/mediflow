/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import {
    NETWORK_OBSERVATION_READ_CAPABILITY,
    getNetworkScopedObservation,
} from '@/lib/network-observation-read';
/* @Codex */
import {
    NETWORK_OBSERVATION_WRITE_CAPABILITY,
    updateNetworkScopedObservation,
} from '@/lib/network-observation-write';
/* @Codex */
import { requireNetworkCapabilityContext, requireNetworkWriteContext } from '@/lib/network-write-context';

/* @Codex */
export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string; observationId: string }> }
) {
    try {
        const { id, observationId } = await params;
        const resolved = await requireNetworkCapabilityContext(request, NETWORK_OBSERVATION_READ_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const observation = await getNetworkScopedObservation(id, observationId, resolved.context.scopeAmbulatoryId);
        if (!observation) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        return NextResponse.json(observation);
    } catch (error) {
        console.error('API GET /api/v1/network/patients/[id]/observations/[observationId] error:', error);
        return NextResponse.json({ error: 'Failed to fetch observation' }, { status: 500 });
    }
}

/* @Codex */
export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string; observationId: string }> }
) {
    try {
        const { id, observationId } = await params;
        const resolved = await requireNetworkWriteContext(request, NETWORK_OBSERVATION_WRITE_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const body = await request.json() as Record<string, unknown>;
        const result = await updateNetworkScopedObservation(
            { ...resolved.context, patientId: id, observationId },
            body,
        );
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API PUT /api/v1/network/patients/[id]/observations/[observationId] error:', error);
        return NextResponse.json({ error: 'Failed to update observation' }, { status: 500 });
    }
}
