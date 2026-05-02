/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import {
    NETWORK_ENTRY_READ_CAPABILITY,
    getNetworkScopedEntry,
} from '@/lib/network-entry-read';
/* @Codex */
import {
    NETWORK_ENTRY_WRITE_CAPABILITY,
    updateNetworkScopedEntry,
} from '@/lib/network-entry-write';
/* @Codex */
import { requireNetworkCapabilityContext, requireNetworkWriteContext } from '@/lib/network-write-context';

/* @Codex */
export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string; entryId: string }> }
) {
    try {
        const { id, entryId } = await params;
        const resolved = await requireNetworkCapabilityContext(request, NETWORK_ENTRY_READ_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const entry = await getNetworkScopedEntry(id, entryId, resolved.context.scopeAmbulatoryId);
        if (!entry) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        return NextResponse.json(entry);
    } catch (error) {
        console.error('API GET /api/v1/network/patients/[id]/entries/[entryId] error:', error);
        return NextResponse.json({ error: 'Failed to fetch entry' }, { status: 500 });
    }
}

/* @Codex */
export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string; entryId: string }> }
) {
    try {
        const { id, entryId } = await params;
        const resolved = await requireNetworkWriteContext(request, NETWORK_ENTRY_WRITE_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const body = await request.json() as Record<string, unknown>;
        const result = await updateNetworkScopedEntry(
            { ...resolved.context, patientId: id, entryId },
            body,
        );
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API PUT /api/v1/network/patients/[id]/entries/[entryId] error:', error);
        return NextResponse.json({ error: 'Failed to update entry' }, { status: 500 });
    }
}
