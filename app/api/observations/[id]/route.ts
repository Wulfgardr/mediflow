/* @Codex */
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { observations } from '@/lib/schema';
import { eq, sql } from 'drizzle-orm';
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
/* @Codex */
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/audit';
/* @Codex */
import { normalizeObservationUpdateInput } from '@/lib/api-v1-clinical-write-normalization';

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await params;
        const body = await request.json() as Record<string, unknown>;

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

        await dbServer.update(observations)
            .set({
                ...normalized.values,
                version: sql`${observations.version} + 1`,
            })
            .where(eq(observations.id, id));
        const current = await dbServer
            .select({ version: observations.version })
            .from(observations)
            .where(eq(observations.id, id))
            .get();

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
                    resourceVersion: current?.version ?? undefined,
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
        const existing = await dbServer
            .select({ id: observations.id, version: observations.version })
            .from(observations)
            .where(eq(observations.id, id))
            .get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        await dbServer.delete(observations).where(eq(observations.id, id));

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            session,
            {
                eventType: 'observation.deleted',
                subjectType: 'observation',
                subjectRef: id,
                redactedMetadata: {
                    changedFields: ['deleted'],
                    resourceVersion: existing.version,
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
