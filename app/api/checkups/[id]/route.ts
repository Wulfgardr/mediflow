import { archiveReplacementResponse } from '@/lib/api-error-response';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { readCheckupJsonObject } from '@/lib/checkup-json-body';
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { checkups, patients } from '@/lib/schema';
import { and, eq, exists } from 'drizzle-orm';
import { activePatients } from '@/lib/patient-lifecycle';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { auditContextFromSession, listChangedFields, requestIdFromRequest } from '@/lib/security/audit';
import { updateCheckupOperation } from '@/lib/checkup-write-operation';
import { normalizeCheckupUpdateInput } from '@/lib/api-v1-clinical-write-normalization';
import { parseCheckupExpectedVersion } from '@/lib/checkup-concurrency';
import { parseClinicalDeleteBody } from '@/lib/api-v1-clinical-lifecycle';

/* preserve the preflight 404-before-field-validation ordering; the
   IMMEDIATE checkup operation rechecks the active parent before its UPDATE. */
function activeCheckupParent() {
    return exists(dbServer.select({ id: patients.id }).from(patients)
        .where(and(eq(patients.id, checkups.patientId), activePatients())));
}

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
        const envelope = await readCheckupJsonObject(request);
        if (!envelope.ok) return envelope.response;
        const body = envelope.body;
        const expectedVersion = parseCheckupExpectedVersion(body.version);
        if (expectedVersion === null) {
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }

        const existing = await dbServer.select({ id: checkups.id }).from(checkups).where(and(eq(checkups.id, id), activeCheckupParent())).get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const normalized = normalizeCheckupUpdateInput(body);
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }

        // host audit context is resolved before the synchronous IMMEDIATE mutation.
        const context = auditContextFromSession(session);
        const result = updateCheckupOperation({
            checkupId: id, expectedVersion, values: normalized.values, mode: 'web',
            changedFields: listChangedFields(body, ['version']),
            audit: { archiveGeneration: context.archiveGeneration, actorType: context.actorType, actorRef: context.actorRef,
                sourceSurface: context.sourceSurface, requestId: requestIdFromRequest(request),
                flags: [`auth:${context.authContext}`] },
        });
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        const replacement = archiveReplacementResponse(error);
        if (replacement) return replacement;
        return NextResponse.json({ error: "Update Failed" }, { status: 500 });
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
        const parsedBody = await parseClinicalDeleteBody(request, 'web-delete');
        if (!parsedBody.ok) {
            return NextResponse.json({ error: parsedBody.error,
                ...(parsedBody.code ? { code: parsedBody.code } : {}) }, { status: parsedBody.status ?? 400 });
        }
        const expectedVersion = parseCheckupExpectedVersion(parsedBody.values.version);
        if (expectedVersion === null) {
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }
        const normalized = normalizeCheckupUpdateInput({
            deletedAt: parsedBody.values.deletedAt,
            deletionReason: parsedBody.values.deletionReason,
        });
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }

        const existing = await dbServer.select({ id: checkups.id }).from(checkups).where(and(eq(checkups.id, id), activeCheckupParent())).get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const context = auditContextFromSession(session);
        const result = updateCheckupOperation({
            checkupId: id, expectedVersion, values: normalized.values, mode: 'web',
            changedFields: ['deletedAt', 'deletionReason'],
            audit: { archiveGeneration: context.archiveGeneration, actorType: context.actorType, actorRef: context.actorRef,
                sourceSurface: context.sourceSurface, requestId: requestIdFromRequest(request),
                flags: [`auth:${context.authContext}`] },
        });
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        const replacement = archiveReplacementResponse(error);
        if (replacement) return replacement;
        return NextResponse.json({ error: "Delete Failed" }, { status: 500 });
    }
}
