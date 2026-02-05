import { dbServer } from '@/lib/db-server';
import { ambulatories } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    const { id } = await params;
    try {
        const body = await request.json();

        // Remove 'id' from body to prevent PK update attempts if passed
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _, ...updates } = body;

        await dbServer.update(ambulatories)
            .set({
                ...updates,
                // Ensure dates are parsed if present
                ...(updates.createdAt ? { createdAt: new Date(updates.createdAt) } : {})
            })
            .where(eq(ambulatories.id, id));

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error(`API PUT /ambulatories/${id} error:`, error);
        return NextResponse.json({ error: "Failed to update ambulatory" }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    const { id } = await params;
    try {
        await dbServer.delete(ambulatories).where(eq(ambulatories.id, id));
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error(`API DELETE /ambulatories/${id} error:`, error);
        return NextResponse.json({ error: "Failed to delete ambulatory" }, { status: 500 });
    }
}
