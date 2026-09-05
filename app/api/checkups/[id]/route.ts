import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { checkups, patients } from '@/lib/schema';
import { and, eq, exists } from 'drizzle-orm';
import { activePatients } from '@/lib/patient-lifecycle';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
/* @Codex */
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/security/audit';
/* @Codex */
import { normalizeCheckupUpdateInput } from '@/lib/api-v1-clinical-write-normalization';
/* @Codex */
import { buildCheckupVersionConflictPayload, parseCheckupExpectedVersion } from '@/lib/checkup-concurrency';
/* @Codex */
import { parseClinicalDeleteBody } from '@/lib/api-v1-clinical-lifecycle';

/* @Codex MF085 combined review: a child CAS does not detect a patient tombstone.
   Keep this correlated predicate in the UPDATE itself, not only the prior read. */
function activeCheckupParent() {
    return exists(dbServer.select({ id: patients.id }).from(patients)
        .where(and(eq(patients.id, checkups.patientId), activePatients())));
}

/* @Codex */
async function selectCheckupConflictSnapshot(checkupId: string) {
    return await dbServer
        .select({
            id: checkups.id,
            patientId: checkups.patientId,
            version: checkups.version,
            updatedAt: checkups.updatedAt,
            deletedAt: checkups.deletedAt,
        })
        .from(checkups)
        .where(and(eq(checkups.id, checkupId), activeCheckupParent()))
        .get() ?? null;
}

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

        const updateResult = await dbServer.update(checkups)
            .set({
                ...normalized.values,
                version: expectedVersion + 1,
            })
            .where(and(eq(checkups.id, id), eq(checkups.version, expectedVersion), activeCheckupParent()))
            .run();

        if (updateResult.changes === 0) {
            return NextResponse.json(
                buildCheckupVersionConflictPayload(
                    expectedVersion,
                    id,
                    await selectCheckupConflictSnapshot(id),
                ),
                { status: 409 },
            );
        }

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            session,
            {
                eventType: normalized.values.deletedAt ? 'checkup.deleted' : 'checkup.updated',
                subjectType: 'checkup',
                subjectRef: id,
                redactedMetadata: {
                    changedFields: listChangedFields(body, ['version']),
                    resourceVersion: expectedVersion + 1,
                },
            },
            '[MediFlow] Checkup audit write failed:',
        );

        return NextResponse.json({ success: true });
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

        const updateResult = await dbServer.update(checkups)
            .set({
                ...normalized.values,
                version: expectedVersion + 1,
            })
            .where(and(eq(checkups.id, id), eq(checkups.version, expectedVersion), activeCheckupParent()))
            .run();

        if (updateResult.changes === 0) {
            return NextResponse.json(
                buildCheckupVersionConflictPayload(
                    expectedVersion,
                    id,
                    await selectCheckupConflictSnapshot(id),
                ),
                { status: 409 },
            );
        }

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            session,
            {
                eventType: 'checkup.deleted',
                subjectType: 'checkup',
                subjectRef: id,
                redactedMetadata: {
                    changedFields: ['deletedAt', 'deletionReason'],
                    resourceVersion: expectedVersion + 1,
                },
            },
            '[MediFlow] Checkup audit write failed:',
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: "Delete Failed" }, { status: 500 });
    }
}
