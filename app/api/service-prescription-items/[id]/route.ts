import { archiveReplacementResponse } from '@/lib/api-error-response';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { readPrescriptionJsonObject } from '@/lib/prescription-json-body';
import { NextResponse } from 'next/server';
import {
    deleteHostServicePrescriptionItem,
    updateHostServicePrescriptionItem,
} from '@/lib/service-prescription-write';
import { requireExpectedVersion } from '@/lib/version-concurrency';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: RouteContext) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;

    try {
        const { id } = await context.params;
        const parsedBody = await readPrescriptionJsonObject(request);
        if (!parsedBody.ok) return parsedBody.response;
        const body = parsedBody.body;
        const result = await updateHostServicePrescriptionItem({ request, session, id }, body);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        const replacement = archiveReplacementResponse(error);
        if (replacement) return replacement;
        console.error('API PUT /service-prescription-items/[id] error:', error);
        return NextResponse.json({ error: 'Failed to update service prescription item' }, { status: 500 });
    }
}

export async function DELETE(request: Request, context: RouteContext) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;

    try {
        const { id } = await context.params;
        const parsedBody = await readPrescriptionJsonObject(request, 'empty-object');
        if (!parsedBody.ok) return parsedBody.response;
        const body = parsedBody.body;
        const versionResult = requireExpectedVersion(body.version);
        if (!versionResult.ok) {
            return NextResponse.json(versionResult.value, { status: versionResult.status });
        }
        const result = await deleteHostServicePrescriptionItem({ request, session, id }, versionResult.expectedVersion);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        const replacement = archiveReplacementResponse(error);
        if (replacement) return replacement;
        console.error('API DELETE /service-prescription-items/[id] error:', error);
        return NextResponse.json({ error: 'Failed to delete service prescription item' }, { status: 500 });
    }
}
