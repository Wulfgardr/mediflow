/* @Codex */
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { observations } from '@/lib/schema';
import { and, eq } from 'drizzle-orm';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
/* @Codex */
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/security/audit';
/* @Codex */
import { normalizeObservationUpdateInput } from '@/lib/api-v1-clinical-write-normalization';
import { buildObservationVersionConflictPayload, parseObservationExpectedVersion } from '@/lib/observation-concurrency';
import { parseClinicalDeleteBody } from '@/lib/api-v1-clinical-lifecycle';

async function selectObservationConflictSnapshot(observationId: string) {
    return await dbServer
        .select({
            id: observations.id,
            patientId: observations.patientId,
            version: observations.version,
            updatedAt: observations.updatedAt,
            deletedAt: observations.deletedAt,
        })
        .from(observations)
        .where(eq(observations.id, observationId))
        .get() ?? null;
}

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await params;
        const body = await request.json() as Record<string, unknown>;
        const expectedVersion = parseObservationExpectedVersion(body.version);
        if (expectedVersion === null) {
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }

        const existing = await dbServer
            .select({ id: observations.id })
            .from(observations)
            .where(eq(observations.id, id))
            .get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const normalized = normalizeObservationUpdateInput(body);
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }

        const updateResult = await dbServer.update(observations)
            .set({
                ...normalized.values,
                version: expectedVersion + 1,
            })
            .where(and(eq(observations.id, id), eq(observations.version, expectedVersion)))
            .run();
        if (updateResult.changes === 0) {
            return NextResponse.json(
                buildObservationVersionConflictPayload(
                    expectedVersion,
                    id,
                    await selectObservationConflictSnapshot(id),
                ),
                { status: 409 },
            );
        }

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            session,
            {
                eventType: 'observation.updated',
                subjectType: 'observation',
                subjectRef: id,
                redactedMetadata: {
                    changedFields: listChangedFields(body, ['version']),
                    resourceVersion: expectedVersion + 1,
                },
            },
            '[MediFlow] Observation audit write failed:',
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API PUT /observations/[id] error:', error);
        return NextResponse.json({ error: 'Failed to update observation' }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await params;
        const parsedBody = await parseClinicalDeleteBody(request, 'web-delete');
        if (!parsedBody.ok) {
            return NextResponse.json({ error: parsedBody.error }, { status: 400 });
        }
        const expectedVersion = parseObservationExpectedVersion(parsedBody.values.version);
        if (expectedVersion === null) {
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }
        const normalized = normalizeObservationUpdateInput({
            deletedAt: parsedBody.values.deletedAt,
            deletionReason: parsedBody.values.deletionReason,
        });
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }
        const existing = await dbServer
            .select({ id: observations.id })
            .from(observations)
            .where(eq(observations.id, id))
            .get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const updateResult = await dbServer.update(observations)
            .set({
                ...normalized.values,
                version: expectedVersion + 1,
            })
            .where(and(eq(observations.id, id), eq(observations.version, expectedVersion)))
            .run();
        if (updateResult.changes === 0) {
            return NextResponse.json(
                buildObservationVersionConflictPayload(
                    expectedVersion,
                    id,
                    await selectObservationConflictSnapshot(id),
                ),
                { status: 409 },
            );
        }

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            session,
            {
                eventType: 'observation.deleted',
                subjectType: 'observation',
                subjectRef: id,
                redactedMetadata: {
                    changedFields: ['deletedAt', 'deletionReason'],
                    resourceVersion: expectedVersion + 1,
                },
            },
            '[MediFlow] Observation audit write failed:',
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API DELETE /observations/[id] error:', error);
        return NextResponse.json({ error: 'Failed to delete observation' }, { status: 500 });
    }
}
