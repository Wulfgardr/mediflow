/* @Codex */
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { entries } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
/* @Codex */
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/audit';

function parseDate(value: unknown): Date | undefined {
    if (value === null || value === undefined) return undefined;
    const parsed = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
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
        const updateData: { type?: string; date?: Date; content?: string } = {};

        const existing = await dbServer.select({ id: entries.id }).from(entries).where(eq(entries.id, id)).get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        if (typeof body === 'object') {
            if (typeof body.type === 'string') updateData.type = body.type;
            if (typeof body.content === 'string') updateData.content = body.content;

            const hasDate = Object.prototype.hasOwnProperty.call(body, 'date');
            const parsedDate = parseDate(body.date);
            if (hasDate && parsedDate === undefined) {
                return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
            }
            if (parsedDate) updateData.date = parsedDate;
        }

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
        }

        await dbServer.update(entries).set(updateData).where(eq(entries.id, id));

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            session,
            {
                eventType: 'entry.updated',
                subjectType: 'entry',
                subjectRef: id,
                redactedMetadata: {
                    changedFields: listChangedFields(body),
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
        const existing = await dbServer.select({ id: entries.id }).from(entries).where(eq(entries.id, id)).get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        await dbServer.delete(entries).where(eq(entries.id, id));

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            session,
            {
                eventType: 'entry.deleted',
                subjectType: 'entry',
                subjectRef: id,
            },
            '[MediFlow] Entry audit write failed:',
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API DELETE /entries/[id] error:', error);
        return NextResponse.json({ error: 'Delete Failed' }, { status: 500 });
    }
}
