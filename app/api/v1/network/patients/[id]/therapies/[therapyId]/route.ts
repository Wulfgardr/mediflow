import { readNativeNetworkJson, jsonBodyTooLargeResponse } from '@/lib/native-network-json-body';
import { therapyJsonObject } from '@/lib/therapy-write-input';
import { NextResponse } from 'next/server';
import {
    NETWORK_THERAPY_READ_CAPABILITY,
    getNetworkScopedTherapy,
} from '@/lib/network-therapy-read';
import {
    NETWORK_THERAPY_WRITE_CAPABILITY,
    updateNetworkScopedTherapy,
} from '@/lib/network-therapy-write';
import { requireNetworkCapabilityContext, requireNetworkWriteContext } from '@/lib/network-write-context';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string; therapyId: string }> }
) {
    try {
        const { id, therapyId } = await params;
        const resolved = await requireNetworkCapabilityContext(request, NETWORK_THERAPY_READ_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const therapy = await getNetworkScopedTherapy(id, therapyId, resolved.context.scopeAmbulatoryId);
        if (!therapy) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        return NextResponse.json(therapy);
    } catch (error) {
        console.error('API GET /api/v1/network/patients/[id]/therapies/[therapyId] error:', error);
        return NextResponse.json({ error: 'Failed to fetch therapy' }, { status: 500 });
    }
}

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string; therapyId: string }> }
) {
    try {
        const { id, therapyId } = await params;
        const resolved = await requireNetworkWriteContext(request, NETWORK_THERAPY_WRITE_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        let rawBody: unknown;
        try { rawBody = await readNativeNetworkJson(request); }
        catch (error) {
            if (error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
            throw error;
        }
        const body = therapyJsonObject(rawBody);
        if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        const result = await updateNetworkScopedTherapy(
            { ...resolved.context, patientId: id, therapyId },
            body,
        );
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        const sizeError = jsonBodyTooLargeResponse(error);
        if (sizeError) return sizeError;
        console.error('API PUT /api/v1/network/patients/[id]/therapies/[therapyId] error:', error);
        return NextResponse.json({ error: 'Failed to update therapy' }, { status: 500 });
    }
}
