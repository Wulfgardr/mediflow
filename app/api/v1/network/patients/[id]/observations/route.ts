/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import {
    NETWORK_OBSERVATION_READ_CAPABILITY,
    listNetworkScopedObservations,
} from '@/lib/network-observation-read';
/* @Codex */
import {
    NETWORK_OBSERVATION_WRITE_CAPABILITY,
    createNetworkScopedObservation,
} from '@/lib/network-observation-write';
/* @Codex */
import { requireNetworkCapabilityContext, requireNetworkWriteContext } from '@/lib/network-write-context';

function parseLimit(value: string | null): number | null {
    if (!value) return null;
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) return null;
    return Math.min(parsed, 200);
}

function parseDateParam(value: string | null): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/* @Codex */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const resolved = await requireNetworkCapabilityContext(request, NETWORK_OBSERVATION_READ_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const { searchParams } = new URL(request.url);
        const observations = await listNetworkScopedObservations(id, resolved.context.scopeAmbulatoryId, {
            limit: parseLimit(searchParams.get('limit')),
            code: searchParams.get('code')?.trim() || null,
            dateFrom: parseDateParam(searchParams.get('dateFrom')),
            dateTo: parseDateParam(searchParams.get('dateTo')),
        });

        return NextResponse.json(observations);
    } catch (error) {
        console.error('API GET /api/v1/network/patients/[id]/observations error:', error);
        return NextResponse.json({ error: 'Failed to fetch observations' }, { status: 500 });
    }
}

/* @Codex */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const resolved = await requireNetworkWriteContext(request, NETWORK_OBSERVATION_WRITE_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const body = await request.json() as Record<string, unknown>;
        const result = await createNetworkScopedObservation(
            { ...resolved.context, patientId: id },
            body,
        );
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API POST /api/v1/network/patients/[id]/observations error:', error);
        return NextResponse.json({ error: 'Failed to create observation' }, { status: 500 });
    }
}
