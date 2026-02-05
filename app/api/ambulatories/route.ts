import { dbServer } from '@/lib/db-server';
import { ambulatories } from '@/lib/schema';
import { desc } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';

export async function GET() {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const all = await dbServer.select().from(ambulatories).orderBy(desc(ambulatories.createdAt));
        return NextResponse.json(all);
    } catch (error) {
        console.error("API GET /ambulatories error:", error);
        return NextResponse.json({ error: "Failed to fetch ambulatories" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const body = await request.json();

        // Basic validation could go here

        await dbServer.insert(ambulatories).values({
            id: body.id || uuidv4(),
            name: body.name,
            address: body.address,
            parentId: body.parentId || null,
            type: body.type || 'live',
            description: body.description,
            isDefault: body.isDefault || false,
            createdAt: body.createdAt ? new Date(body.createdAt) : new Date()
        });

        // If this new one is default, we should probably unset others, but we'll let the client or specific logic handle that or do it here?
        // For simplicity, we assume client handles logical consistency or we add a transaction here later.

        return NextResponse.json({ success: true, id: body.id });
    } catch (error) {
        console.error("API POST /ambulatories error:", error);
        return NextResponse.json({ error: "Failed to create ambulatory" }, { status: 500 });
    }
}
