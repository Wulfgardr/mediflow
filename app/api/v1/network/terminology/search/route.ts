/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import {
    NETWORK_CATALOG_READ_CAPABILITY,
    searchTerminologyCatalog,
} from '@/lib/network-catalog-read';
/* @Codex */
import { requireNetworkCapabilityContext } from '@/lib/network-write-context';

/* @Codex */
export async function GET(request: Request) {
    try {
        const resolved = await requireNetworkCapabilityContext(request, NETWORK_CATALOG_READ_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const { searchParams } = new URL(request.url);
        const result = await searchTerminologyCatalog(searchParams);
        return NextResponse.json(result.body, { status: result.status ?? 200 });
    } catch (error) {
        console.error('API GET /api/v1/network/terminology/search error:', error);
        return NextResponse.json({ error: 'Failed to search terminology' }, { status: 500 });
    }
}
