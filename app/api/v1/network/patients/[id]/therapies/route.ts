/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import {
    NETWORK_THERAPY_READ_CAPABILITY,
    listNetworkScopedTherapies,
} from '@/lib/network-therapy-read';
/* @Codex */
import {
    NETWORK_THERAPY_WRITE_CAPABILITY,
    createNetworkScopedTherapy,
} from '@/lib/network-therapy-write';
/* @Codex */
import { requireNetworkCapabilityContext, requireNetworkWriteContext } from '@/lib/network-write-context';

function parseLimit(value: string | null): number | null {
    if (!value) return null;
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) return null;
    return Math.min(parsed, 100);
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
        const resolved = await requireNetworkCapabilityContext(request, NETWORK_THERAPY_READ_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const { searchParams } = new URL(request.url);
        const therapies = await listNetworkScopedTherapies(id, resolved.context.scopeAmbulatoryId, {
            limit: parseLimit(searchParams.get('limit')),
            status: searchParams.get('status')?.trim() || null,
            dateFrom: parseDateParam(searchParams.get('dateFrom')),
            dateTo: parseDateParam(searchParams.get('dateTo')),
        });

        return NextResponse.json(therapies);
    } catch (error) {
        console.error('API GET /api/v1/network/patients/[id]/therapies error:', error);
        return NextResponse.json({ error: 'Failed to fetch therapies' }, { status: 500 });
    }
}

/* @Codex */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const resolved = await requireNetworkWriteContext(request, NETWORK_THERAPY_WRITE_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const body = await request.json() as Record<string, unknown>;
        const result = await createNetworkScopedTherapy(
            { ...resolved.context, patientId: id },
            body,
        );
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API POST /api/v1/network/patients/[id]/therapies error:', error);
        return NextResponse.json({ error: 'Failed to create therapy' }, { status: 500 });
    }
}
