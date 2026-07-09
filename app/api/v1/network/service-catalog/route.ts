/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import {
    NETWORK_SERVICE_PRESCRIPTION_READ_CAPABILITY,
    readServiceCatalog,
} from '@/lib/service-prescription-write';
/* @Codex */
import { requireNetworkCapabilityContext } from '@/lib/network-write-context';

export async function GET(request: Request) {
    try {
        const resolved = await requireNetworkCapabilityContext(request, NETWORK_SERVICE_PRESCRIPTION_READ_CAPABILITY);
        if (!resolved.ok) return resolved.response;
        return NextResponse.json(await readServiceCatalog(new URL(request.url).searchParams));
    } catch (error) {
        console.error('API GET /api/v1/network/service-catalog error:', error);
        return NextResponse.json({ error: 'Failed to fetch service catalog' }, { status: 500 });
    }
}
