/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import {
    NETWORK_CHECKUP_READ_CAPABILITY,
    getNetworkScopedCheckup,
} from '@/lib/network-checkup-read';
/* @Codex */
import {
    NETWORK_CHECKUP_WRITE_CAPABILITY,
    updateNetworkScopedCheckup,
} from '@/lib/network-checkup-write';
/* @Codex */
import { requireNetworkCapabilityContext, requireNetworkWriteContext } from '@/lib/network-write-context';

/* @Codex */
export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string; checkupId: string }> }
) {
    try {
        const { id, checkupId } = await params;
        const resolved = await requireNetworkCapabilityContext(request, NETWORK_CHECKUP_READ_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const checkup = await getNetworkScopedCheckup(id, checkupId, resolved.context.scopeAmbulatoryId);
        if (!checkup) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        return NextResponse.json(checkup);
    } catch (error) {
        console.error('API GET /api/v1/network/patients/[id]/checkups/[checkupId] error:', error);
        return NextResponse.json({ error: 'Failed to fetch checkup' }, { status: 500 });
    }
}

/* @Codex */
export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string; checkupId: string }> }
) {
    try {
        const { id, checkupId } = await params;
        const resolved = await requireNetworkWriteContext(request, NETWORK_CHECKUP_WRITE_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const body = await request.json() as Record<string, unknown>;
        const result = await updateNetworkScopedCheckup(
            { ...resolved.context, patientId: id, checkupId },
            body,
        );
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API PUT /api/v1/network/patients/[id]/checkups/[checkupId] error:', error);
        return NextResponse.json({ error: 'Failed to update checkup' }, { status: 500 });
    }
}
