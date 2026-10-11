import { archiveReplacementResponse } from '@/lib/api-error-response';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
/* @Codex */
import { NextResponse } from 'next/server';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
/* @Codex */
import { auditContextFromSession, requestIdFromRequest } from '@/lib/security/audit';
/* @Codex */
import { parseEntryDeleteInput, prepareEntryUpdate, readEntryJsonObject } from '@/lib/entry-write-input';
import { updateEntryOperation } from '@/lib/entry-write-operation';

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;

    try {
        const { id } = await params;
        const parsed = await readEntryJsonObject(request);
        if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
        const prepared = prepareEntryUpdate(parsed.body, 'web');
        if (!prepared.ok) return NextResponse.json({ error: prepared.error }, { status: prepared.status });
        const context = auditContextFromSession(session);
        const result = updateEntryOperation({ entryId: id, expectedVersion: prepared.expectedVersion,
            values: prepared.values, changedFields: prepared.changedFields, mode: 'web', audit: {
                archiveGeneration: context.archiveGeneration, actorType: context.actorType, actorRef: context.actorRef, sourceSurface: context.sourceSurface,
                requestId: requestIdFromRequest(request), flags: [`auth:${context.authContext}`],
            } });
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        const replacement = archiveReplacementResponse(error);
        if (replacement) return replacement;
        console.error('API PUT /entries/[id] error:', error);
        return NextResponse.json({ error: 'Update Failed' }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;

    try {
        const { id } = await params;
        const parsedBody = await parseEntryDeleteInput(request, 'web-delete');
        if (!parsedBody.ok) {
            return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status });
        }
        const prepared = prepareEntryUpdate(parsedBody.body, 'web', true);
        if (!prepared.ok) return NextResponse.json({ error: prepared.error }, { status: prepared.status });
        const context = auditContextFromSession(session);
        const result = updateEntryOperation({ entryId: id, expectedVersion: prepared.expectedVersion,
            values: prepared.values, changedFields: prepared.changedFields, mode: 'web', audit: {
                archiveGeneration: context.archiveGeneration, actorType: context.actorType, actorRef: context.actorRef, sourceSurface: context.sourceSurface,
                requestId: requestIdFromRequest(request), flags: [`auth:${context.authContext}`],
            } });
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        const replacement = archiveReplacementResponse(error);
        if (replacement) return replacement;
        console.error('API DELETE /entries/[id] error:', error);
        return NextResponse.json({ error: 'Delete Failed' }, { status: 500 });
    }
}
