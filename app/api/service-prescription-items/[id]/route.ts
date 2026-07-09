/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import {
    deleteHostServicePrescriptionItem,
    updateHostServicePrescriptionItem,
} from '@/lib/service-prescription-write';
/* @Codex */
import { requireExpectedVersion } from '@/lib/version-concurrency';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: RouteContext) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await context.params;
        const body = await request.json() as Record<string, unknown>;
        const result = await updateHostServicePrescriptionItem({ request, session, id }, body);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API PUT /service-prescription-items/[id] error:', error);
        return NextResponse.json({ error: 'Failed to update service prescription item' }, { status: 500 });
    }
}

export async function DELETE(request: Request, context: RouteContext) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await context.params;
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const versionResult = requireExpectedVersion(body.version);
        if (!versionResult.ok) {
            return NextResponse.json(versionResult.value, { status: versionResult.status });
        }
        const result = await deleteHostServicePrescriptionItem({ request, session, id }, versionResult.expectedVersion);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API DELETE /service-prescription-items/[id] error:', error);
        return NextResponse.json({ error: 'Failed to delete service prescription item' }, { status: 500 });
    }
}
