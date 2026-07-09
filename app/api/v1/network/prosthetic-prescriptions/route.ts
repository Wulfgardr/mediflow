/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import {
    NETWORK_PROSTHETIC_PRESCRIPTION_READ_CAPABILITY,
    NETWORK_PROSTHETIC_PRESCRIPTION_WRITE_CAPABILITY,
    createNetworkScopedProstheticPrescription,
    listNetworkScopedProstheticPrescriptions,
} from '@/lib/prosthetic-prescription-write';
/* @Codex */
import { requireNetworkCapabilityContext, requireNetworkWriteContext } from '@/lib/network-write-context';

export async function GET(request: Request) {
    try {
        const resolved = await requireNetworkCapabilityContext(request, NETWORK_PROSTHETIC_PRESCRIPTION_READ_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const patientId = new URL(request.url).searchParams.get('patientId')?.trim();
        if (!patientId) return NextResponse.json({ error: 'patientId is required' }, { status: 400 });

        return NextResponse.json(await listNetworkScopedProstheticPrescriptions(patientId, resolved.context.scopeAmbulatoryId));
    } catch (error) {
        console.error('API GET /api/v1/network/prosthetic-prescriptions error:', error);
        return NextResponse.json({ error: 'Failed to fetch prosthetic prescriptions' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const resolved = await requireNetworkWriteContext(request, NETWORK_PROSTHETIC_PRESCRIPTION_WRITE_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const body = await request.json() as Record<string, unknown>;
        const patientId = typeof body.patientId === 'string' ? body.patientId.trim() : '';
        if (!patientId) return NextResponse.json({ error: 'patientId is required' }, { status: 400 });

        const result = await createNetworkScopedProstheticPrescription({ ...resolved.context, patientId }, body);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API POST /api/v1/network/prosthetic-prescriptions error:', error);
        return NextResponse.json({ error: 'Failed to create prosthetic prescription' }, { status: 500 });
    }
}
