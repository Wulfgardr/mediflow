import { archiveReplacementResponse } from '@/lib/api-error-response';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
/* ordinary Web observation mutation adapters; the synchronous operation owns the write and audit. */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { observations } from '@/lib/schema';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { auditContextFromSession, requestIdFromRequest } from '@/lib/security/audit';
import { normalizeObservationUpdateInput } from '@/lib/api-v1-clinical-write-normalization';
import { updateObservationOperation } from '@/lib/observation-write-operation';
import { observationChangedFields, parseObservationDeleteInput, readObservationJsonObject,
    safeObservationExpectedVersion, validateObservationInput } from '@/lib/observation-write-input';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;
    try {
        const { id } = await params;
        const parsed = await readObservationJsonObject(request);
        if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
        const expectedVersion = safeObservationExpectedVersion(parsed.body.version);
        if (expectedVersion === null) return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        // preserve legacy 404-before-domain-validation; this read is not write authority.
        const existing = dbServer.select({ id: observations.id }).from(observations).where(eq(observations.id, id)).get();
        if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        const shape = validateObservationInput(parsed.body, 'web', 'update');
        if (shape) return NextResponse.json({ error: shape.error }, { status: shape.status });
        const normalized = normalizeObservationUpdateInput(parsed.body, { allowServicePrescriptionItemLink: true });
        if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 });
        const context = auditContextFromSession(session);
        const result = updateObservationOperation({
            observationId: id, expectedVersion, values: normalized.values, mode: 'web',
            changedFields: observationChangedFields(normalized.values, parsed.body),
            audit: { archiveGeneration: context.archiveGeneration, actorType: context.actorType, actorRef: context.actorRef,
                sourceSurface: context.sourceSurface, requestId: requestIdFromRequest(request),
                flags: [`auth:${context.authContext}`] },
        });
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        const replacement = archiveReplacementResponse(error);
        if (replacement) return replacement;
        console.error('API PUT /observations/[id] error:', error);
        return NextResponse.json({ error: 'Failed to update observation' }, { status: 500 });
    }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;
    try {
        const { id } = await params;
        const parsed = await readObservationJsonObject(request);
        if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
        const deletion = parseObservationDeleteInput(parsed.body, 'web-delete');
        if (!deletion.ok) return NextResponse.json({ error: deletion.error }, { status: deletion.status });
        const normalized = normalizeObservationUpdateInput(deletion.body);
        if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 });
        const context = auditContextFromSession(session);
        const result = updateObservationOperation({
            observationId: id, expectedVersion: deletion.expectedVersion, values: normalized.values, mode: 'web',
            changedFields: ['deletedAt', 'deletionReason'],
            audit: { archiveGeneration: context.archiveGeneration, actorType: context.actorType, actorRef: context.actorRef,
                sourceSurface: context.sourceSurface, requestId: requestIdFromRequest(request),
                flags: [`auth:${context.authContext}`] },
        });
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        const replacement = archiveReplacementResponse(error);
        if (replacement) return replacement;
        console.error('API DELETE /observations/[id] error:', error);
        return NextResponse.json({ error: 'Failed to delete observation' }, { status: 500 });
    }
}
