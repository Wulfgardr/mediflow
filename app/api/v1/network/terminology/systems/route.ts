/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import {
    NETWORK_CATALOG_READ_CAPABILITY,
    listTerminologyCatalogSystems,
} from '@/lib/network-catalog-read';
/* @Codex */
import { requireNetworkCapabilityContext } from '@/lib/network-write-context';

/* @Codex */
export async function GET(request: Request) {
    try {
        const resolved = await requireNetworkCapabilityContext(request, NETWORK_CATALOG_READ_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const result = await listTerminologyCatalogSystems();
        return NextResponse.json(result.body, { status: result.status ?? 200 });
    } catch (error) {
        console.error('API GET /api/v1/network/terminology/systems error:', error);
        return NextResponse.json({ error: 'Failed to load terminology systems' }, { status: 500 });
    }
}
