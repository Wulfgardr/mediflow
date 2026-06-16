/* @Codex */
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { entries } from '@/lib/schema';
import { and, eq } from 'drizzle-orm';
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
/* @Codex */
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/audit';
/* @Codex */
import { normalizeEntryUpdateInput } from '@/lib/api-v1-clinical-write-normalization';
/* @Codex */
import { buildEntryVersionConflictPayload, parseEntryExpectedVersion } from '@/lib/entry-concurrency';
/* @Codex */
import { parseClinicalDeleteBody } from '@/lib/api-v1-clinical-lifecycle';

/* @Codex */
async function selectEntryConflictSnapshot(entryId: string) {
    return await dbServer
        .select({
            id: entries.id,
            patientId: entries.patientId,
            version: entries.version,
            updatedAt: entries.updatedAt,
            deletedAt: entries.deletedAt,
        })
        .from(entries)
        .where(eq(entries.id, entryId))
        .get() ?? null;
}

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await params;
        const body = await request.json() as Record<string, unknown>;
        const expectedVersion = parseEntryExpectedVersion(body.version);
        if (expectedVersion === null) {
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }

        const existing = await dbServer.select({ id: entries.id }).from(entries).where(eq(entries.id, id)).get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const normalized = normalizeEntryUpdateInput(body);
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }

        const updateResult = await dbServer.update(entries)
            .set({
                ...normalized.values,
                version: expectedVersion + 1,
            })
            .where(and(eq(entries.id, id), eq(entries.version, expectedVersion)))
            .run();

        if (updateResult.changes === 0) {
            return NextResponse.json(
                buildEntryVersionConflictPayload(
                    expectedVersion,
                    id,
                    await selectEntryConflictSnapshot(id),
                ),
                { status: 409 },
            );
        }

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            session,
            {
                eventType: normalized.values.deletedAt ? 'entry.deleted' : 'entry.updated',
                subjectType: 'entry',
                subjectRef: id,
                redactedMetadata: {
                    changedFields: listChangedFields(body, ['version']),
                    resourceVersion: expectedVersion + 1,
                },
            },
            '[MediFlow] Entry audit write failed:',
        );

        return NextResponse.json({ success: true });
    } catch (error) {
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

    try {
        const { id } = await params;
        const parsedBody = await parseClinicalDeleteBody(request, 'web-delete');
        if (!parsedBody.ok) {
            return NextResponse.json({ error: parsedBody.error }, { status: 400 });
        }
        const expectedVersion = parseEntryExpectedVersion(parsedBody.values.version);
        if (expectedVersion === null) {
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }
        const normalized = normalizeEntryUpdateInput({
            deletedAt: parsedBody.values.deletedAt,
            deletionReason: parsedBody.values.deletionReason,
        });
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }

        const existing = await dbServer.select({ id: entries.id }).from(entries).where(eq(entries.id, id)).get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const updateResult = await dbServer.update(entries)
            .set({
                ...normalized.values,
                version: expectedVersion + 1,
            })
            .where(and(eq(entries.id, id), eq(entries.version, expectedVersion)))
            .run();

        if (updateResult.changes === 0) {
            return NextResponse.json(
                buildEntryVersionConflictPayload(
                    expectedVersion,
                    id,
                    await selectEntryConflictSnapshot(id),
                ),
                { status: 409 },
            );
        }

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            session,
            {
                eventType: 'entry.deleted',
                subjectType: 'entry',
                subjectRef: id,
                redactedMetadata: {
                    changedFields: ['deletedAt', 'deletionReason'],
                    resourceVersion: expectedVersion + 1,
                },
            },
            '[MediFlow] Entry audit write failed:',
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API DELETE /entries/[id] error:', error);
        return NextResponse.json({ error: 'Delete Failed' }, { status: 500 });
    }
}
