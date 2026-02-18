/* @Codex */
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { entries } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';

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
        const body = await request.json() as unknown;
        const updateData: { type?: string; date?: Date; content?: string } = {};

        const existing = await dbServer.select({ id: entries.id }).from(entries).where(eq(entries.id, id)).get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        if (body && typeof body === 'object') {
            const payload = body as Record<string, unknown>;
            if (typeof payload.type === 'string') updateData.type = payload.type;
            if (typeof payload.content === 'string') updateData.content = payload.content;

            const hasDate = Object.prototype.hasOwnProperty.call(payload, 'date');
            const parsedDate = parseDate(payload.date);
            if (hasDate && parsedDate === undefined) {
                return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
            }
            if (parsedDate) updateData.date = parsedDate;
        }

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
        }

        await dbServer.update(entries).set(updateData).where(eq(entries.id, id));
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
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API DELETE /entries/[id] error:', error);
        return NextResponse.json({ error: 'Delete Failed' }, { status: 500 });
    }
}
