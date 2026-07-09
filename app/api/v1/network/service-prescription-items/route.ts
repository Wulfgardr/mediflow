/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import {
    NETWORK_SERVICE_PRESCRIPTION_READ_CAPABILITY,
    NETWORK_SERVICE_PRESCRIPTION_WRITE_CAPABILITY,
    createNetworkScopedServicePrescriptionItem,
    listNetworkScopedServicePrescriptionItems,
} from '@/lib/service-prescription-write';
/* @Codex */
import { requireNetworkCapabilityContext, requireNetworkWriteContext } from '@/lib/network-write-context';

export async function GET(request: Request) {
    try {
        const resolved = await requireNetworkCapabilityContext(request, NETWORK_SERVICE_PRESCRIPTION_READ_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const { searchParams } = new URL(request.url);
        const result = await listNetworkScopedServicePrescriptionItems({
            patientId: searchParams.get('patientId')?.trim(),
            prescriptionId: searchParams.get('prescriptionId')?.trim(),
            scopeAmbulatoryId: resolved.context.scopeAmbulatoryId,
        });
        if (!Array.isArray(result)) return NextResponse.json(result.value, { status: result.status });
        return NextResponse.json(result);
    } catch (error) {
        console.error('API GET /api/v1/network/service-prescription-items error:', error);
        return NextResponse.json({ error: 'Failed to fetch service prescription items' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const resolved = await requireNetworkWriteContext(request, NETWORK_SERVICE_PRESCRIPTION_WRITE_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const body = await request.json() as Record<string, unknown>;
        const result = await createNetworkScopedServicePrescriptionItem(resolved.context, body);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API POST /api/v1/network/service-prescription-items error:', error);
        return NextResponse.json({ error: 'Failed to create service prescription item' }, { status: 500 });
    }
}
