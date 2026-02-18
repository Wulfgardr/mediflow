/* @Codex */
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { conversations } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await params;
        const body = await request.json() as unknown;
        const updateData: { title?: string; isArchived?: boolean; updatedAt: Date } = {
            updatedAt: new Date()
        };

        if (body && typeof body === 'object') {
            const payload = body as Record<string, unknown>;
            if (typeof payload.title === 'string') updateData.title = payload.title;
            if (typeof payload.isArchived === 'boolean') updateData.isArchived = payload.isArchived;
        }

        await dbServer.update(conversations).set(updateData).where(eq(conversations.id, id));
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API PUT /conversations/[id] error:', error);
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
        await dbServer.delete(conversations).where(eq(conversations.id, id));
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API DELETE /conversations/[id] error:', error);
        return NextResponse.json({ error: 'Delete Failed' }, { status: 500 });
    }
}
