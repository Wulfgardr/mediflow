/* @Codex */
import { readNativeNetworkJson, jsonBodyTooLargeResponse, emptyJsonUnlessTooLarge } from '@/lib/native-network-json-body';
import { NextResponse } from 'next/server';
import {
    deleteNetworkAmbulatory,
    NETWORK_AMBULATORY_WRITE_CAPABILITY,
    updateNetworkAmbulatory,
} from '@/lib/network-ambulatory-write';
import { requireNetworkWriteContext } from '@/lib/network-write-context';

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: RouteContext) {
    try {
        const resolved = await requireNetworkWriteContext(request, NETWORK_AMBULATORY_WRITE_CAPABILITY);
        if (!resolved.ok) return resolved.response;
        const { id } = await context.params;
        const result = await updateNetworkAmbulatory(resolved.context, id, await readNativeNetworkJson(request) as Record<string, unknown>);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        /* @Codex */
        const sizeError = jsonBodyTooLargeResponse(error);
        if (sizeError) return sizeError;
        console.error('API PUT /api/v1/network/ambulatories/[id] error:', error);
        return NextResponse.json({ error: 'Failed to update ambulatory' }, { status: 500 });
    }
}

export async function DELETE(request: Request, context: RouteContext) {
    try {
        const resolved = await requireNetworkWriteContext(request, NETWORK_AMBULATORY_WRITE_CAPABILITY);
        if (!resolved.ok) return resolved.response;
        const { id } = await context.params;
        const result = await deleteNetworkAmbulatory(resolved.context, id, await readNativeNetworkJson(request).catch(emptyJsonUnlessTooLarge) as Record<string, unknown>);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        /* @Codex */
        const sizeError = jsonBodyTooLargeResponse(error);
        if (sizeError) return sizeError;
        console.error('API DELETE /api/v1/network/ambulatories/[id] error:', error);
        return NextResponse.json({ error: 'Failed to delete ambulatory' }, { status: 500 });
    }
}
