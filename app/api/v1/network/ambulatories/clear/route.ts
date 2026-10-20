import { readNativeNetworkJson, jsonBodyTooLargeResponse } from '@/lib/native-network-json-body';
import { NextResponse } from 'next/server';
import { apiInternalError } from '@/lib/api-error-response';
import { clearNetworkAmbulatory, NETWORK_AMBULATORY_WRITE_CAPABILITY } from '@/lib/network-ambulatory-write';
import { requireNetworkWriteContext } from '@/lib/network-write-context';

export async function POST(request: Request) {
    try {
        const resolved = await requireNetworkWriteContext(request, NETWORK_AMBULATORY_WRITE_CAPABILITY);
        if (!resolved.ok) return resolved.response;
        const body = await readNativeNetworkJson(request) as Record<string, unknown>;
        const ambulatoryId = typeof body.ambulatoryId === 'string' ? body.ambulatoryId.trim() : '';
        if (!ambulatoryId) return NextResponse.json({ error: 'Ambulatory ID required' }, { status: 400 });
        const result = await clearNetworkAmbulatory(resolved.context, ambulatoryId, body);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        const sizeError = jsonBodyTooLargeResponse(error);
        if (sizeError) return sizeError;
        return apiInternalError('Clear network ambulatory', error);
    }
}
