import { NextResponse } from 'next/server';
import { deleteAmbulatory, updateAmbulatory } from '@/lib/ambulatory-write';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: RouteContext) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    try {
        const { id } = await context.params;
        /* @Codex: retain the admitted host session through the atomic writer. */
        const result = updateAmbulatory({ request, session }, id, await request.json() as Record<string, unknown>);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API PUT /ambulatories/[id] error:', error);
        return NextResponse.json({ error: 'Failed to update ambulatory' }, { status: 500 });
    }
}

export async function DELETE(request: Request, context: RouteContext) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    try {
        const { id } = await context.params;
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        /* @Codex */
        const result = deleteAmbulatory({ request, session }, id, body.version);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API DELETE /ambulatories/[id] error:', error);
        return NextResponse.json({ error: 'Failed to delete ambulatory' }, { status: 500 });
    }
}
