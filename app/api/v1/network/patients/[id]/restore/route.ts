import { readNativeNetworkJson, jsonBodyTooLargeResponse } from '@/lib/native-network-json-body';
import { NextResponse } from 'next/server';
import {
    NETWORK_PATIENT_LIFECYCLE_CAPABILITY,
    restoreNetworkScopedPatient,
} from '@/lib/network-patient-lifecycle';
import { requireNetworkCapabilityContext } from '@/lib/network-write-context';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const resolved = await requireNetworkCapabilityContext(request, NETWORK_PATIENT_LIFECYCLE_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const body = await readNativeNetworkJson(request) as Record<string, unknown>;
        const result = await restoreNetworkScopedPatient(
            {
                ...resolved.context,
                patientId: id,
            },
            body,
        );
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        const sizeError = jsonBodyTooLargeResponse(error);
        if (sizeError) return sizeError;
        console.error('API POST /api/v1/network/patients/[id]/restore error:', error);
        return NextResponse.json({ error: 'Failed to restore patient' }, { status: 500 });
    }
}
