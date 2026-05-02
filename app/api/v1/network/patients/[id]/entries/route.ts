/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import {
    NETWORK_ENTRY_READ_CAPABILITY,
    listNetworkScopedEntries,
} from '@/lib/network-entry-read';
/* @Codex */
import {
    NETWORK_ENTRY_WRITE_CAPABILITY,
    createNetworkScopedEntry,
} from '@/lib/network-entry-write';
/* @Codex */
import { requireNetworkCapabilityContext, requireNetworkWriteContext } from '@/lib/network-write-context';

function parseLimit(value: string | null): number | null {
    if (!value) return null;
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) return null;
    return Math.min(parsed, 100);
}

function parseDateParam(value: string | null): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/* @Codex */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const resolved = await requireNetworkCapabilityContext(request, NETWORK_ENTRY_READ_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const { searchParams } = new URL(request.url);
        const entries = await listNetworkScopedEntries(id, resolved.context.scopeAmbulatoryId, {
            limit: parseLimit(searchParams.get('limit')),
            type: searchParams.get('type')?.trim() || null,
            dateFrom: parseDateParam(searchParams.get('dateFrom')),
            dateTo: parseDateParam(searchParams.get('dateTo')),
        });

        return NextResponse.json(entries);
    } catch (error) {
        console.error('API GET /api/v1/network/patients/[id]/entries error:', error);
        return NextResponse.json({ error: 'Failed to fetch entries' }, { status: 500 });
    }
}

/* @Codex */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const resolved = await requireNetworkWriteContext(request, NETWORK_ENTRY_WRITE_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const body = await request.json() as Record<string, unknown>;
        const result = await createNetworkScopedEntry(
            { ...resolved.context, patientId: id },
            body,
        );
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API POST /api/v1/network/patients/[id]/entries error:', error);
        return NextResponse.json({ error: 'Failed to create entry' }, { status: 500 });
    }
}
