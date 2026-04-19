import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { checkups } from '@/lib/schema';
import { eq } from 'drizzle-orm';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
/* @Codex */
import { parseCheckupStatus } from '@/lib/status-normalization';
/* @Codex */
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/audit';

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await params;
        const body = await request.json() as unknown;
        /* @Codex */
        const auditBody = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
        const existing = await dbServer.select({ id: checkups.id }).from(checkups).where(eq(checkups.id, id)).get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        const updateData: {
            date?: Date;
            title?: string;
            notes?: string | null;
            status?: string;
            source?: string | null;
        } = {};

        if (body && typeof body === 'object') {
            const payload = body as Record<string, unknown>;

            if (payload.date !== undefined) {
                const parsedDate = new Date(payload.date as string | number | Date);
                if (Number.isNaN(parsedDate.getTime())) {
                    return NextResponse.json({ error: 'Invalid checkup date' }, { status: 400 });
                }
                updateData.date = parsedDate;
            }

            if (typeof payload.title === 'string') {
                updateData.title = payload.title;
            }

            if (Object.prototype.hasOwnProperty.call(payload, 'notes')) {
                if (payload.notes === null || payload.notes === '') {
                    updateData.notes = null;
                } else if (typeof payload.notes === 'string') {
                    updateData.notes = payload.notes;
                }
            }

            if (typeof payload.status === 'string') {
                const normalizedStatus = parseCheckupStatus(payload.status);
                if (!normalizedStatus) {
                    return NextResponse.json({ error: 'Invalid checkup status' }, { status: 400 });
                }
                updateData.status = normalizedStatus;
            }

            if (Object.prototype.hasOwnProperty.call(payload, 'source')) {
                if (payload.source === null || payload.source === '') {
                    updateData.source = null;
                } else if (typeof payload.source === 'string') {
                    updateData.source = payload.source;
                }
            }
        }

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
        }

        await dbServer.update(checkups)
            .set(updateData)
            .where(eq(checkups.id, id));

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            session,
            {
                eventType: 'checkup.updated',
                subjectType: 'checkup',
                subjectRef: id,
                redactedMetadata: {
                    changedFields: listChangedFields(auditBody),
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
        const existing = await dbServer.select({ id: checkups.id }).from(checkups).where(eq(checkups.id, id)).get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        await dbServer.delete(checkups).where(eq(checkups.id, id));

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            session,
            {
                eventType: 'checkup.deleted',
                subjectType: 'checkup',
                subjectRef: id,
            },
            '[MediFlow] Checkup audit write failed:',
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: "Delete Failed" }, { status: 500 });
    }
}
