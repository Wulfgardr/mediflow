/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import { parseApiV1Limit, parseApiV1NullableDate } from '@/lib/api-v1-route-helpers';
/* @Codex */
import {
    listNetworkScopedCheckupsForAmbulatory,
    NETWORK_AGENDA_READ_CAPABILITY,
} from '@/lib/network-checkup-read';
/* @Codex */
import { requireNetworkCapabilityContext } from '@/lib/network-write-context';

/* @Codex */
export async function GET(request: Request) {
    try {
        const resolved = await requireNetworkCapabilityContext(request, NETWORK_AGENDA_READ_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const { searchParams } = new URL(request.url);
        const status = searchParams.getAll('status').map((value) => value.trim()).filter(Boolean);
        const checkups = await listNetworkScopedCheckupsForAmbulatory(resolved.context.scopeAmbulatoryId, {
            limit: parseApiV1Limit(searchParams.get('limit'), 200, 500),
            status: status.length > 0 ? status : null,
            dateFrom: parseApiV1NullableDate(searchParams.get('dateFrom')),
            dateTo: parseApiV1NullableDate(searchParams.get('dateTo')),
        });

        return NextResponse.json(checkups);
    } catch (error) {
        console.error('API GET /api/v1/network/checkups error:', error);
        return NextResponse.json({ error: 'Failed to fetch checkups' }, { status: 500 });
    }
}
