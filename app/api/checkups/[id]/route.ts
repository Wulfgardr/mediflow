import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { checkups, patients } from '@/lib/schema';
import { and, eq, exists } from 'drizzle-orm';
import { activePatients } from '@/lib/patient-lifecycle';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
/* @Codex */
import { auditContextFromSession, listChangedFields, requestIdFromRequest } from '@/lib/security/audit';
import { updateCheckupOperation } from '@/lib/checkup-write-operation';
/* @Codex */
import { normalizeCheckupUpdateInput } from '@/lib/api-v1-clinical-write-normalization';
/* @Codex */
import { parseCheckupExpectedVersion } from '@/lib/checkup-concurrency';
/* @Codex */
import { parseClinicalDeleteBody } from '@/lib/api-v1-clinical-lifecycle';

/* @Codex: preserve the preflight 404-before-field-validation ordering; the
   IMMEDIATE checkup operation rechecks the active parent before its UPDATE. */
function activeCheckupParent() {
    return exists(dbServer.select({ id: patients.id }).from(patients)
        .where(and(eq(patients.id, checkups.patientId), activePatients())));
}

/* @Codex */
export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await params;
        const body = await request.json() as Record<string, unknown>;
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

        // @Codex: host audit context is resolved before the synchronous IMMEDIATE mutation.
        const context = auditContextFromSession(session);
        const result = updateCheckupOperation({
            checkupId: id, expectedVersion, values: normalized.values, mode: 'web',
            changedFields: listChangedFields(body, ['version']),
            audit: { actorType: context.actorType, actorRef: context.actorRef,
                sourceSurface: context.sourceSurface, requestId: requestIdFromRequest(request),
                flags: [`auth:${context.authContext}`] },
        });
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        return NextResponse.json({ error: "Update Failed" }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await params;
        const parsedBody = await parseClinicalDeleteBody(request, 'web-delete');
        if (!parsedBody.ok) {
            return NextResponse.json({ error: parsedBody.error }, { status: 400 });
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
            audit: { actorType: context.actorType, actorRef: context.actorRef,
                sourceSurface: context.sourceSurface, requestId: requestIdFromRequest(request),
                flags: [`auth:${context.authContext}`] },
        });
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        return NextResponse.json({ error: "Delete Failed" }, { status: 500 });
    }
}
