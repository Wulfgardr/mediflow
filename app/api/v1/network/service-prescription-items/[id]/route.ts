/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import {
    NETWORK_SERVICE_PRESCRIPTION_WRITE_CAPABILITY,
    updateNetworkScopedServicePrescriptionItem,
} from '@/lib/service-prescription-write';
/* @Codex */
import { requireNetworkWriteContext } from '@/lib/network-write-context';

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: RouteContext) {
    try {
        const { id } = await context.params;
        const resolved = await requireNetworkWriteContext(request, NETWORK_SERVICE_PRESCRIPTION_WRITE_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const body = await request.json() as Record<string, unknown>;
        const result = await updateNetworkScopedServicePrescriptionItem({ ...resolved.context, itemId: id }, body);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API PUT /api/v1/network/service-prescription-items/[id] error:', error);
        return NextResponse.json({ error: 'Failed to update service prescription item' }, { status: 500 });
    }
}
