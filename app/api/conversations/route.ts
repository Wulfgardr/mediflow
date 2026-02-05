import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { conversations } from '@/lib/schema';
import { desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';

export async function GET() {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const data = await dbServer.select().from(conversations).orderBy(desc(conversations.updatedAt));
        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const body = await request.json();
        await dbServer.insert(conversations).values({
            id: body.id || uuidv4(),
            title: body.title,
            updatedAt: new Date(),
            createdAt: new Date()
        });
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: "Create Failed" }, { status: 500 });
    }
}
