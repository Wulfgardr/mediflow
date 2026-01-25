import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { messages } from '@/lib/schema';
import { eq, asc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId');

    try {
        let query = dbServer.select().from(messages);

        if (conversationId) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            query = query.where(eq(messages.conversationId, conversationId)) as any;
        }

        const data = await query.orderBy(asc(messages.createdAt));
        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const newId = body.id || uuidv4();

        await dbServer.insert(messages).values({
            id: newId,
            conversationId: body.conversationId,
            role: body.role,
            content: body.content,
            metadata: body.metadata ? JSON.stringify(body.metadata) : undefined,
            createdAt: new Date()
        });

        return NextResponse.json({ id: newId }, { status: 201 });
    } catch (error) {
        return NextResponse.json({ error: "Create Failed" }, { status: 500 });
    }
}
