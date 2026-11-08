import { readNativeNetworkJson, jsonBodyTooLargeResponse } from '@/lib/native-network-json-body';
import { NextResponse } from 'next/server';
import {
    NETWORK_OBSERVATION_READ_CAPABILITY,
    listNetworkScopedObservations,
} from '@/lib/network-observation-read';
import {
    NETWORK_OBSERVATION_WRITE_CAPABILITY,
    createNetworkScopedObservation,
} from '@/lib/network-observation-write';
import { requireNetworkCapabilityContext, requireNetworkWriteContext } from '@/lib/network-write-context';
import { parseCappedLimit, parseDateParam } from '@/lib/list-query-params';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const resolved = await requireNetworkCapabilityContext(request, NETWORK_OBSERVATION_READ_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const { searchParams } = new URL(request.url);
        const observations = await listNetworkScopedObservations(id, resolved.context.scopeAmbulatoryId, {
            limit: parseCappedLimit(searchParams.get('limit'), 200),
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

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const resolved = await requireNetworkWriteContext(request, NETWORK_OBSERVATION_WRITE_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        let body: unknown;
        try { body = await readNativeNetworkJson(request); }
        catch (error) {
            const sizeError = jsonBodyTooLargeResponse(error);
            if (sizeError) return sizeError;
            if (error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
            throw error;
        }
        const result = await createNetworkScopedObservation(
            { ...resolved.context, patientId: id },
            body,
        );
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        const sizeError = jsonBodyTooLargeResponse(error);
        if (sizeError) return sizeError;
        console.error('API POST /api/v1/network/patients/[id]/observations error:', error);
        return NextResponse.json({ error: 'Failed to create observation' }, { status: 500 });
    }
}
