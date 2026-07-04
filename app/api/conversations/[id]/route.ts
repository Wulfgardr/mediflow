/* @Codex */
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { conversations, messages } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { conversationUpdateSchema } from '@/lib/api-schemas/conversations';
import { parseApiBody } from '@/lib/api-schemas/parse';

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await params;
        const rawBody = await request.json() as unknown;
        const parsedBody = parseApiBody(conversationUpdateSchema, rawBody);
        if (!parsedBody.ok) return parsedBody.response;
        const body = parsedBody.data;
        const updateData: { title?: string; isArchived?: boolean; isDeleted?: boolean; updatedAt: Date } = {
            updatedAt: new Date()
        };

        if (body && typeof body === 'object') {
            if (typeof body.title === 'string') updateData.title = body.title;
            if (typeof body.isArchived === 'boolean') updateData.isArchived = body.isArchived;
            /* @Codex */
            if (typeof body.isDeleted === 'boolean') updateData.isDeleted = body.isDeleted;
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
        /* @Codex */
        dbServer.transaction((tx) => {
            tx.delete(messages).where(eq(messages.conversationId, id)).run();
            tx.delete(conversations).where(eq(conversations.id, id)).run();
        });
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API DELETE /conversations/[id] error:', error);
        return NextResponse.json({ error: 'Delete Failed' }, { status: 500 });
    }
}
