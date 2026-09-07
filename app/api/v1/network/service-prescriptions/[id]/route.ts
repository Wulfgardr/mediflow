/* @Codex */
import { readNativeNetworkJson, jsonBodyTooLargeResponse } from '@/lib/native-network-json-body';
/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import {
    NETWORK_SERVICE_PRESCRIPTION_WRITE_CAPABILITY,
    updateNetworkScopedServicePrescription,
} from '@/lib/service-prescription-write';
/* @Codex */
import { requireNetworkWriteContext } from '@/lib/network-write-context';

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: RouteContext) {
    try {
        const { id } = await context.params;
        const resolved = await requireNetworkWriteContext(request, NETWORK_SERVICE_PRESCRIPTION_WRITE_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const body = await readNativeNetworkJson(request) as Record<string, unknown>;
        const result = await updateNetworkScopedServicePrescription({ ...resolved.context, prescriptionId: id }, body);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        /* @Codex */
        const sizeError = jsonBodyTooLargeResponse(error);
        if (sizeError) return sizeError;
        console.error('API PUT /api/v1/network/service-prescriptions/[id] error:', error);
        return NextResponse.json({ error: 'Failed to update service prescription' }, { status: 500 });
    }
}
