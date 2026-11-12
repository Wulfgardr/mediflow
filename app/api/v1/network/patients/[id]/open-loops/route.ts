import { NextResponse } from 'next/server';
import { requireNetworkCapabilityContext } from '@/lib/network-write-context';
import { NETWORK_SERVICE_PRESCRIPTION_READ_CAPABILITY, readNetworkPatientOpenLoops } from '@/lib/service-prescription-write';
import { NETWORK_OBSERVATION_READ_CAPABILITY } from '@/lib/network-observation-read';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const resolved = await requireNetworkCapabilityContext(request, NETWORK_SERVICE_PRESCRIPTION_READ_CAPABILITY);
        if (!resolved.ok) return resolved.response;
        if (!resolved.context.pairedClient.grantedCapabilities.includes(NETWORK_OBSERVATION_READ_CAPABILITY)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        if (request.signal.aborted) return NextResponse.json({ error: 'Request cancelled' }, { status: 409 });
        const result = readNetworkPatientOpenLoops(id, resolved.context.scopeAmbulatoryId);
        return result ? NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
            : NextResponse.json({ error: 'Not found' }, { status: 404 });
    } catch {
        return NextResponse.json({ error: 'Failed to read open loops' }, { status: 500 });
    }
}
