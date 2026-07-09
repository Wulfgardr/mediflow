/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import {
    NETWORK_SERVICE_PRESCRIPTION_READ_CAPABILITY,
    NETWORK_SERVICE_PRESCRIPTION_WRITE_CAPABILITY,
    createNetworkScopedServicePrescription,
    listNetworkScopedServicePrescriptions,
} from '@/lib/service-prescription-write';
/* @Codex */
import { requireNetworkCapabilityContext, requireNetworkWriteContext } from '@/lib/network-write-context';

export async function GET(request: Request) {
    try {
        const resolved = await requireNetworkCapabilityContext(request, NETWORK_SERVICE_PRESCRIPTION_READ_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const patientId = new URL(request.url).searchParams.get('patientId')?.trim();
        if (!patientId) return NextResponse.json({ error: 'patientId is required' }, { status: 400 });

        const items = await listNetworkScopedServicePrescriptions(patientId, resolved.context.scopeAmbulatoryId);
        return NextResponse.json(items);
    } catch (error) {
        console.error('API GET /api/v1/network/service-prescriptions error:', error);
        return NextResponse.json({ error: 'Failed to fetch service prescriptions' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const resolved = await requireNetworkWriteContext(request, NETWORK_SERVICE_PRESCRIPTION_WRITE_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const body = await request.json() as Record<string, unknown>;
        const patientId = typeof body.patientId === 'string' ? body.patientId.trim() : '';
        if (!patientId) return NextResponse.json({ error: 'patientId is required' }, { status: 400 });

        const result = await createNetworkScopedServicePrescription({ ...resolved.context, patientId }, body);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API POST /api/v1/network/service-prescriptions error:', error);
        return NextResponse.json({ error: 'Failed to create service prescription' }, { status: 500 });
    }
}
