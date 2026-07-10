import { NextResponse } from 'next/server';
import { clearNetworkAmbulatory, NETWORK_AMBULATORY_WRITE_CAPABILITY } from '@/lib/network-ambulatory-write';
import { requireNetworkWriteContext } from '@/lib/network-write-context';

export async function POST(request: Request) {
    try {
        const resolved = await requireNetworkWriteContext(request, NETWORK_AMBULATORY_WRITE_CAPABILITY);
        if (!resolved.ok) return resolved.response;
        const body = await request.json() as Record<string, unknown>;
        const ambulatoryId = typeof body.ambulatoryId === 'string' ? body.ambulatoryId.trim() : '';
        if (!ambulatoryId) return NextResponse.json({ error: 'Ambulatory ID required' }, { status: 400 });
        const result = await clearNetworkAmbulatory(resolved.context, ambulatoryId, body);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API POST /api/v1/network/ambulatories/clear error:', error);
        return NextResponse.json({ error: 'Failed to clear ambulatory' }, { status: 500 });
    }
}
