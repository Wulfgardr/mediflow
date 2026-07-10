/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import { parseApiV1Limit, parseApiV1NullableDate } from '@/lib/api-v1-route-helpers';
/* @Codex */
import {
    listNetworkScopedEntriesForAmbulatory,
    NETWORK_GLOBAL_ENTRY_READ_CAPABILITY,
} from '@/lib/network-entry-read';
/* @Codex */
import { requireNetworkCapabilityContext } from '@/lib/network-write-context';

/* @Codex */
export async function GET(request: Request) {
    try {
        const resolved = await requireNetworkCapabilityContext(request, NETWORK_GLOBAL_ENTRY_READ_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const { searchParams } = new URL(request.url);
        const entries = await listNetworkScopedEntriesForAmbulatory(resolved.context.scopeAmbulatoryId, {
            limit: parseApiV1Limit(searchParams.get('limit'), 50, 100),
            type: searchParams.get('type')?.trim() || null,
            dateFrom: parseApiV1NullableDate(searchParams.get('dateFrom')),
            dateTo: parseApiV1NullableDate(searchParams.get('dateTo')),
        });

        return NextResponse.json(entries);
    } catch (error) {
        console.error('API GET /api/v1/network/entries error:', error);
        return NextResponse.json({ error: 'Failed to fetch entries' }, { status: 500 });
    }
}
